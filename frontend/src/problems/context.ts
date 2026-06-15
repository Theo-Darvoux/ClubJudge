import { createContext, useContext } from 'react';
import type { ProblemSummary, SkillNode } from '../api';

export interface ProblemsDataValue {
  /** Liste complète des problèmes ; le filtrage de la vue liste est côté client. */
  problems: ProblemSummary[] | null;
  /** Nœuds de l'arbre de compétences. */
  skillTree: SkillNode[] | null;
  /**
   * Progression sur le catalogue de problèmes, calculée une seule fois et
   * partagée par les deux vues : la bascule arbre ↔ liste ne peut donc plus
   * afficher deux totaux résolus/total différents.
   */
  solvedProblems: number;
  totalProblems: number;
  /** Vrai si le chargement des problèmes a échoué (réseau / serveur). */
  error: boolean;
  /** Vrai si le chargement de l'arbre de compétences a échoué. */
  treeError: boolean;
  /** Relance le chargement des données partagées. */
  reload: () => void;
}

export const ProblemsDataContext = createContext<ProblemsDataValue | null>(null);

export function useProblemsData(): ProblemsDataValue {
  const ctx = useContext(ProblemsDataContext);
  if (!ctx) throw new Error('useProblemsData must be used within ProblemsDataProvider');
  return ctx;
}
