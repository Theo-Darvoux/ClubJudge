import type { ProblemSummary } from '../api';

// Échelle de difficulté (1 → 5), partagée par le rendu des puces et le filtrage
// de la vue liste, pour qu'il n'existe qu'une seule définition des niveaux.
export const LEVELS: number[] = [1, 2, 3, 4, 5];

// État d'un problème dérivé de ses drapeaux — source unique de vérité partagée
// par la vue liste (compteurs, filtre segmenté, classes de carte) et le marqueur
// de statut, pour que la précédence résolu > tenté > à faire ne soit écrite
// qu'à un seul endroit.
export type ProblemState = 'solved' | 'attempted' | 'todo';

export function problemStatus(p: Pick<ProblemSummary, 'solved' | 'attempted'>): ProblemState {
  if (p.solved) return 'solved';
  if (p.attempted) return 'attempted';
  return 'todo';
}
