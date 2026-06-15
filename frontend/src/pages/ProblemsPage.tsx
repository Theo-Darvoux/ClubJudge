import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ProblemSummary } from '../api';
import { DifficultyDots, DifficultyDotsInner, StatusMark } from '../components/badges';
import { CustomSelect } from '../components/CustomSelect';
import { SearchableSelect } from '../components/SearchableSelect';
import { ProblemsHeader } from '../components/ViewToggle';
import { cx } from '../cx';
import { useI18n } from '../i18n/context';
import { useProblemsData } from '../problems/context';
import { LEVELS, problemStatus } from '../problems/status';

type SortKey = 'default' | 'title' | 'difficulty';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'todo' | 'attempted' | 'solved';

const STATUS_FILTERS: StatusFilter[] = ['all', 'todo', 'attempted', 'solved'];
const SORT_KEYS: SortKey[] = ['default', 'title', 'difficulty'];

interface ProblemCardProps {
  p: ProblemSummary;
  number: number;
  recommended: boolean;
  state: 'solved' | 'attempted' | 'todo';
  selectedTag: string | null;
  toggleTag: (tag: string) => void;
}

const ProblemCard = memo(function ProblemCard({
  p,
  number,
  recommended,
  state,
  selectedTag,
  toggleTag,
}: ProblemCardProps) {
  const { t } = useI18n();
  return (
    <div
      className={cx(
        'problem-card',
        state === 'solved' && 'is-solved',
        state === 'attempted' && 'is-attempted',
        recommended && 'is-recommended',
      )}
    >
      {/* Couverture « plein carte » : un clic n'importe où ouvre le
          problème, sans imbriquer les puces interactives dans une
          ancre. Décorative et hors tabulation — c'est le titre qui
          porte le lien accessible et reste sélectionnable, par-dessus
          la couverture (voir z-index). */}
      <Link
        to={`/problems/${p.slug}`}
        className="pcard-cover"
        aria-hidden="true"
        tabIndex={-1}
      />

      <span className="pcard-rail">
        <span className="pcard-index">
          {String(number).padStart(2, '0')}
        </span>
        <StatusMark solved={p.solved} attempted={p.attempted} />
      </span>

      <div className="pcard-top">
        <Link to={`/problems/${p.slug}`} className="pcard-title">
          {p.title}
        </Link>
        <span className="pcard-diff">
          <DifficultyDots level={p.difficulty} />
        </span>
      </div>

      <div className="pcard-meta">
        {p.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={cx('chip', 'clickable-tag-chip', selectedTag === tag && 'is-active')}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        ))}

        <span className="pcard-flag">
          {recommended ? (
            <span className="recommended-badge">{t.problems.recommended} →</span>
          ) : state === 'solved' ? (
            <span className="flag-solved">{t.problems.solved}</span>
          ) : state === 'attempted' ? (
            <span className="flag-attempted">{t.problems.attempted}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
});

export function ProblemsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  // Données partagées avec la vue arbre (chargées une seule fois par le provider) :
  // tout le filtrage de la liste se fait donc côté client, sans aller-retour réseau.
  const { problems, skillTree, error, reload, solvedProblems, totalProblems } = useProblemsData();

  // État des filtres porté par l'URL : il survit à un aller-retour vers un
  // problème (le provider est démonté entre-temps) et rend les vues partageables.
  // Les liens « tag » depuis la page d'un problème ouvrent donc la liste déjà
  // filtrée sur ce tag (?tag=…), exactement comme un clic sur une puce ici.
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. URL search parameters as single source of truth
  const difficulty = useMemo(() => {
    const d = Number(searchParams.get('diff'));
    return LEVELS.includes(d) ? d : 0;
  }, [searchParams]);

  const status = useMemo(() => {
    const s = searchParams.get('status') as StatusFilter;
    return STATUS_FILTERS.includes(s) ? s : 'all';
  }, [searchParams]);

  const sortKey = useMemo(() => {
    const s = searchParams.get('sort') as SortKey;
    return SORT_KEYS.includes(s) ? s : 'default';
  }, [searchParams]);

  const sortDir = useMemo<SortDir>(() => {
    return searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  }, [searchParams]);

  // 2. Input search query state with debounced sync to URL
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const urlQ = searchParams.get('q') ?? '';

  // Track what we last wrote to the URL to avoid feedback loops/flickering
  const lastWrittenQueryRef = useRef(urlQ);

  // Sync search input if URL changes (e.g. back/forward navigation)
  useEffect(() => {
    if (urlQ !== lastWrittenQueryRef.current) {
      lastWrittenQueryRef.current = urlQ;
      setQuery(urlQ);
    }
  }, [urlQ]);

  // Use a ref for searchParams to avoid resetting the debounce timer on unrelated filter changes
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  // Debounce writing the search query to the URL
  useEffect(() => {
    const timer = setTimeout(() => {
      const currentUrlQ = searchParamsRef.current.get('q') ?? '';
      if (query !== currentUrlQ) {
        const next = new URLSearchParams(searchParamsRef.current);
        if (query) {
          next.set('q', query);
        } else {
          next.delete('q');
        }
        lastWrittenQueryRef.current = query;
        setSearchParams(next, { replace: true });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, setSearchParams]);

  // Helper to update URL params using functional updater to avoid dependency on searchParams
  const updateParam = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (
        value === null ||
        value === '' ||
        value === 'all' ||
        (key === 'diff' && value === '0') ||
        (key === 'sort' && value === 'default')
      ) {
        next.delete(key);
        if (key === 'sort') {
          next.delete('dir');
        }
      } else {
        next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Numéro stable + liste des tags : tout ce qui ne dépend que de la liste
  // complète (indépendant des filtres) en un seul passage.
  // Numéro stable des problèmes : indépendant de la langue et des filtres
  const numberBySlug = useMemo(() => {
    const list = problems ?? [];
    const map = new Map<string, number>();
    list.forEach((p, i) => {
      map.set(p.slug, i + 1);
    });
    return map;
  }, [problems]);

  // Liste ordonnée de tous les tags du catalogue
  const allTags = useMemo(() => {
    const list = problems ?? [];
    const tagsSet = new Set<string>();
    list.forEach((p) => {
      for (const tag of p.tags) tagsSet.add(tag);
    });
    return Array.from(tagsSet).sort((a, b) => a.localeCompare(b, lang));
  }, [problems, lang]);

  // Tag sélectionné (valeur validée par rapport aux tags du catalogue pour éviter les tags obsolètes)
  const selectedTag = useMemo(() => {
    const tag = searchParams.get('tag');
    if (!tag) return null;
    if (problems && !allTags.includes(tag)) {
      return null;
    }
    return tag;
  }, [searchParams, problems, allTags]);

  const [visibleLimit, setVisibleLimit] = useState(40);

  // Ajustement de l'état pendant le rendu pour éviter l'avertissement de cascade d'effets (react-hooks/set-state-in-effect)
  const filterKey = `${query}_${selectedTag ?? ''}_${difficulty}_${status}_${sortKey}_${sortDir}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setVisibleLimit(40);
  }

  // Progression globale (résolus/total partagés avec la vue arbre via le
  // provider). null quand le catalogue est vide : sert aussi à masquer les
  // contrôles tant qu'il n'y a rien à filtrer.
  const progress = useMemo(() => {
    if (totalProblems === 0) return null;
    return {
      solvedProblems,
      totalProblems,
      pct: Math.round((solvedProblems / totalProblems) * 100),
    };
  }, [solvedProblems, totalProblems]);

  // Prédicats de filtre, réutilisés par la liste visible ET les compteurs à
  // facettes. Chaque groupe de compteurs applique tous les filtres SAUF sa
  // propre dimension, pour montrer « ce que donnerait ce choix » plutôt qu'un
  // total global figé (recherche à facettes).
  const q = query.trim().toLowerCase();
  // Compteurs du filtre segmenté : recherche + tag + difficulté (pas le statut,
  // sa propre dimension) — ils reflètent donc la difficulté/tag sélectionnés.
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: 0, todo: 0, attempted: 0, solved: 0 };
    for (const p of problems ?? []) {
      const matchQ = !q || p.title.toLowerCase().includes(q) || p.tags.some((tag) => tag.toLowerCase().includes(q));
      const matchT = !selectedTag || p.tags.includes(selectedTag);
      const matchD = !difficulty || p.difficulty === difficulty;
      if (matchQ && matchT && matchD) {
        counts.all += 1;
        counts[problemStatus(p)] += 1;
      }
    }
    return counts;
  }, [problems, q, selectedTag, difficulty]);

  // Pastilles de difficulté (résolus/total par niveau) : recherche + tag
  // seulement. On exclut le filtre de statut à dessein — sinon, sous « Résolus »,
  // total = résolus et toutes les pastilles passeraient « complètes ».
  const difficultyStats = useMemo(() => {
    const stats = LEVELS.map((level) => ({ level, solved: 0, total: 0 }));
    for (const p of problems ?? []) {
      const matchQ = !q || p.title.toLowerCase().includes(q) || p.tags.some((tag) => tag.toLowerCase().includes(q));
      const matchT = !selectedTag || p.tags.includes(selectedTag);
      if (matchQ && matchT) {
        // Les niveaux vont de 1 à 5 et `stats` est indexé de 0 à 4.
        const bucket = stats[p.difficulty - 1];
        if (bucket) {
          bucket.total += 1;
          if (p.solved) bucket.solved += 1;
        }
      }
    }
    return stats;
  }, [problems, q, selectedTag]);

  // Problèmes rattachés à un nœud « recommandé » dans l'arbre : on les met en
  // avant dans la liste pour guider l'utilisateur vers son prochain pas.
  const recommendedSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const n of skillTree ?? []) {
      if (n.state === 'recommended') {
        for (const p of n.problems) {
          if (!p.solved) set.add(p.slug);
        }
      }
    }
    return set;
  }, [skillTree]);

  const visible = useMemo(() => {
    if (!problems) return null;
    const filtered = problems.filter((p) => {
      const matchQ = !q || p.title.toLowerCase().includes(q) || p.tags.some((tag) => tag.toLowerCase().includes(q));
      const matchT = !selectedTag || p.tags.includes(selectedTag);
      const matchD = !difficulty || p.difficulty === difficulty;
      const matchS = status === 'all' || problemStatus(p) === status;
      return matchS && matchD && matchT && matchQ;
    });

    // `filtered` est déjà un tableau neuf (issu de .filter) : on peut le trier
    // en place sans copie supplémentaire ni risque de muter `problems`.

    // Tri par défaut : les problèmes recommandés remontent en tête de liste
    // (le « prochain pas » naturel), puis l'ordre API est conservé. Sinon on
    // applique la clé de tri choisie dans le menu.
    if (sortKey === 'default') {
      return filtered.sort((a, b) => {
        const ra = recommendedSlugs.has(a.slug) ? 0 : 1;
        const rb = recommendedSlugs.has(b.slug) ? 0 : 1;
        return ra - rb;
      });
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'title':
          return dir * a.title.localeCompare(b.title, lang);
        case 'difficulty':
          return dir * (a.difficulty - b.difficulty);
        default:
          return 0;
      }
    });
  }, [problems, q, selectedTag, difficulty, status, sortKey, sortDir, lang, recommendedSlugs]);

  // Ouvre un problème non résolu au hasard parmi la sélection filtrée (et à
  // défaut n'importe lequel) — le « je ne sais pas quoi faire, surprends-moi ».
  const pickRandom = useCallback(() => {
    if (!visible || visible.length === 0) return;
    const pool = visible.filter((p) => !p.solved);
    const list = pool.length > 0 ? pool : visible;
    const choice = list[Math.floor(Math.random() * list.length)];
    navigate(`/problems/${choice.slug}`);
  }, [visible, navigate]);

  const hasActiveFilters =
    query !== '' ||
    selectedTag !== null ||
    difficulty !== 0 ||
    status !== 'all' ||
    sortKey !== 'default' ||
    searchParams.has('dir');

  const clearFilters = () => {
    setQuery('');
    lastWrittenQueryRef.current = '';
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('tag');
      next.delete('diff');
      next.delete('status');
      next.delete('sort');
      next.delete('dir');
      return next;
    }, { replace: true });
  };

  const toggleTag = useCallback((tag: string) => {
    updateParam('tag', selectedTag === tag ? null : tag);
  }, [selectedTag, updateParam]);

  const statusLabel: Record<StatusFilter, string> = {
    all: t.problems.status_all,
    todo: t.problems.status_todo,
    attempted: t.problems.status_attempted,
    solved: t.problems.status_solved,
  };

  // Compteur affiché dans l'en-tête flottant (même emplacement que l'overline
  // de l'arbre) — la bascule Arbre/Liste reste donc parfaitement immobile.
  // Pluriel selon la langue : l'anglais singularise seulement n === 1
  // (« 0 problems »), le français aussi pour 0 et 1 (« 0 problème »).
  const overline = (() => {
    if (!visible) return t.problems.loading;
    const n = visible.length;
    const plural = lang === 'en' ? n !== 1 : n > 1;
    return `${n} ${plural ? t.problems.count_many : t.problems.count_one}`;
  })();

  return (
    <div className="problems-fullscreen">
      <ProblemsHeader overline={overline} />

      <div className="problems-scroll">
        {/* Barre de progression globale — problèmes résolus sur le total. */}
        {progress && (
          <div className="list-progress-bar">
            <div className="list-progress-track">
              <div
                className="list-progress-fill"
                role="progressbar"
                aria-valuenow={progress.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <span className="list-progress-text mono-label">
              {t.skills.problems_solved(progress.solvedProblems, progress.totalProblems)}
            </span>
            <span className="list-progress-pct">{progress.pct}%</span>
          </div>
        )}

        {/* Filtre par difficulté : pastilles colorées (vert → rouge) qui font
            aussi office de tableau de bord résolus/total. Remplace l'ancien
            menu déroulant de difficulté. */}
        {progress && (
          <div className="difficulty-stats" role="group" aria-label={t.problems.difficulty_breakdown}>
            <span className="difficulty-stats-label mono-label">{t.problems.by_difficulty}</span>
            {difficultyStats.map((s) => (
              <button
                key={s.level}
                type="button"
                data-level={s.level}
                className={cx(
                  'diff-stat',
                  difficulty === s.level && 'is-active',
                  s.total > 0 && s.solved === s.total && 'is-complete',
                )}
                onClick={() => updateParam('diff', difficulty === s.level ? null : String(s.level))}
                aria-pressed={difficulty === s.level}
              >
                <span className="diff-stat-dots" aria-hidden="true">
                  <DifficultyDotsInner level={s.level} />
                </span>
                <span className="diff-stat-name">{t.difficulty[s.level]}</span>
                <span className="diff-stat-count mono-label">
                  {s.solved}/{s.total}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Barre de filtres + tri (défile avec la liste). Masquée tant qu'il n'y
            a pas de catalogue à filtrer — chargement, erreur ou liste vide —
            comme la barre de progression et les pastilles de difficulté. */}
        {progress && (
        <div className="filters-bar">
          <div className="filters">
            <div className="filter-search-wrapper">
              <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                className="filter-search"
                placeholder={t.problems.search_placeholder}
                aria-label={t.problems.search_placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => {
                    setQuery('');
                    lastWrittenQueryRef.current = '';
                    updateParam('q', null);
                  }}
                  aria-label={t.problems.clear_search}
                >
                  ✕
                </button>
              )}
            </div>

            <SearchableSelect
              value={selectedTag ?? ''}
              onChange={(val) => updateParam('tag', val ? String(val) : null)}
              options={[
                { value: '', label: t.problems.all_tags },
                ...allTags.map((tag) => ({ value: tag, label: tag })),
              ]}
              ariaLabel={t.problems.all_tags}
              noResultsText={t.problems.no_tags}
            />

            <div className="sort-control">
              <CustomSelect
                value={sortKey}
                onChange={(val) => updateParam('sort', val as SortKey)}
                options={[
                  { value: 'default', label: t.problems.sort_default },
                  { value: 'title', label: t.problems.sort_title },
                  { value: 'difficulty', label: t.problems.sort_difficulty },
                ]}
                ariaLabel={t.problems.sort_by}
              />
              <button
                type="button"
                className="sort-dir-btn"
                onClick={() => updateParam('dir', sortDir === 'asc' ? 'desc' : 'asc')}
                disabled={sortKey === 'default'}
                title={t.problems.sort_dir}
                aria-label={t.problems.sort_dir}
              >
                <svg
                  className={`sort-dir-icon is-${sortDir}`}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
              </button>
            </div>

          </div>

          {/* Filtre d'état segmenté (avec compteurs) + actions à droite :
              « effacer les filtres » (si actifs) et « au hasard ». */}
          <div className="status-row">
            <div className="status-segmented" role="group" aria-label={t.problems.th_status}>
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cx('seg-btn', status === s && 'is-active')}
                  onClick={() => updateParam('status', s)}
                  aria-pressed={status === s}
                >
                  {statusLabel[s]}
                  <span className="seg-count">{statusCounts[s]}</span>
                </button>
              ))}
            </div>

            <div className="status-row-actions">
              {hasActiveFilters && (
                <button type="button" className="btn-clear-filters" onClick={clearFilters}>
                  <span aria-hidden="true">✕</span> {t.problems.clear_filters}
                </button>
              )}
              <button
                type="button"
                className="btn-random"
                onClick={pickRandom}
                disabled={!visible || visible.length === 0}
                title={t.problems.random_title}
              >
                <span aria-hidden="true">🎲</span> {t.problems.random}
              </button>
            </div>
          </div>
        </div>
        )}

        {problems === null ? (
          <p className="mono-label">{t.problems.loading}</p>
        ) : error ? (
          /* Échec réseau / serveur — distinct d'un catalogue vide : on propose
             un vrai « réessayer » qui relance le chargement partagé. */
          <div className="empty-state-container">
            <p className="empty-state">{t.problems.load_error}</p>
            <button type="button" className="btn-clear-filters" onClick={reload}>
              <span aria-hidden="true">↻</span> {t.problems.retry}
            </button>
          </div>
        ) : problems.length === 0 ? (
          /* Catalogue réellement vide (aucun problème publié), sans filtre en cause. */
          <div className="empty-state-container">
            <p className="empty-state">{t.problems.empty_catalogue}</p>
          </div>
        ) : visible?.length === 0 ? (
          <div className="empty-state-container">
            <p className="empty-state">{t.problems.empty}</p>
            {hasActiveFilters && (
              <button type="button" className="btn-clear-filters" onClick={clearFilters}>
                <span aria-hidden="true">✕</span> {t.problems.clear_filters}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="problem-cards">
              {visible?.slice(0, visibleLimit).map((p) => {
                const recommended = recommendedSlugs.has(p.slug);
                const state = problemStatus(p);
                return (
                  <ProblemCard
                    key={p.slug}
                    p={p}
                    number={numberBySlug.get(p.slug) ?? 0}
                    recommended={recommended}
                    state={state}
                    selectedTag={selectedTag}
                    toggleTag={toggleTag}
                  />
                );
              })}
            </div>
            {visible && visible.length > visibleLimit && (
              <div className="load-more-container">
                <button
                  type="button"
                  className="btn-load-more"
                  onClick={() => setVisibleLimit((prev) => prev + 40)}
                >
                  {t.problems.load_more} ({visible.length - visibleLimit})
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
