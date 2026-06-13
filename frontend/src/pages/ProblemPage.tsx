import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { ProblemDetail } from '../api';
import { DifficultyDots } from '../components/badges';
import { ProblemTabs } from '../components/ProblemTabs';
import { Workbench } from '../components/Workbench';
import { fmtCountdown, useNow } from '../contest-utils';
import { useI18n } from '../i18n/context';
import 'katex/dist/katex.min.css';

function ContestEnd({ endAt }: { endAt: string }) {
  const { lang } = useI18n();
  const now = useNow();
  return <>{fmtCountdown(Date.parse(endAt) - now, lang)}</>;
}

export function ProblemPage() {
  const { slug = '' } = useParams();
  // key force un remontage propre quand on navigue entre deux problèmes.
  return <ProblemView key={slug} slug={slug} />;
}

function ProblemView({ slug }: { slug: string }) {
  const { t, lang } = useI18n();
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .problem(slug)
      .then(setProblem)
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return (
      <p className="empty-state">
        404 — <Link to="/problems/list">{t.problem.back}</Link>
      </p>
    );
  }
  if (!problem) return <p className="mono-label">{t.problems.loading}</p>;

  return (
    <div className="problem-page">
      <nav className="breadcrumb">
        {problem.contest ? (
          <Link to={`/contests/${problem.contest.slug}`}>
            {t.contest_banner.back_to_contest}
          </Link>
        ) : (
          <Link to="/problems/list">{t.problem.back}</Link>
        )}
      </nav>

      {problem.contest && (
        <aside className="contest-banner" title={t.contest_banner.conditions}>
          <span className="live-chip">{t.contests.live}</span>
          <span className="contest-banner-text">
            <strong>{problem.contest.title}</strong>
            {' · '}
            {t.contest_banner.in_contest(problem.contest.label)}
          </span>
          <span className="mono-label contest-banner-end">
            {t.contest_banner.ends} <ContestEnd endAt={problem.contest.end_at} />
          </span>
        </aside>
      )}

      <header className="problem-head">
        <h1>
          {problem.title}
          {problem.solved && (
            <span className="solved-badge" title={t.problems.solved}>
              ✓ {t.problems.solved}
            </span>
          )}
        </h1>
        <div className="problem-meta">
          <DifficultyDots level={problem.difficulty} />
          <span className="chip">{problem.category}</span>
          {problem.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
          <span className="limits">
            {t.problem.time_limit} {problem.time_limit_s} s · {t.problem.memory_limit}{' '}
            {Math.round(problem.memory_limit_kb / 1024)} Mo
          </span>
        </div>
        {problem.articles.length > 0 && (
          <p className="problem-course-links">
            {t.problem.covered_by}{' '}
            {problem.articles.map((a, i) => (
              <span key={`${a.course_slug}/${a.article_slug}`}>
                {i > 0 && ' · '}
                <Link to={`/courses/${a.course_slug}/${a.article_slug}`}>
                  {lang === 'en' && a.title_en ? a.title_en : a.title_fr}
                </Link>
              </span>
            ))}
          </p>
        )}
      </header>

      <div className="problem-columns">
        <ProblemTabs problem={problem} slug={slug} />
        <Workbench
          slug={slug}
          onSolved={() =>
            setProblem((p) => (p ? { ...p, solved: true, attempted: true } : p))
          }
        />
      </div>
    </div>
  );
}
