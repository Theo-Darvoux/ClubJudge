import type { Submission, Verdict } from '../api';
import { useI18n } from '../i18n/context';
import { LEVELS, problemStatus } from '../problems/status';

export function DifficultyDotsInner({ level }: { level: number }) {
  return (
    <>
      {LEVELS.map((i) => (
        <span key={i} className={i <= level ? 'dot is-on' : 'dot'} />
      ))}
    </>
  );
}

export function DifficultyDots({ level }: { level: number }) {
  const { t } = useI18n();
  return (
    <span className="difficulty" data-level={level} title={t.difficulty[level]}>
      <span className="difficulty-dots" aria-hidden="true">
        <DifficultyDotsInner level={level} />
      </span>
      <span className="difficulty-label">{t.difficulty[level]}</span>
    </span>
  );
}

export function StatusMark({
  solved,
  attempted,
}: {
  solved: boolean;
  attempted: boolean;
}) {
  const { t } = useI18n();
  const state = problemStatus({ solved, attempted });
  if (state === 'solved') {
    return (
      <span className="status-mark is-solved" title={t.problems.solved}>
        ✓
      </span>
    );
  }
  if (state === 'attempted') {
    return (
      <span className="status-mark is-attempted" title={t.problems.attempted}>
        ◌
      </span>
    );
  }
  return <span className="status-mark" aria-hidden="true" />;
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useI18n();
  return <span className={`verdict-chip v-${verdict}`}>{t.verdict[verdict]}</span>;
}

export function VerdictChip({ submission }: { submission: Submission }) {
  const { t } = useI18n();
  if (submission.status !== 'done') {
    return (
      <span className="verdict-chip is-pending">
        <span className="pulse-dot" aria-hidden="true" />
        {t.verdict[submission.status]}
      </span>
    );
  }
  const verdict = submission.verdict ?? 'IE';
  return <span className={`verdict-chip v-${verdict}`}>{t.verdict[verdict]}</span>;
}
