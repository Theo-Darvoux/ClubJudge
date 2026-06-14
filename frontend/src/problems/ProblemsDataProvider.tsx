import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { api } from '../api';
import type { ProblemSummary, SkillNode } from '../api';
import { ProblemsDataContext } from './context';

/**
 * Route de mise en page (sans chemin) qui détient les données partagées par les
 * deux vues de la section Problèmes — arbre et liste. Elle reste montée tant
 * qu'on bascule de l'une à l'autre : les données ne sont chargées qu'une fois,
 * la bascule est donc instantanée (aucun re-fetch, aucun écran de chargement).
 *
 * Les pages problème (/problems/:slug) sont volontairement hors de cette route :
 * y passer démonte le provider, si bien que revenir à la liste ou à l'arbre
 * recharge l'état — le statut résolu/tenté reste à jour après une soumission.
 */
export function ProblemsDataProvider() {
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [skillTree, setSkillTree] = useState<SkillNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .problems({})
      .then((p) => !cancelled && setProblems(p))
      .catch(() => !cancelled && setProblems([]));
    api
      .categories()
      .then((c) => !cancelled && setCategories(c))
      .catch(() => {});
    api
      .skillTree()
      .then((t) => !cancelled && setSkillTree(t))
      .catch(() => !cancelled && setSkillTree([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ProblemsDataContext.Provider value={{ problems, categories, skillTree }}>
      <Outlet />
    </ProblemsDataContext.Provider>
  );
}
