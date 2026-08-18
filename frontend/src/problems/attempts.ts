import type { Submission, Verdict } from '../api';
import type { fr } from '../i18n/fr';

/** Verdicts qui ne comptent pas comme une vraie tentative jugée : CE n'a jamais
    été exécuté, IE est un incident du juge (faute du serveur, pas du membre).
    Doit rester identique au `NON_ATTEMPT_VERDICTS` du backend
    (backend/app/judge/types.py) ; backend/tests/test_attempt_parity.py échoue si
    les deux divergent, ce qui désaccorderait le badge « résolu en N essais ». */
export const NON_ATTEMPT_VERDICTS: readonly Verdict[] = ['CE', 'IE'];

/** Borne de l'historique chargé côté client, identique à la limite serveur
    (MAX_HISTORY_ROWS dans backend/app/submissions.py, vérifié par le même test de
    parité). Sert à la fois à plafonner l'historique en mémoire et à savoir si le
    comptage d'essais ci-dessous est partiel (donc à confirmer via /solve-stats). */
export const MAX_HISTORY_ROWS = 50;

/** Une soumission JUGÉE qui compte comme une tentative (même définition que la
    pénalité du classement). Source unique du « qu'est-ce qu'un essai » côté client. */
export function countsAsAttempt(s: Pick<Submission, 'status' | 'verdict'>): boolean {
  return (
    s.status === 'done' && (s.verdict === null || !NON_ATTEMPT_VERDICTS.includes(s.verdict))
  );
}

/** Insère une soumission en tête de l'historique : déduplique par id (une mise à
    jour de polling remplace la version précédente) et plafonne à MAX_HISTORY_ROWS,
    pour rester aligné sur ce que renvoie le serveur — sinon la liste grossirait sans
    fin en session et fausserait le drapeau « estimation partielle » ci-dessous. */
export function prependSubmission(history: Submission[], sub: Submission): Submission[] {
  return [sub, ...history.filter((s) => s.id !== sub.id)].slice(0, MAX_HISTORY_ROWS);
}

/** Nombre d'essais jugés jusqu'au premier AC inclus, estimé depuis l'historique
    courant. `isEstimated` vaut vrai quand l'historique est plafonné (le compte
    peut alors être incomplet et doit être confirmé côté serveur). Règle centralisée
    pour qu'elle ne s'écrive qu'une fois (cf. solve_stats_one côté backend). */
export function estimateSolvedAttempts(
  history: Submission[],
  accepted: Submission,
): { attempts: number; isEstimated: boolean } {
  // L'AC final est lui-même un essai compté : on ajoute 1 aux tentatives antérieures.
  const prior = history.filter((s) => s.id < accepted.id && countsAsAttempt(s)).length;
  return { attempts: prior + 1, isEstimated: history.length >= MAX_HISTORY_ROWS };
}

/** Libellé du badge « essais jusqu'au premier Accepté » (1 essai → « du premier
    coup », sinon « résolu en N essais »). Source unique partagée par l'en-tête de
    la page problème et la célébration, pour que la règle ne s'écrive qu'une fois. */
export function attemptLabel(t: typeof fr, attempts: number): string {
  return attempts === 1 ? t.problem.first_try : t.problem.solved_in_tries(attempts);
}
