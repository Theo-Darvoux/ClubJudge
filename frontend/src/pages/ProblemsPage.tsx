import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DifficultyDots, StatusMark } from '../components/badges';
import { SearchableSelect } from '../components/SearchableSelect';
import { ProblemsHeader } from '../components/ViewToggle';
import { useI18n } from '../i18n/context';
import { useProblemsData } from '../problems/context';

type SortKey = 'default' | 'title' | 'difficulty';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'todo' | 'attempted' | 'solved';

const STATUS_FILTERS: StatusFilter[] = ['all', 'todo', 'attempted', 'solved'];
const SORT_KEYS: SortKey[] = ['default', 'title', 'difficulty'];
const LEVELS = [1, 2, 3, 4, 5];

export function ProblemsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  // Données partagées avec la vue arbre (chargées une seule fois par le provider) :
  // tout le filtrage de la liste se fait donc côté client, sans aller-retour réseau.
  const { problems, skillTree } = useProblemsData();

  // État des filtres porté par l'URL : il survit à un aller-retour vers un
  // problème (le provider est démonté entre-temps) et rend les vues partageables.
  // Les liens « tag » depuis la page d'un problème ouvrent donc la liste déjà
  // filtrée sur ce tag (?tag=…), exactement comme un clic sur une puce ici.
  const [searchParams, setSearchParams] = useSearchParams();
  const [difficulty, setDifficulty] = useState(() => Number(searchParams.get('diff')) || 0);
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [selectedTag, setSelectedTag] = useState<string | null>(() => searchParams.get('tag'));
  const [status, setStatus] = useState<StatusFilter>(() => {
    const s = searchParams.get('status') as StatusFilter;
    return STATUS_FILTERS.includes(s) ? s : 'all';
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const s = searchParams.get('sort') as SortKey;
    return SORT_KEYS.includes(s) ? s : 'default';
  });
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sérialise l'état des filtres dans l'URL (remplacement : pas une entrée
  // d'historique par frappe). Tout défaut est omis pour garder l'URL propre.
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (selectedTag) params.set('tag', selectedTag);
    if (difficulty) params.set('diff', String(difficulty));
    if (status !== 'all') params.set('status', status);
    if (sortKey !== 'default') params.set('sort', sortKey);
    if (sortDir !== 'asc') params.set('dir', sortDir);
    setSearchParams(params, { replace: true });
  }, [query, selectedTag, difficulty, status, sortKey, sortDir, setSearchParams]);

  // Numéro stable par problème : position dans l'ordre d'origine de l'API, donc
  // indépendant des filtres/tri courants (un vrai repère, pas un rang d'affichage).
  const numberBySlug = useMemo(() => {
    const map = new Map<string, number>();
    (problems ?? []).forEach((p, i) => map.set(p.slug, i + 1));
    return map;
  }, [problems]);

  // Progression globale = problèmes résolus sur le total. La jauge ET le libellé
  // parlent désormais de la même chose (plus de mélange skills/problèmes).
  const progress = useMemo(() => {
    if (!problems || problems.length === 0) return null;
    const solvedProblems = problems.reduce((n, p) => n + (p.solved ? 1 : 0), 0);
    const totalProblems = problems.length;
    return {
      solvedProblems,
      totalProblems,
      pct: Math.round((solvedProblems / totalProblems) * 100),
    };
  }, [problems]);

  // Résolus / total par niveau de difficulté — petit tableau de bord ludique,
  // chaque pastille filtre aussi la liste sur ce niveau.
  const difficultyStats = useMemo(() => {
    return LEVELS.map((level) => {
      let solved = 0;
      let total = 0;
      for (const p of problems ?? []) {
        if (p.difficulty !== level) continue;
        total += 1;
        if (p.solved) solved += 1;
      }
      return { level, solved, total };
    });
  }, [problems]);

  // Compteurs par état, pour annoter le filtre segmenté (Tous · À faire · …).
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: 0, todo: 0, attempted: 0, solved: 0 };
    for (const p of problems ?? []) {
      counts.all += 1;
      if (p.solved) counts.solved += 1;
      else if (p.attempted) counts.attempted += 1;
      else counts.todo += 1;
    }
    return counts;
  }, [problems]);

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

  const allTags = useMemo(() => {
    if (!problems) return [];
    const tagsSet = new Set<string>();
    for (const p of problems) {
      for (const tag of p.tags) {
        tagsSet.add(tag);
      }
    }
    return Array.from(tagsSet).sort();
  }, [problems]);

  const visible = useMemo(() => {
    if (!problems) return null;
    const q = query.trim().toLowerCase();
    const filtered = problems.filter((p) => {
      const matchStatus =
        status === 'all'
          ? true
          : status === 'solved'
            ? p.solved
            : status === 'attempted'
              ? p.attempted && !p.solved
              : !p.solved && !p.attempted;
      return (
        matchStatus &&
        (!difficulty || p.difficulty === difficulty) &&
        (!selectedTag || p.tags.includes(selectedTag)) &&
        (!q ||
          p.title.toLowerCase().includes(q) ||
          p.tags.some((tag) => tag.toLowerCase().includes(q)))
      );
    });

    // Tri par défaut : les problèmes recommandés remontent en tête de liste
    // (le « prochain pas » naturel), puis l'ordre API est conservé. Sinon on
    // applique la clé de tri choisie dans le menu.
    if (sortKey === 'default') {
      return [...filtered].sort((a, b) => {
        const ra = recommendedSlugs.has(a.slug) ? 0 : 1;
        const rb = recommendedSlugs.has(b.slug) ? 0 : 1;
        return ra - rb;
      });
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'title':
          return dir * a.title.localeCompare(b.title, lang);
        case 'difficulty':
          return dir * (a.difficulty - b.difficulty);
        default:
          return 0;
      }
    });
  }, [problems, query, difficulty, selectedTag, status, sortKey, sortDir, lang, recommendedSlugs]);

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
    query !== '' || selectedTag !== null || difficulty !== 0 || status !== 'all';

  const clearFilters = () => {
    setQuery('');
    setSelectedTag(null);
    setDifficulty(0);
    setStatus('all');
  };

  const toggleTag = (tag: string) => setSelectedTag((cur) => (cur === tag ? null : tag));

  // Raccourcis clavier : « / » place le curseur dans la recherche, « r » ouvre
  // un problème au hasard. On laisse passer les combos navigateur (Ctrl+R…).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'r' || e.key === 'R') {
        pickRandom();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickRandom]);

  const statusLabel: Record<StatusFilter, string> = {
    all: t.problems.status_all,
    todo: t.problems.status_todo,
    attempted: t.problems.status_attempted,
    solved: t.problems.status_solved,
  };

  // Compteur affiché dans l'en-tête flottant (même emplacement que l'overline
  // de l'arbre) — la bascule Arbre/Liste reste donc parfaitement immobile.
  const overline = visible
    ? `${visible.length} ${visible.length > 1 ? t.problems.count_many : t.problems.count_one}`
    : t.problems.loading;

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
                className={`diff-stat${difficulty === s.level ? ' is-active' : ''}${
                  s.total > 0 && s.solved === s.total ? ' is-complete' : ''
                }`}
                onClick={() => setDifficulty((d) => (d === s.level ? 0 : s.level))}
                aria-pressed={difficulty === s.level}
              >
                <span className="diff-stat-dots" aria-hidden="true">
                  {LEVELS.map((i) => (
                    <span key={i} className={i <= s.level ? 'dot is-on' : 'dot'} />
                  ))}
                </span>
                <span className="diff-stat-name">{t.difficulty[s.level]}</span>
                <span className="diff-stat-count mono-label">
                  {s.solved}/{s.total}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Barre de filtres + tri, collée en haut au défilement. */}
        <div className="filters-bar">
          <div className="filters">
            <div className="filter-search-wrapper">
              <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                className="filter-search"
                placeholder={t.problems.search_placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setQuery('')}
                  aria-label={t.problems.clear_search}
                >
                  ✕
                </button>
              )}
            </div>

            <SearchableSelect
              value={selectedTag ?? ''}
              onChange={(val) => setSelectedTag(val ? String(val) : null)}
              options={[
                { value: '', label: t.problems.all_tags },
                ...allTags.map((tag) => ({ value: tag, label: tag })),
              ]}
              ariaLabel={t.problems.all_tags}
              noResultsText={t.problems.no_tags}
            />

            <div className="sort-control">
              <SearchableSelect
                value={sortKey}
                onChange={(val) => setSortKey(val as SortKey)}
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
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
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
                  className={`seg-btn${status === s ? ' is-active' : ''}`}
                  onClick={() => setStatus(s)}
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
                title={t.problems.random_title}
              >
                <span aria-hidden="true">🎲</span> {t.problems.random}
              </button>
            </div>
          </div>
        </div>

        {!visible ? (
          <p className="mono-label">{t.problems.loading}</p>
        ) : visible.length === 0 ? (
          <div className="empty-state-container">
            <p className="empty-state">{t.problems.empty}</p>
            {hasActiveFilters && (
              <button type="button" className="btn-clear-filters" onClick={clearFilters}>
                <span aria-hidden="true">✕</span> {t.problems.clear_filters}
              </button>
            )}
          </div>
        ) : (
          <div className="problem-cards">
            {visible.map((p) => {
              const recommended = recommendedSlugs.has(p.slug);
              return (
                <div
                  key={p.slug}
                  className={[
                    'problem-card',
                    p.solved ? 'is-solved' : '',
                    p.attempted && !p.solved ? 'is-attempted' : '',
                    recommended ? 'is-recommended' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {/* Lien « plein carte » : un clic n'importe où ouvre le
                      problème, sans imbriquer les puces interactives dans une
                      ancre (les chips de tag restent au-dessus, voir z-index). */}
                  <Link
                    to={`/problems/${p.slug}`}
                    className="pcard-cover"
                    aria-label={p.title}
                  />

                  <span className="pcard-rail">
                    <span className="pcard-index">
                      {String(numberBySlug.get(p.slug) ?? 0).padStart(2, '0')}
                    </span>
                    <StatusMark solved={p.solved} attempted={p.attempted} />
                  </span>

                  <div className="pcard-top">
                    <span className="pcard-title">{p.title}</span>
                    <span className="pcard-diff">
                      <DifficultyDots level={p.difficulty} />
                    </span>
                  </div>

                  <div className="pcard-meta">
                    {p.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`chip clickable-tag-chip${selectedTag === tag ? ' is-active' : ''}`}
                        onClick={() => toggleTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}

                    <span className="pcard-flag">
                      {recommended ? (
                        <span className="recommended-badge">{t.problems.recommended} →</span>
                      ) : p.solved ? (
                        <span className="flag-solved">{t.problems.solved}</span>
                      ) : p.attempted ? (
                        <span className="flag-attempted">{t.problems.attempted}</span>
                      ) : null}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
