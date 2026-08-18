import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Ref « monté » : permet à un gestionnaire asynchrone de ne pas écrire dans un
 *  composant déjà démonté (navigation, repli d'un panneau) quand sa requête se
 *  résout trop tard. Réarmée au remontage (StrictMode), libérée au démontage.
 *  Source unique partagée par tous les composants qui résolvent du réseau après
 *  un éventuel démontage (Workbench, page problème, exemples cliquables). */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** Sondage périodique conscient de la visibilité de l'onglet : exécute `tick`
 *  immédiatement, puis toutes les `intervalMs`, tant que `active` ET que l'onglet
 *  est au premier plan. En arrière-plan, on met en pause (aucune requête inutile
 *  ne part vers le serveur), et on refait un tick immédiat au retour au premier
 *  plan pour rattraper l'état manqué. `tick` peut changer d'identité sans relancer
 *  le minuteur : on en garde toujours la dernière version via une ref. */
export function usePolling(tick: () => void, intervalMs: number, active: boolean): void {
  const saved = useRef(tick);
  useEffect(() => {
    saved.current = tick;
  });

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = () => saved.current();
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const start = () => {
      stop();
      run();
      timer = setInterval(run, intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, active]);
}

/** Horloge « à frontières » : renvoie un instant qui ne se met à jour qu'au
 *  prochain horodatage de `boundaries` (départs/fins de contests), au lieu de
 *  re-rendre chaque seconde. Pour une vue dont l'affichage ne dépend que de la
 *  phase (puces « en cours », CTA), pas d'un compte à rebours fin : un seul
 *  minuteur jusqu'à la prochaine bascule, replanifié en chaîne après chaque tir.
 *  `boundaries` en ms epoch ; identité libre (la planification suit leur contenu,
 *  pas leur référence). */
export function useBoundaryClock(boundaries: number[]): number {
  const [now, setNow] = useState(() => Date.now());
  // Prochaine frontière strictement future, dérivée au rendu : recalculée quand les
  // frontières changent OU quand `now` avance au-delà de la précédente (après chaque
  // tir), ce qui replanifie en chaîne. `Infinity` ⇒ tout est passé, horloge figée.
  let next = Infinity;
  for (const t of boundaries) {
    if (t > now && t < next) next = t;
  }

  useEffect(() => {
    if (!Number.isFinite(next)) return;
    // +50 ms pour franchir nettement la frontière (Date.now() strictement au-delà).
    const id = setTimeout(() => setNow(Date.now()), next - Date.now() + 50);
    return () => clearTimeout(id);
  }, [next]);

  return now;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Animation FLIP par clé stable : à chaque changement de `dep`, chaque élément
 *  enregistré qui a bougé glisse de son ancienne position vers la nouvelle
 *  (Web Animations API, auto-nettoyée). Sert au scoreboard : quand le classement
 *  se réordonne, les lignes se déplacent au lieu de sauter. Renvoie une fabrique
 *  de `ref` à brancher sur chaque ligne, indexée par sa clé d'identité. */
export function useFlip(dep: unknown) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const next = new Map<string, number>();
    const animate = !prefersReducedMotion();
    nodes.current.forEach((el, key) => {
      const top = el.getBoundingClientRect().top;
      next.set(key, top);
      const old = positions.current.get(key);
      if (animate && old != null && old !== top) {
        el.animate(
          [{ transform: `translateY(${old - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
    });
    positions.current = next;
  }, [dep]);

  return useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(key, el);
      else nodes.current.delete(key);
    },
    [],
  );
}

export interface VirtualWindow {
  start: number; // index de la première ligne montée
  end: number; // index (exclu) de la dernière ligne montée
  padTop: number; // hauteur réservée au-dessus, en px (lignes sautées)
  padBottom: number; // hauteur réservée en dessous, en px
}

/** Fenêtrage par hauteur fixe : ne renvoie que la tranche de lignes visible dans
 *  `scrollRef` (plus une marge), afin de ne monter qu'une quinzaine de `<tr>` au
 *  lieu de 100+. C'est ce qui fait basculer l'ouverture du classement d'un long
 *  blocage (création de ~17 000 nœuds DOM, ballons SVG compris) à un montage
 *  quasi instantané. Repose sur des lignes **toutes de hauteur `rowHeight`** (cf.
 *  la hauteur fixe en CSS) : sans cela, les cales haut/bas dérivent. Les lignes
 *  hors fenêtre sont remplacées par deux `<tr>` cales qui préservent la longueur
 *  de l'ascenseur.
 *
 *  `focusIndex` (≥ 0) recentre l'ascenseur sur une ligne donnée (p. ex. « ma »
 *  ligne au classement) **une seule fois**, avant le premier peint : on monte
 *  directement la bonne tranche au lieu de peindre le haut de la liste, de la
 *  réduire, puis de sauter — soit trois rendus à l'ouverture ramenés à un seul. */
export function useVirtualRows(
  count: number,
  rowHeight: number,
  scrollRef: { current: HTMLElement | null },
  focusIndex = -1,
  overscan = 8,
): VirtualWindow {
  // Estimation initiale calée sur la ligne ciblée quand il y en a une : la première
  // réconciliation monte déjà des lignes autour d'elle (affinées au pixel près par
  // l'effet de mise en page ci-dessous, avant le peint), au lieu d'en créer 40 en
  // haut pour les jeter aussitôt.
  const [range, setRange] = useState(() =>
    focusIndex >= 0
      ? {
          start: Math.max(0, focusIndex - overscan * 2),
          end: Math.min(count, focusIndex + overscan * 2),
        }
      : { start: 0, end: Math.min(count, overscan * 2) },
  );
  const didFocus = useRef(false);

  // Mise en page avant peint : on positionne l'ascenseur (recentrage unique) puis on
  // calcule la fenêtre réelle dans la même passe, de sorte que React re-rende et ne
  // peigne qu'une fois — la bonne tranche, au bon endroit.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!didFocus.current && focusIndex >= 0) {
      el.scrollTop = focusIndex * rowHeight - el.clientHeight / 2 + rowHeight / 2;
      didFocus.current = true;
    }
    let raf = 0;
    const recompute = () => {
      raf = 0;
      const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan);
      const end = Math.min(count, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + overscan);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(recompute);
    };
    recompute();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [count, rowHeight, overscan, scrollRef, focusIndex]);

  // Garde-fou si `count` a rétréci entre deux rendus (filtre saisi) avant que
  // l'effet n'ait recalculé : on borne la fenêtre au nombre de lignes courant.
  const start = Math.min(range.start, count);
  const end = Math.min(range.end, count);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
  };
}
