import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, api } from '../api';
import type { Editorial, ProblemDetail, SharedSolution, SubmissionLanguage } from '../api';
import { fmtMemoryMo, fmtTimeS } from '../format';
import { languageLabel } from '../languages';
import { useI18n } from '../i18n/context';
import { Markdown } from './Markdown';
import { CodeBlock } from './CodeBlock';
import { CustomSelect } from './CustomSelect';

type TabId = 'statement' | 'hints' | 'editorial' | 'solutions';

// Pourquoi l'éditorial ne s'affiche pas : 'none' = il n'y en a pas (404),
// 'error' = chargement impossible (réseau, 5xx…) — à ne pas confondre.
type EditorialError = 'none' | 'error';

function hintsKey(slug: string) {
  return `clubjudge.hints.${slug}`;
}

// Charge paresseusement une ressource d'onglet (éditorial, solutions) : une seule
// fois quand `shouldLoad` devient vrai (onglet ouvert + conditions d'accès
// remplies), puis met en cache. `retry()` efface l'erreur, ce qui relance le
// chargement (l'erreur figure dans les dépendances de l'effet). Les closures
// `fetcher`/`mapError` sont lues via des refs pour ne pas relancer l'effet à
// chaque rendu. Factorise les deux chargements jadis dupliqués, pour qu'ils ne
// puissent plus diverger.
//
// Pas de réinitialisation « par problème » ici : la page consommatrice (ProblemView)
// est montée avec `key={slug}`, donc changer de problème REMONTE ce hook avec un
// état neuf (data/error à null). Seul `resetKey` reste nécessaire — invalidation
// EN COURS DE VIE pour un même problème (ex. un nouvel AC qui doit rafraîchir la
// liste des solutions). Ne pas réintroduire de remise à zéro par slug sans retirer
// ce `key`, sous peine de doublonner ce que le remontage fait déjà.
function useLazyTabResource<T, E>(
  shouldLoad: boolean,
  fetcher: () => Promise<T>,
  mapError: (err: unknown) => E,
  resetKey?: unknown,
): { data: T | null; error: E | null; retry: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<E | null>(null);
  // Closures rafraîchies à chaque rendu, lues par l'effet sans le relancer
  // (même motif que les raccourcis de la barre d'outils du Workbench).
  const fetcherRef = useRef(fetcher);
  const mapErrorRef = useRef(mapError);
  useEffect(() => {
    fetcherRef.current = fetcher;
    mapErrorRef.current = mapError;
  });

  const lastLoadedResetKey = useRef(resetKey);

  useEffect(() => {
    if (!shouldLoad) return;

    const resetKeyChanged = resetKey !== lastLoadedResetKey.current;
    if (!resetKeyChanged && (data !== null || error !== null)) return;

    let cancelled = false;
    if (resetKeyChanged) {
      setError(null);
    }
    lastLoadedResetKey.current = resetKey;

    fetcherRef.current()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(mapErrorRef.current(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shouldLoad, data, error, resetKey]);

  // Réessai après un échec : on efface l'erreur (jamais `data`). Comme `error`
  // est une dépendance de l'effet, ce seul changement relance le chargement —
  // pas besoin d'un jeton séparé. Une ressource déjà chargée n'est pas rechargée.
  const retry = useCallback(() => setError(null), []);
  return { data, error, retry };
}

function loadRevealedHints(slug: string, total: number): number {
  const raw = Number(localStorage.getItem(hintsKey(slug)) ?? '0');
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), total) : 0;
}


