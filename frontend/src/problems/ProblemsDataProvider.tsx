import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [skillTree, setSkillTree] = useState<SkillNode[] | null>(null);
  // Échec du chargement des problèmes (réseau / serveur) — distinct d'un
  // catalogue vide, pour que la vue liste propose un vrai « réessayer ».
  const [error, setError] = useState(false);
  // Échec du chargement de l'arbre de compétences
  const [treeError, setTreeError] = useState(false);
  // Incrémenté par reload() pour relancer l'effet de chargement.
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    // On réinitialise à null et sans erreur pour afficher l'état de chargement lors d'un retry.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset to loading state before async fetch
    setProblems(null);
    setSkillTree(null);
    setError(false);
    setTreeError(false);

    api
      .problems()
      .then((p) => {
        if (!cancelled) {
          setProblems(p);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProblems([]);
          setError(true);
        }
      });
    // L'arbre échoue indépendamment : un revers ici n'empêche pas la liste de
    // s'afficher (et inversement).
    api
      .skillTree()
      .then((t) => {
        if (!cancelled) {
          setSkillTree(t);
          setTreeError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkillTree([]);
          setTreeError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Compteurs de progression dérivés une seule fois ici (pas dans chaque vue) :
  // l'arbre et la liste lisent les mêmes résolus/total.
  const { solvedProblems, totalProblems } = useMemo(() => {
    const list = problems ?? [];
    let solved = 0;
    for (const p of list) if (p.solved) solved += 1;
    return { solvedProblems: solved, totalProblems: list.length };
  }, [problems]);

  return (
    <ProblemsDataContext.Provider
      value={{ problems, skillTree, error, treeError, reload, solvedProblems, totalProblems }}
    >
      <Outlet />
    </ProblemsDataContext.Provider>
  );
}
