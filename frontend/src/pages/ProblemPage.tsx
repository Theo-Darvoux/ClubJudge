import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { ProblemDetail } from '../api';
import { fmtMemoryMo } from '../format';
import { useMountedRef } from '../hooks';
import { attemptLabel } from '../problems/attempts';
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
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [hideStatement, setHideStatement] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [attempts, setAttempts] = useState<number | null>(null);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  // Incrémenté à CHAQUE AC (y compris une re-résolution plus rapide), pas
  // seulement à la première : sert à invalider le cache des solutions partagées
  // pour que la liste et le classement « plus rapide que » reflètent la nouvelle
  // soumission sans rechargement de page.
  const [acVersion, setAcVersion] = useState(0);

  const toggleStatement = () => {
    setHideStatement((prev) => !prev);
  };

  // Miroir de `problem.solved` lisible sans recréer `handleSolved` : ce dernier
  // ne dépend que de `slug`, donc reste stable quand `problem` change (sinon il
  // relancerait le minuteur de polling 1 s du Workbench, qui l'a en dépendance).
  const solvedRef = useRef(false);
  useEffect(() => {
    solvedRef.current = problem?.solved ?? false;
  }, [problem?.solved]);

  const isMountedRef = useMountedRef();

  const handleSolved = useCallback(
    (count: number, isEstimated: boolean) => {
      // Tout AC invalide le cache des solutions partagées (avant le garde-fou
      // « première résolution » ci-dessous, car une re-résolution plus rapide doit
      // aussi rafraîchir la liste).
      setAcVersion((v) => v + 1);
      // Première résolution seulement (transition non-résolu → résolu) : on fête
      // et on mémorise le nombre d'essais. Un AC ultérieur ne doit pas gonfler le
      // badge « résolu en N essais ».
      if (solvedRef.current) return;
      solvedRef.current = true;
      // Mises à jour optimistes immédiates (célébration + bascule « résolu »).
      setAttempts(count); // estimation immédiate (historique courant) pour la célébration
      setAttemptsLoading(isEstimated);
      setCelebrate(true);
      setProblem((p) => (p && !p.solved ? { ...p, solved: true, attempted: true } : p));
      // Compte fiable, non plafonné par l'historique chargé : on le récupère
      // côté serveur (endpoint léger) pour que le badge « résolu en N essais »
      // soit exact même après plus de 50 soumissions.
      api
        .solveStats(slug)
        .then((fresh) => {
          if (!isMountedRef.current) return;
          if (fresh.solved_attempts != null) setAttempts(fresh.solved_attempts);
          setAttemptsLoading(false);
          setProblem((p) => (p ? { ...p, solved_attempts: fresh.solved_attempts } : p));
        })
        .catch(() => {
          if (isMountedRef.current) {
            setAttemptsLoading(false);
          }
        });
    },
    // `isMountedRef` est une ref stable : la lister ne recrée pas `handleSolved`
    // (qui doit rester stable pour ne pas relancer le polling du Workbench).
    [slug, isMountedRef],
  );

  useEffect(() => {
    let active = true;
    api
      .problem(slug)
      .then((data) => {
        if (active) setProblem(data);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [slug, retryCount]);

  if (notFound) {
    return (
      <p className="empty-state">
        404 — <Link to="/problems/list">{t.problem.back}</Link>
      </p>
    );
  }
  if (loadError) {
    return (
      <div className="empty-state">
        <p>{t.problems.load_error}</p>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: '0.5rem' }}
          onClick={() => {
            setNotFound(false);
            setLoadError(false);
            setRetryCount((c) => c + 1);
          }}
        >
          {t.problems.retry}
        </button>
      </div>
    );
  }
  if (!problem) return <p className="mono-label">{t.problems.loading}</p>;

  // Essais à la première résolution : valeur en direct si on vient de résoudre,
  // sinon celle calculée par l'API (fiable entre sessions et appareils).
  const solvedAttempts = attempts ?? problem.solved_attempts ?? 0;
  // L'en-tête n'affiche le compte que CONFIRMÉ : tant qu'une estimation (historique
  // plafonné) est en cours de validation par /solve-stats, on s'abstient plutôt que
  // de montrer un sous-comptage qui sauterait à la valeur exacte une seconde après.
  // La célébration, elle, gère ce délai avec son propre indicateur de chargement.
  const showAttempts = problem.solved && !attemptsLoading && solvedAttempts > 0;

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
          {showAttempts && (
            <span className="attempt-chip" title={t.problem.attempt_badge_title}>
              {attemptLabel(t, solvedAttempts)}
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
            {fmtMemoryMo(problem.memory_limit_kb, lang)}
          </span>
          <button
            type="button"
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
        <div style={{ display: hideStatement ? 'none' : 'block' }}>
          <ProblemTabs problem={problem} slug={slug} acVersion={acVersion} />
        </div>
        <Workbench slug={slug} samples={problem.samples} onSolved={handleSolved} />
      </div>

      {celebrate && (
        <SolveCelebration
          problem={problem}
          attempts={attempts}
          loading={attemptsLoading}
          onClose={() => setCelebrate(false)}
        />
      )}
    </div>
  );
}
