import { useI18n } from '../i18n/context';

/** Méta-ligne d'un contest : « N problèmes · M inscrits ». Partagée par la carte
 *  de la liste et l'en-tête du détail pour que les deux restent identiques. */
export function ContestMeta({
  problemCount,
  registeredCount,
}: {
  problemCount: number;
  registeredCount: number;
}) {
  const { t } = useI18n();
  return (
    <span className="contest-card-meta">
      {t.contests.problems_count(problemCount)} · {t.contests.registered_count(registeredCount)}
    </span>
  );
}
