import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ContestPhase, ContestSummary } from '../api';
import { clientPhase, fmtWindow } from '../contest-utils';
import { cx } from '../cx';
import { useBoundaryClock } from '../hooks';
import { useI18n } from '../i18n/context';

type PhaseFilter = 'all' | 'running' | 'upcoming' | 'finished';

const PHASE_FILTERS: PhaseFilter[] = ['all', 'running', 'upcoming', 'finished'];

interface ContestCardProps {
  contest: ContestSummary;
  phase: ContestPhase;
  number: number;
}

function ContestCard({ contest, phase, number }: ContestCardProps) {
  const { t, lang } = useI18n();
  const isRegistered = contest.registered;

  return (
    <div
      className={cx(
        'contest-card',
        phase === 'running' && 'is-running',
        isRegistered && phase !== 'finished' && 'is-registered',
      )}
    >
      {/* Couverture « plein carte » : un clic n'importe où ouvre le contest */}
      <Link
        to={`/contests/${contest.slug}`}
        className="ccard-cover"
        aria-hidden="true"
        tabIndex={-1}
      />

      <span className="ccard-rail">
        <span className="ccard-index">
          {String(number).padStart(2, '0')}
        </span>
        {isRegistered && phase !== 'finished' ? (
          <span className="contest-status-mark is-registered" title={t.contests.registered_chip}>
            ✓
          </span>
        ) : phase === 'running' ? (
          <span className="contest-status-mark is-running" title={t.contests.live}>
            ●
          </span>
        ) : phase === 'upcoming' ? (
          <span className="contest-status-mark is-upcoming" title={t.contests.upcoming}>
            ◌
          </span>
        ) : (
          <span className="contest-status-mark is-finished" title={t.contests.finished}>
            ⬡
          </span>
        )}
      </span>

      <div className="ccard-top">
        <Link to={`/contests/${contest.slug}`} className="ccard-title">
          {contest.title}
        </Link>
        <div className="ccard-badges">
          {phase === 'running' && <span className="live-chip">{t.contests.live}</span>}
          {isRegistered && phase !== 'finished' && (
            <span className="registered-chip">{t.contests.registered_chip}</span>
          )}
        </div>
      </div>

      <div className="ccard-meta">
        <span className="chip mono-label">
          {fmtWindow(contest.start_at, contest.end_at, lang)}
        </span>
        <span className="chip">
          {t.contests.problems_count(contest.problem_count)}
        </span>
        <span className="chip">
          {t.contests.registered_count(contest.registered_count)}
        </span>

        <span className="ccard-flag">
          {phase === 'finished' ? (
            <span className="flag-finished">{t.contests.view_results}</span>
          ) : phase === 'running' && isRegistered ? (
            <span className="flag-running-registered">{t.contests.enter} →</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

export function ContestsHeader({ overline }: { overline: string }) {
  const { t } = useI18n();
  return (
    <header className="contests-head floating">
      <div className="contests-head-titles">
        <p className="mono-label">{overline}</p>
        <h1>{t.contests.title}</h1>
      </div>
    </header>
  );
}

export function ContestsPage() {
  const { t, lang } = useI18n();
  const [contests, setContests] = useState<ContestSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');

  useEffect(() => {
    api.contests().then(setContests).catch(() => {});
  }, []);

  const boundaries = useMemo(
    () =>
      contests
        ? contests.flatMap((c) => [Date.parse(c.start_at), Date.parse(c.end_at)])
        : [],
    [contests],
  );
  const now = useBoundaryClock(boundaries);

  // Numéro stable des contests indépendamment des filtres
  const numberBySlug = useMemo(() => {
    const list = contests ?? [];
    const map = new Map<string, number>();
    list.forEach((c, i) => {
      map.set(c.slug, i + 1);
    });
    return map;
  }, [contests]);

  const q = query.trim().toLowerCase();

  // Filtrage combiné recherche + phase
  const filtered = useMemo(() => {
    if (!contests) return [];
    return contests.filter((c) => {
      const matchQ = !q || c.title.toLowerCase().includes(q);
      const phase = clientPhase(c, now);
      const matchPhase = phaseFilter === 'all' || phase === phaseFilter;
      return matchQ && matchPhase;
    });
  }, [contests, q, phaseFilter, now]);

  // Compteurs des filtres de phase (réfléchissent la recherche active)
  const phaseCounts = useMemo(() => {
    const counts = { all: 0, running: 0, upcoming: 0, finished: 0 };
    for (const c of contests ?? []) {
      const matchQ = !q || c.title.toLowerCase().includes(q);
      if (matchQ) {
        counts.all += 1;
        counts[clientPhase(c, now)] += 1;
      }
    }
    return counts;
  }, [contests, q, now]);

  const sections = useMemo(() => {
    const phased = filtered.map((contest) => ({
      contest,
      phase: clientPhase(contest, now),
    }));
    const byStartAsc = (
      a: { contest: ContestSummary },
      b: { contest: ContestSummary },
    ) => a.contest.start_at.localeCompare(b.contest.start_at);
    const byEndAsc = (
      a: { contest: ContestSummary },
      b: { contest: ContestSummary },
    ) => a.contest.end_at.localeCompare(b.contest.end_at);
    const byEndDesc = (
      a: { contest: ContestSummary },
      b: { contest: ContestSummary },
    ) => -byEndAsc(a, b);

    return [
      {
        key: 'running',
        title: t.contests.running,
        items: phased.filter((x) => x.phase === 'running').sort(byEndAsc),
      },
      {
        key: 'upcoming',
        title: t.contests.upcoming,
        items: phased.filter((x) => x.phase === 'upcoming').sort(byStartAsc),
      },
      {
        key: 'finished',
        title: t.contests.finished,
        items: phased.filter((x) => x.phase === 'finished').sort(byEndDesc),
      },
    ];
  }, [filtered, now, t]);

  const clearFilters = () => {
    setQuery('');
    setPhaseFilter('all');
  };

  const phaseLabels: Record<PhaseFilter, string> = {
    all: t.contests.status_all,
    running: t.contests.running,
    upcoming: t.contests.upcoming,
    finished: t.contests.finished,
  };

  const overline = (() => {
    if (!contests) return t.contests.loading;
    const n = filtered.length;
    const plural = lang === 'en' ? n !== 1 : n > 1;
    return `${n} ${plural ? t.contests.count_many : t.contests.count_one}`;
  })();

  if (!contests) {
    return (
      <div className="contests-fullscreen">
        <ContestsHeader overline={t.contests.loading} />
        <div className="contests-scroll">
          <p className="mono-label">{t.contests.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="contests-fullscreen">
      <ContestsHeader overline={overline} />

      <div className="contests-scroll">
        {/* Barre de filtres + recherche */}
        <div className="filters-bar">
          <div className="filters">
            <div className="filter-search-wrapper">
              <svg
                className="search-icon"
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
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                className="filter-search"
                placeholder={t.contests.search_placeholder}
                aria-label={t.contests.search_placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setQuery('')}
                  aria-label={t.contests.clear_search}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Filtre de phase segmenté */}
          <div className="status-row">
            <div className="status-segmented" role="group" aria-label={t.contests.title}>
              {PHASE_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cx('seg-btn', phaseFilter === s && 'is-active')}
                  onClick={() => setPhaseFilter(s)}
                  aria-pressed={phaseFilter === s}
                >
                  {phaseLabels[s]}
                  <span className="seg-count">{phaseCounts[s]}</span>
                </button>
              ))}
            </div>

            <div className="status-row-actions">
              {(query || phaseFilter !== 'all') && (
                <button type="button" className="btn-clear-filters" onClick={clearFilters}>
                  <span aria-hidden="true">✕</span> {t.contests.clear_filters}
                </button>
              )}
            </div>
          </div>
        </div>

        {contests.length === 0 ? (
          <div className="empty-state-container">
            <p className="empty-state">{t.contests.empty}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state-container">
            <p className="empty-state">{t.contests.empty}</p>
            {(query || phaseFilter !== 'all') && (
              <button type="button" className="btn-clear-filters" onClick={clearFilters}>
                <span aria-hidden="true">✕</span> {t.contests.clear_filters}
              </button>
            )}
          </div>
        ) : (
          sections.map(
            (section) =>
              section.items.length > 0 && (
                <section key={section.key} className="contest-section">
                  <h2 className="mono-label contest-section-title">{section.title}</h2>
                  <div className="contest-cards">
                    {section.items.map(({ contest, phase }) => (
                      <ContestCard
                        key={contest.slug}
                        contest={contest}
                        phase={phase}
                        number={numberBySlug.get(contest.slug) ?? 0}
                      />
                    ))}
                  </div>
                </section>
              ),
          )
        )}
      </div>
    </div>
  );
}
