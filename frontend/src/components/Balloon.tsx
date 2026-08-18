/** Ballon ICPC en pixel-art : chaque problème résolu en vaut un, aligné à côté
 *  du nom de l'équipe au scoreboard. La couleur vient du label du problème (cf.
 *  balloonColor) pour que ligne ↔ colonne se lisent d'un coup d'œil. */

// Corps pixel-art du ballon (grille 5×5), une bande horizontale par ligne :
// [ligne, colonne de départ, largeur]. Chaque ligne du sprite est un segment
// continu, donc un seul <rect> par ligne suffit — mêmes pixels qu'un dessin
// pixel par pixel, mais ~22 rects ramenés à 5. Décisif au scoreboard, où chaque
// équipe affiche jusqu'à 5 ballons sur 100+ lignes (cf. TeamBalloons).
const BALLOON_BODY: [number, number, number][] = [
  [0, 1, 3],
  [1, 0, 5],
  [2, 0, 5],
  [3, 0, 5],
  [4, 1, 3],
];

/** Sprite ballon, dessiné pixel par pixel (viewBox 5×9, rendu net). Corps teinté
 *  par `color`, reflet clair, nœud et ficelle. */
export function Balloon({ color, title }: { color: string; title?: string }) {
  return (
    <svg
      className="balloon"
      viewBox="0 0 5 9"
      width="10"
      height="18"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      shapeRendering="crispEdges"
    >
      {BALLOON_BODY.map(([r, c, w]) => (
        <rect key={r} x={c} y={r} width={w} height="1" fill={color} />
      ))}
      {/* reflet */}
      <rect x="1" y="1" width="1" height="1" fill="rgba(255,255,255,0.55)" />
      {/* nœud */}
      <rect x="2" y="5" width="1" height="1" fill={color} opacity="0.75" />
      {/* ficelle */}
      <rect x="2" y="6" width="1" height="1" fill="var(--ink-dim)" />
      <rect x="1" y="7" width="1" height="1" fill="var(--ink-dim)" />
      <rect x="2" y="8" width="1" height="1" fill="var(--ink-dim)" />
    </svg>
  );
}
