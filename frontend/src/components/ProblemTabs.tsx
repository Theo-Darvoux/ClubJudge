import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Editorial, ProblemDetail, SharedSolution, SubmissionLanguage } from '../api';
import { useI18n } from '../i18n/context';
import { Markdown } from './Markdown';
import { CodeBlock } from './CodeBlock';
import { CustomSelect } from './CustomSelect';

type TabId = 'statement' | 'hints' | 'editorial' | 'solutions';

const LANGUAGE_LABELS: Record<SubmissionLanguage, string> = {
  cpp: 'C++',
  python: 'Python',
  c: 'C',
  java: 'Java',
  ocaml: 'OCaml',
};

function hintsKey(slug: string) {
  return `clubjudge.hints.${slug}`;
}

function loadRevealedHints(slug: string, total: number): number {
  const raw = Number(localStorage.getItem(hintsKey(slug)) ?? '0');
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), total) : 0;
}

export function ProblemTabs({ problem, slug }: { problem: ProblemDetail; slug: string }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<TabId>('statement');

  // Pré-chargement de l'éditorial et des solutions dès que le problème est
  // résolu — au montage si déjà résolu, ou dès la résolution en direct (quand
  // `problem.solved` passe à true). Évite le flash de chargement à l'ouverture
  // des onglets. Les contests ferment ces ressources tant qu'ils sont ouverts.
  const [editorial, setEditorial] = useState<Editorial | null>(null);
  const [editorialFailed, setEditorialFailed] = useState(false);
  const [solutions, setSolutions] = useState<SharedSolution[] | null>(null);

  useEffect(() => {
    if (!problem.solved || problem.contest) return;
    let cancelled = false;
    if (problem.has_editorial) {
      api
        .editorial(slug)
        .then((e) => !cancelled && setEditorial(e))
        .catch(() => !cancelled && setEditorialFailed(true));
    }
    api
      .solutions(slug)
      .then((s) => !cancelled && setSolutions(s))
      .catch(() => !cancelled && setSolutions([]));
    return () => {
      cancelled = true;
    };
  }, [slug, problem.solved, problem.contest, problem.has_editorial]);

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

  return (
    <article className="statement">
      <div className="statement-tabs" role="tablist">
        {tabs.map(({ id, label, locked }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
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

      {tab === 'statement' && (
        <div className="tab-panel">
          {showFallbackNote && <p className="mono-label">{t.problem.statement_fallback_fr}</p>}
          <Markdown>{statement}</Markdown>
        </div>
      )}
      {tab === 'hints' && <HintsPanel slug={slug} hints={problem.hints} />}
      {tab === 'editorial' && (
        <EditorialPanel solved={problem.solved} editorial={editorial} failed={editorialFailed} />
      )}
      {tab === 'solutions' && (
        <SolutionsPanel solved={problem.solved} solutions={solutions} />
      )}
    </article>
  );
}

function HintsPanel({ slug, hints }: { slug: string; hints: string[] }) {
  const { t } = useI18n();
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
      <p className="hints-intro">{t.problem.hints_intro}</p>
      {hints.slice(0, revealed).map((hint, i) => (
        <section key={i} className="hint-card">
          <h3 className="mono-label">{t.problem.hint_label(i + 1)}</h3>
          <Markdown>{hint}</Markdown>
        </section>
      ))}
      {revealed < hints.length && (
        <button className="btn btn-ghost hint-reveal" onClick={revealNext}>
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

function EditorialPanel({
  solved,
  editorial,
  failed,
}: {
  solved: boolean;
  editorial: Editorial | null;
  failed: boolean;
}) {
  const { t, lang } = useI18n();

  if (!solved) return <LockedPanel message={t.problem.editorial_locked} />;
  if (failed) {
    return (
      <div className="tab-panel">
        <p className="empty-state">{t.problem.no_editorial}</p>
      </div>
    );
  }
  if (!editorial) {
    return (
      <div className="tab-panel">
        <p className="mono-label">{t.problems.loading}</p>
      </div>
    );
  }
  const text =
    lang === 'en' && editorial.editorial_en ? editorial.editorial_en : editorial.editorial_fr;
  return (
    <div className="tab-panel">
      <Markdown>{text}</Markdown>
    </div>
  );
}

function SolutionsPanel({
  solved,
  solutions,
}: {
  solved: boolean;
  solutions: SharedSolution[] | null;
}) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<SubmissionLanguage | 'all'>('all');
  const [sort, setSort] = useState<'time' | 'memory' | 'recent'>('time');

  if (!solved) return <LockedPanel message={t.problem.solutions_locked} />;
  if (solutions === null) {
    return (
      <div className="tab-panel">
        <p className="mono-label">{t.problems.loading}</p>
      </div>
    );
  }

  const visible = solutions
    .filter((s) => language === 'all' || s.language === language)
    .sort((a, b) => {
      if (sort === 'time') return (a.time_s ?? Infinity) - (b.time_s ?? Infinity);
      if (sort === 'memory') return (a.memory_kb ?? Infinity) - (b.memory_kb ?? Infinity);
      return b.created_at.localeCompare(a.created_at);
    });
  const languages = [...new Set(solutions.map((s) => s.language))];

  // Percentile de vitesse de ma propre solution parmi celles partagées.
  const timed = solutions.filter((s) => s.time_s != null);
  const mine = timed.find((s) => s.is_mine);
  const myPercentile =
    mine && timed.length > 1
      ? Math.round(
          (100 * timed.filter((s) => (s.time_s ?? 0) > (mine.time_s ?? 0)).length) /
            (timed.length - 1),
        )
      : null;

  return (
    <div className="tab-panel">
      {solutions.length === 0 ? (
        <p className="empty-state">{t.problem.no_solutions}</p>
      ) : (
        <>
          <div className="solutions-bar">
            <p className="hints-intro">{t.problem.solutions_intro}</p>
            <div className="solutions-filters">
              <CustomSelect
                value={language}
                onChange={(val) => setLanguage(val as SubmissionLanguage | 'all')}
                options={[
                  { value: 'all', label: t.problem.all_languages },
                  ...languages.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] })),
                ]}
                ariaLabel={t.problem.th_lang}
              />
              <CustomSelect
                value={sort}
                onChange={(val) => setSort(val as typeof sort)}
                options={[
                  { value: 'time', label: t.problem.sort_time },
                  { value: 'memory', label: t.problem.sort_memory },
                  { value: 'recent', label: t.problem.sort_recent },
                ]}
                ariaLabel={t.problem.sort_time}
              />
            </div>
          </div>
          {visible.map((s) => (
            <section key={s.id} className="solution-card">
              <header>
                <span className="solution-author">
                  {s.author}
                  {s.is_mine && <span className="chip mine-chip">{t.problem.mine_badge}</span>}
                  {s.is_mine && myPercentile != null && (
                    <span className="chip percentile-chip">
                      {t.problem.faster_than(myPercentile)}
                    </span>
                  )}
                </span>
                <span className="solution-meta mono-label">
                  {LANGUAGE_LABELS[s.language]}
                  {s.time_s != null && ` · ${s.time_s.toFixed(2)} s`}
                  {s.memory_kb != null && ` · ${Math.round(s.memory_kb / 1024)} Mo`}
                </span>
              </header>
              <CodeBlock
                className="solution-code"
                code={s.source_code}
                language={s.language}
              />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
