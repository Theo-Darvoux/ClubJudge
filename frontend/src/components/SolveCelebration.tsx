import { useEffect, useMemo, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ProblemDetail, ProblemSummary } from '../api';
import { useI18n } from '../i18n/context';
import { ProblemsDataContext } from '../problems/context';
import { attemptLabel } from '../problems/attempts';
import { DifficultyDots } from './badges';

const CONFETTI_COLORS = ['#dcb7ff', '#7fe0a7', '#ffd27f', '#ff8b9e', '#ffab7f'];
const CONFETTI_COUNT = 70;

// Pseudo-aléatoire déterministe (pur) à partir d'une graine : évite Math.random
// pendant le rendu, tout en gardant des confettis bien éparpillés.
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => {
        // Bloc de graines disjoint par pièce (s+1..s+5) : sinon la graine d'une
        // pièce recouvre celle de la suivante et corrèle leurs trajectoires.
        const s = i * 5;
        return {
          key: i,
          left: seeded(s + 1) * 100,
          delay: seeded(s + 2) * 0.6,
          duration: 1.8 + seeded(s + 3) * 1.4,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          rotate: seeded(s + 4) * 360,
          drift: (seeded(s + 5) - 0.5) * 120,
        };
      }),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.key}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--drift' as string]: `${p.drift}px`,
            ['--spin' as string]: `${p.rotate}deg`,
          }}
        />
      ))}
    </div>
  );
}

/** Choisit jusqu'à trois problèmes « à faire ensuite » : non résolus, de
    difficulté proche et croissante, en privilégiant les tags partagés (les deux
    signaux visibles par l'utilisateur). */
function pickNext(
  all: ProblemSummary[],
  current: ProblemDetail,
): ProblemSummary[] {
  const score = (p: ProblemSummary) => {
    const harder = p.difficulty >= current.difficulty ? 0 : 50;
    const dist = Math.abs(p.difficulty - current.difficulty);
    const sharedTags = p.tags.filter((tg) => current.tags.includes(tg)).length;
    return harder + dist * 10 - sharedTags * 5;
  };
  return all
    .filter((p) => p.slug !== current.slug && !p.solved)
    .map((p) => ({ p, score: score(p) }))
    .sort((a, b) => a.score - b.score)
    .map((x) => x.p)
    .slice(0, 3);
}

export function SolveCelebration({
  problem,
  attempts,
  loading = false,
  onClose,
}: {
  problem: ProblemDetail;
  attempts: number | null;
  loading?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ctx = useContext(ProblemsDataContext);
  const [fetchedProblems, setFetchedProblems] = useState<ProblemSummary[] | null>(null);

  useEffect(() => {
    if (!ctx) {
      api.problems().then(setFetchedProblems).catch(() => {});
    }
  }, [ctx]);

  const problems = ctx?.problems ?? fetchedProblems;

  // Échap pour fermer, et fermeture auto des confettis laissée à l'overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const next = problems ? pickNext(problems, problem) : [];

  return (
    <div className="celebrate-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <Confetti />
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <p className="celebrate-kicker mono-label">{t.problem.celebrate_kicker}</p>
        <h2 className="celebrate-title">{t.problem.celebrate_title}</h2>
        {loading ? (
          <span className="attempt-badge is-loading" aria-hidden="true" />
        ) : (
          attempts != null && (
            <span className={`attempt-badge${attempts === 1 ? ' is-first' : ''}`}>
              {attemptLabel(t, attempts)}
            </span>
          )
        )}

        {next.length > 0 && (
          <div className="celebrate-next">
            <p className="mono-label">{t.problem.what_next}</p>
            <div className="next-list">
              {next.map((p) => (
                <Link
                  key={p.slug}
                  to={`/problems/${p.slug}`}
                  className="next-item"
                  onClick={onClose}
                >
                  <span className="next-title">{p.title}</span>
                  <DifficultyDots level={p.difficulty} />
                </Link>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="btn btn-ghost celebrate-close" onClick={onClose}>
          {t.problem.celebrate_continue}
        </button>
      </div>
    </div>
  );
}
