import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ContestSummary } from '../api';
import { fmtWindow } from '../contest-utils';
import { useI18n } from '../i18n/context';

function ContestCard({ contest }: { contest: ContestSummary }) {
  const { t, lang } = useI18n();
  return (
    <Link className="contest-card" to={`/contests/${contest.slug}`}>
      <div className="contest-card-main">
        <h2>{contest.title}</h2>
        <span className="mono-label">{fmtWindow(contest.start_at, contest.end_at, lang)}</span>
        <span className="contest-card-meta">
          {t.contests.problems_count(contest.problem_count)} ·{' '}
          {t.contests.registered_count(contest.registered_count)}
        </span>
      </div>
      <div className="contest-card-side">
        {contest.phase === 'running' && (
          <span className="live-chip">{t.contests.live}</span>
        )}
        {contest.registered && contest.phase !== 'finished' && (
          <span className="registered-chip">{t.contests.registered_chip}</span>
        )}
        <span className="contest-card-cta mono-label">
          {contest.phase === 'finished'
            ? t.contests.view_results
            : contest.phase === 'running' && contest.registered
              ? t.contests.enter
              : '→'}
        </span>
      </div>
    </Link>
  );
}

export function ContestsPage() {
  const { t } = useI18n();
  const [contests, setContests] = useState<ContestSummary[] | null>(null);

  useEffect(() => {
    api.contests().then(setContests).catch(() => {});
  }, []);

  if (!contests) return <p className="mono-label">{t.contests.loading}</p>;

  const sections: { key: string; title: string; items: ContestSummary[] }[] = [
    {
      key: 'running',
      title: t.contests.running,
      items: contests.filter((c) => c.phase === 'running'),
    },
    {
      key: 'upcoming',
      title: t.contests.upcoming,
      items: contests
        .filter((c) => c.phase === 'upcoming')
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    },
    {
      key: 'finished',
      title: t.contests.finished,
      items: contests.filter((c) => c.phase === 'finished'),
    },
  ];

  return (
    <div className="contests-page">
      <header className="page-head">
        <div className="page-head-titles">
          <h1>{t.contests.title}</h1>
        </div>
      </header>

      {contests.length === 0 && <p className="empty-state">{t.contests.empty}</p>}

      {sections.map(
        (section) =>
          section.items.length > 0 && (
            <section key={section.key} className="contest-section">
              <h2 className="mono-label contest-section-title">{section.title}</h2>
              <div className="contest-cards">
                {section.items.map((c) => (
                  <ContestCard key={c.slug} contest={c} />
                ))}
              </div>
            </section>
          ),
      )}
    </div>
  );
}
