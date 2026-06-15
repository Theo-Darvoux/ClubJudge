import { createContext, useContext } from 'react';
import type { ProblemSummary, SkillNode } from '../api';

export interface ProblemsDataValue {
  /** Liste complète des problèmes ; le filtrage de la vue liste est côté client. */
  problems: ProblemSummary[] | null;
  /** Nœuds de l'arbre de compétences. */
  skillTree: SkillNode[] | null;
}

export const ProblemsDataContext = createContext<ProblemsDataValue | null>(null);

export function useProblemsData(): ProblemsDataValue {
  const ctx = useContext(ProblemsDataContext);
  if (!ctx) throw new Error('useProblemsData must be used within ProblemsDataProvider');
  return ctx;
}
