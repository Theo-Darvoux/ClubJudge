import type { Submission } from '../api';
import { useI18n } from '../i18n/context';

export function DifficultyDots({ level }: { level: number }) {
  const { t } = useI18n();
  return (
    <span className="difficulty" title={t.difficulty[level]}>
      <span className="difficulty-dots" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={i <= level ? 'dot is-on' : 'dot'} />
        ))}
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
  if (solved) {
    return (
      <span className="status-mark is-solved" title={t.problems.solved}>
        ✓
      </span>
    );
  }
  if (attempted) {
    return (
      <span className="status-mark is-attempted" title={t.problems.attempted}>
        ◌
      </span>
    );
  }
  return <span className="status-mark" aria-hidden="true" />;
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
