import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { ProblemDetail } from '../api';
import { DifficultyDots } from '../components/badges';
import { ProblemTabs } from '../components/ProblemTabs';
import { SolveCelebration } from '../components/SolveCelebration';
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
  const [hideStatement, setHideStatement] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [attempts, setAttempts] = useState<number | null>(null);

  const toggleStatement = () => {
    setHideStatement((prev) => !prev);
  };

  const handleSolved = (count: number) => {
    setAttempts(count);
    setProblem((p) => {
      // Première résolution (transition non-résolu → résolu) : on fête et on
      // mémorise le nombre d'essais pour le badge persistant.
      if (p && !p.solved) {
        localStorage.setItem(`clubjudge.solvedAttempts.${slug}`, String(count));
        setCelebrate(true);
      }
      return p ? { ...p, solved: true, attempted: true } : p;
    });
  };

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

  const solvedAttempts =
    attempts ?? (Number(localStorage.getItem(`clubjudge.solvedAttempts.${slug}`)) || 0);

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
          {problem.solved && solvedAttempts > 0 && (
            <span className="attempt-chip" title={t.problem.attempt_badge_title}>
              {solvedAttempts === 1
                ? t.problem.first_try
                : t.problem.solved_in_tries(solvedAttempts)}
            </span>
          )}
        </h1>
        <div className="problem-meta">
          <DifficultyDots level={problem.difficulty} />
          {problem.tags.map((tag) => (
            <Link
              key={tag}
              to={`/problems/list?tag=${encodeURIComponent(tag)}`}
              className="chip chip-link"
              title={t.problem.tag_explore(tag)}
            >
              {tag}
            </Link>
          ))}
          <span className="limits">
            {t.problem.time_limit} {problem.time_limit_s} s · {t.problem.memory_limit}{' '}
            {Math.round(problem.memory_limit_kb / 1024)} Mo
          </span>
          <button
            className="btn-toggle-statement"
            onClick={toggleStatement}
            aria-label={hideStatement ? t.problem.show_statement : t.problem.hide_statement}
          >
            {hideStatement ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span>{t.problem.show_statement}</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
                <span>{t.problem.hide_statement}</span>
              </>
            )}
          </button>
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

      <div className={`problem-columns ${hideStatement ? 'problem-columns--single' : ''}`}>
        {!hideStatement && <ProblemTabs problem={problem} slug={slug} />}
        <Workbench slug={slug} samples={problem.samples} onSolved={handleSolved} />
      </div>

      {celebrate && (
        <SolveCelebration
          problem={problem}
          attempts={attempts}
          onClose={() => setCelebrate(false)}
        />
      )}
    </div>
  );
}