export function ProblemTabs({
  problem,
  slug,
  acVersion,
}: {
  problem: ProblemDetail;
  slug: string;
  // Change à chaque AC : invalide le cache des solutions (cf. useLazyTabResource).
  acVersion: number;
}) {
  const { t, lang } = useI18n();
  // Lien profond depuis le contest terminé (« Éditorial → ») : on ouvre
  // directement l'onglet demandé, sauf pendant un contest (onglet inexistant
  // alors). L'intention passe par l'état de navigation (fiable d'une route à
  // l'autre) ; le hash #editorial sert de repli pour une URL partagée.
  const location = useLocation();
  const [tab, setTab] = useState<TabId>(() => {
    const fromState = (location.state as { tab?: string } | null)?.tab;
    const target = fromState ?? location.hash.replace('#', '');
    const deep: TabId[] = ['statement', 'hints', 'editorial', 'solutions'];
    return !problem.contest && deep.includes(target as TabId) ? (target as TabId) : 'statement';
  });

  // Éditorial et solutions chargés paresseusement, à la première ouverture de
  // leur onglet (et seulement si le problème est résolu, hors contest) : on évite
  // deux requêtes systématiques pour des onglets que l'utilisateur n'ouvre pas
  // forcément. Le résultat est ensuite mis en cache (état conservé), donc revenir
  // sur l'onglet ne recharge pas. Les contests ferment ces ressources tant qu'ils
  // sont ouverts. Chaque ressource a sa propre relance : réessayer l'une (après
  // erreur réseau) ne recharge pas l'autre inutilement.
  const editorialRes = useLazyTabResource<Editorial, EditorialError>(
    tab === 'editorial' && problem.solved && !problem.contest && problem.has_editorial,
    () => api.editorial(slug),
    // 404 = pas d'éditorial (définitif) ; tout le reste = échec de chargement.
    (err) => (err instanceof ApiError && err.status === 404 ? 'none' : 'error'),
  );
  const solutionsRes = useLazyTabResource<SharedSolution[], boolean>(
    tab === 'solutions' && problem.solved && !problem.contest,
    () => api.solutions(slug),
    () => true,
    // Recharge la liste après chaque nouvel AC (sa propre soumission incluse).
    acVersion,
  );

  const statement =
    lang === 'en' && problem.statement_en ? problem.statement_en : problem.statement_fr;
  const showFallbackNote = lang === 'en' && !problem.statement_en;

  const tabs: { id: TabId; label: string; locked?: boolean }[] = [
    { id: 'statement', label: t.problem.tabs.statement },
  ];
  // Pendant un contest, conditions ICPC : énoncé seul (l'API ferme de toute
  // façon indices, éditorial et solutions tant que la fenêtre est ouverte).
  if (!problem.contest) {
    tabs.push({ id: 'hints', label: `${t.problem.tabs.hints} · ${problem.hints.length}` });
    if (problem.has_editorial) {
      tabs.push({ id: 'editorial', label: t.problem.tabs.editorial, locked: !problem.solved });
    }
    tabs.push({ id: 'solutions', label: t.problem.tabs.solutions, locked: !problem.solved });
  }

  // Navigation au clavier entre onglets (flèches gauche/droite), avec tabindex
  // « roving » : seul l'onglet actif est dans l'ordre de tabulation.
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const idx = tabs.findIndex((tb) => tb.id === tab);
    let next: TabId | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      next = tabs[(idx + dir + tabs.length) % tabs.length].id;
    } else if (e.key === 'Home') {
      next = tabs[0].id;
    } else if (e.key === 'End') {
      next = tabs[tabs.length - 1].id;
    } else {
      return;
    }
    e.preventDefault();
    setTab(next);
    document.getElementById(`statement-tab-${next}`)?.focus();
  };

  return (
    <article className="statement">
      <div className="statement-tabs" role="tablist" onKeyDown={onTabKeyDown}>
        {tabs.map(({ id, label, locked }) => (
          <button
            key={id}
            type="button"
            id={`statement-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls="statement-panel"
            tabIndex={tab === id ? 0 : -1}
            className={`statement-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {locked && (
              <span className="tab-lock" aria-hidden="true">
                ⬡
              </span>
            )}
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="statement-panel"
        aria-labelledby={`statement-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'statement' && (
          <div className="tab-panel">
            {showFallbackNote && <p className="mono-label">{t.problem.statement_fallback_fr}</p>}
            <Markdown>{statement}</Markdown>
          </div>
        )}
        {tab === 'hints' && <HintsPanel slug={slug} hints={problem.hints} />}
        {tab === 'editorial' && (
          <EditorialPanel
            solved={problem.solved}
            editorial={editorialRes.data}
            error={editorialRes.error}
            onRetry={editorialRes.retry}
          />
        )}
        {tab === 'solutions' && (
          <SolutionsPanel
            solved={problem.solved}
            solutions={solutionsRes.data}
            error={solutionsRes.error ?? false}
            onRetry={solutionsRes.retry}
          />
        )}
      </div>
    </article>
  );
}

function HintsPanel({ slug, hints }: { slug: string; hints: string[] }) {
  const { t, lang } = useI18n();
  const [revealed, setRevealed] = useState(() => loadRevealedHints(slug, hints.length));

  if (hints.length === 0) {
    return (
      <div className="tab-panel">
        <p className="empty-state">{t.problem.no_hints}</p>
      </div>
    );
  }

  function revealNext() {
    const next = revealed + 1;
    setRevealed(next);
    localStorage.setItem(hintsKey(slug), String(next));
  }

  return (
    <div className="tab-panel">
      {/* Les indices ne sont rédigés qu'en français (cf. modèle ProblemHint) :
          on le signale en anglais, comme l'énoncé et l'éditorial. */}
      {lang === 'en' && <p className="mono-label">{t.problem.hints_fallback}</p>}
      <p className="hints-intro">{t.problem.hints_intro}</p>
      {hints.slice(0, revealed).map((hint, i) => (
        <section key={i} className="hint-card">
          <h3 className="mono-label">{t.problem.hint_label(i + 1)}</h3>
          <Markdown>{hint}</Markdown>
        </section>
      ))}
      {revealed < hints.length && (
        <button type="button" className="btn btn-ghost hint-reveal" onClick={revealNext}>
          {t.problem.reveal_hint(revealed + 1, hints.length)}
        </button>
      )}
    </div>
  );
}

function LockedPanel({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="tab-panel locked-panel">
      <span className="locked-glyph" aria-hidden="true">
        ⬡
      </span>
      <h3>{t.problem.locked_title}</h3>
      <p>{message}</p>
    </div>
  );
}

// État d'erreur d'un onglet : message + bouton « réessayer » optionnel (absent
// pour une absence définitive, comme « pas d'éditorial »).
function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="tab-panel">
      <p className="empty-state">{message}</p>
      {onRetry && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: '0.5rem', display: 'block', marginInline: 'auto' }}
          onClick={onRetry}
        >
          {t.problems.retry}
        </button>
      )}
    </div>
  );
}

function EditorialPanel({
  solved,
  editorial,
  error,
  onRetry,
}: {
  solved: boolean;
  editorial: Editorial | null;
  error: EditorialError | null;
  onRetry: () => void;
}) {
  const { t, lang } = useI18n();

  if (!solved) return <LockedPanel message={t.problem.editorial_locked} />;
  if (error) {
    // 'none' = pas d'éditorial (définitif, pas de réessai) ; 'error' = échec de
    // chargement (réseau/5xx), donc réessayable.
    return error === 'none' ? (
      <ErrorState message={t.problem.no_editorial} />
    ) : (
      <ErrorState message={t.problem.editorial_error} onRetry={onRetry} />
    );
  }
  if (!editorial) {
    return (
      <div className="tab-panel">
        <p className="mono-label" role="status">{t.problems.loading}</p>
      </div>
    );
  }
  const text =
    lang === 'en' && editorial.editorial_en ? editorial.editorial_en : editorial.editorial_fr;
  const showFallbackNote = lang === 'en' && !editorial.editorial_en;

  return (
    <div className="tab-panel">
      {showFallbackNote && (
        <p className="mono-label" style={{ marginBottom: '1rem' }}>
          {t.problem.editorial_fallback}
        </p>
      )}
      <Markdown>{text}</Markdown>
    </div>
  );
}

function SolutionsPanel({
  solved,
  solutions,
  error,
  onRetry,
}: {
  solved: boolean;
  solutions: SharedSolution[] | null;
  error: boolean;
  onRetry: () => void;
}) {
  const { t, lang } = useI18n();
  const [language, setLanguage] = useState<SubmissionLanguage | 'all'>('all');
  const [sort, setSort] = useState<'time' | 'memory' | 'recent'>('time');

  const languages = useMemo(
    () => [...new Set((solutions ?? []).map((s) => s.language))],
    [solutions],
  );

  // Langage de filtre effectif : si le filtre retenu n'existe plus dans la liste
  // courante (changement de problème, rechargement après un nouvel AC), on
  // retombe sur « tous ». Dérivé à la volée plutôt qu'écrit dans l'état pendant le
  // rendu — pas de re-rendu en cascade, et l'état ne peut pas rester incohérent.
  const effectiveLanguage =
    language === 'all' || languages.includes(language) ? language : 'all';

  const visible = useMemo(() => {
    // created_at est de l'ISO-8601 : l'ordre lexicographique = l'ordre
    // chronologique, donc une comparaison de chaînes suffit (moins coûteuse que
    // localeCompare). Plus récente d'abord.
    const byRecent = (a: SharedSolution, b: SharedSolution) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
    return (solutions ?? [])
      .filter((s) => effectiveLanguage === 'all' || s.language === effectiveLanguage)
      .sort((a, b) => {
        // Ex æquo (même temps / même mémoire) départagés par la plus récente.
        if (sort === 'time') {
          const aVal = a.time_s ?? Infinity;
          const bVal = b.time_s ?? Infinity;
          if (aVal !== bVal) {
            return aVal < bVal ? -1 : 1;
          }
          return byRecent(a, b);
        }
        if (sort === 'memory') {
          const aVal = a.memory_kb ?? Infinity;
          const bVal = b.memory_kb ?? Infinity;
          if (aVal !== bVal) {
            return aVal < bVal ? -1 : 1;
          }
          return byRecent(a, b);
        }
        return byRecent(a, b);
      });
  }, [solutions, effectiveLanguage, sort]);

  if (!solved) return <LockedPanel message={t.problem.solutions_locked} />;
  if (error) {
    return <ErrorState message={t.problem.solutions_error} onRetry={onRetry} />;
  }
  if (solutions === null) {
    return (
      <div className="tab-panel">
        <p className="mono-label" role="status">{t.problems.loading}</p>
      </div>
    );
  }

  return (
    <div className="tab-panel">
      {solutions.length === 0 ? (
        <p className="empty-state">{t.problem.no_solutions}</p>
      ) : (
        <>
          <div className="solutions-bar">
            <p className="hints-intro">{t.problem.solutions_intro}</p>
            <div className="solutions-filters">
              {languages.length > 1 && (
                <CustomSelect
                  value={effectiveLanguage}
                  onChange={(val) => setLanguage(val as SubmissionLanguage | 'all')}
                  options={[
                    { value: 'all', label: t.problem.all_languages },
                    ...languages.map((l) => ({ value: l, label: languageLabel(l) })),
                  ]}
                  ariaLabel={t.problem.th_lang}
                />
              )}
              <CustomSelect
                value={sort}
                onChange={(val) => setSort(val as typeof sort)}
                options={[
                  { value: 'time', label: t.problem.sort_time },
                  { value: 'memory', label: t.problem.sort_memory },
                  { value: 'recent', label: t.problem.sort_recent },
                ]}
                ariaLabel={t.problem.sort_by}
              />
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="empty-state">{t.problem.solutions_no_lang}</p>
          ) : (
            visible.map((s) => {
              // Masqué à 0 % (solution la plus lente) : « plus rapide que 0 % »
              // n'apporte rien et sonne comme un reproche.
              const rawPct = s.is_mine ? (s.percentile ?? null) : null;
              const pct = rawPct != null && rawPct > 0 ? rawPct : null;
              return (
                <section key={s.id} className="solution-card">
                  <header>
                    <span className="solution-author">
                      {s.author}
                      {s.is_mine && <span className="chip mine-chip">{t.problem.mine_badge}</span>}
                      {pct !== null && (
                        <span className="chip percentile-chip">{t.problem.faster_than(pct)}</span>
                      )}
                    </span>
                    <span className="solution-meta mono-label">
                      {languageLabel(s.language)}
                      {s.time_s != null && ` · ${fmtTimeS(s.time_s)}`}
                      {s.memory_kb != null && ` · ${fmtMemoryMo(s.memory_kb, lang)}`}
                    </span>
                  </header>
                  <CodeBlock
                    className="solution-code"
                    code={s.source_code}
                    language={s.language}
                  />
                </section>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
