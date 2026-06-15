import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import type { SkillNode, SkillState } from '../api';
import { DifficultyDots, StatusMark } from '../components/badges';

import { ProblemsHeader } from '../components/ViewToggle';
import { useI18n } from '../i18n/context';
import { useProblemsData } from '../problems/context';

const HEX_R = 46;
const PAD = 110;
// Échelle de confort à l'ouverture et au recentrage : l'hexagone fait ~92px.
const INITIAL_SCALE = 1;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.6;

function hexPoints(r: number): string {
  // Hexagone pointe en haut, comme les pastilles de difficulté.
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

// Precomputed static points to avoid calculations on every frame/render
const HEX_POINTS_BASE = hexPoints(HEX_R);
const HEX_POINTS_HALO = hexPoints(HEX_R + 7);
const HEX_POINTS_INNER = hexPoints(HEX_R - 5);

// Distance centre → bord de l'hexagone (pointe en haut) dans la direction theta, pour un rayon r donné.
function hexEdgeDistance(theta: number, r: number): number {
  const sector = Math.PI / 3;
  const m = ((theta % sector) + sector) % sector; // [0, 60°)
  const dev = m > sector / 2 ? m - sector : m; // écart à l'arête la plus proche
  const inradius = r * Math.cos(Math.PI / 6);
  return inradius / Math.cos(dev);
}

// Segment de bord à bord entre deux nœuds, en s'alignant sur leur contour extérieur réel.
function edgeSegment(fromNode: SkillNode, toNode: SkillNode) {
  const theta = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);

  // Pour les nœuds recommandés ou maîtrisés, le contour visuel est le halo (rayon + 7)
  const rA = (fromNode.state === 'mastered' || fromNode.state === 'recommended')
    ? HEX_R + 7
    : HEX_R;
  const rB = (toNode.state === 'mastered' || toNode.state === 'recommended')
    ? HEX_R + 7
    : HEX_R;

  const da = hexEdgeDistance(theta, rA);
  const db = hexEdgeDistance(theta + Math.PI, rB);

  return {
    x1: fromNode.x + ca * da,
    y1: fromNode.y + sa * da,
    x2: toNode.x - ca * db,
    y2: toNode.y - sa * db,
  };
}

function LegendIcon({ state }: { state: SkillState }) {
  if (state === 'mastered') {
    return (
      <svg className="legend-svg is-mastered" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <polygon
          points="8,1.5 14,5 14,11 8,14.5 2,11 2,5"
          fill="rgba(255, 208, 122, 0.15)"
          stroke="var(--gold)"
          strokeWidth="1.6"
        />
        <path
          d="M5.5,8 L7,9.5 L10.5,6"
          fill="none"
          stroke="var(--gold)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === 'recommended') {
    return (
      <svg className="legend-svg is-recommended" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <polygon
          points="8,1.5 14,5 14,11 8,14.5 2,11 2,5"
          fill="var(--lav-08)"
          stroke="var(--lav)"
          strokeWidth="1.6"
        />
        <circle cx="8" cy="8" r="1.8" fill="var(--lav)" />
      </svg>
    );
  }
  // not_ready (À explorer)
  return (
    <svg className="legend-svg is-not-ready" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <polygon
        points="8,1.5 14,5 14,11 8,14.5 2,11 2,5"
        fill="rgba(13, 13, 21, 0.6)"
        stroke="var(--lav-25)"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function SkillTreePage() {
  const { t, lang } = useI18n();
  // Nœuds partagés avec la vue liste (chargés une fois par le provider) : la
  // bascule liste → arbre est instantanée, sans re-fetch.
  const { skillTree: nodes } = useProblemsData();
  // Le contenu de l'arbre reste masqué jusqu'au premier centrage : en navigation
  // client (liste → arbre), onInit recentre après le premier paint, ce qui
  // laissait voir une frame de l'arbre à sa position brute (coin haut-gauche).
  const [centered, setCentered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // Dernier nœud affiché : reste monté pendant l'animation de fermeture du
  // panneau, pour un fondu propre plutôt qu'un vidage brutal.
  const [panelNode, setPanelNode] = useState<SkillNode | undefined>(undefined);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactStopTimer = useRef<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [scale, setScale] = useState(INITIAL_SCALE);

  const isMaxScale = scale >= MAX_SCALE - 0.001;
  const isMinScale = scale <= MIN_SCALE + 0.001;

  // Pendant un geste, on bascule .is-interacting sur le conteneur (en
  // impératif, sans re-render du gros SVG) : le CSS promeut alors le contenu en
  // couche compositeur et gèle les animations en boucle. Pan/zoom deviennent du
  // pur compositing GPU au lieu d'un repaint complet du SVG à chaque frame.
  const beginInteract = useCallback(() => {
    if (interactStopTimer.current !== null) {
      clearTimeout(interactStopTimer.current);
      interactStopTimer.current = null;
    }
    containerRef.current?.classList.add('is-interacting');
  }, []);
  const endInteract = useCallback(() => {
    if (interactStopTimer.current !== null) clearTimeout(interactStopTimer.current);
    // Léger délai : enchaîner molette → glissement ne fait pas clignoter la
    // promotion de couche, et les animations reprennent en douceur.
    interactStopTimer.current = window.setTimeout(() => {
      containerRef.current?.classList.remove('is-interacting');
      interactStopTimer.current = null;
    }, 180);
  }, []);
  useEffect(
    () => () => {
      if (interactStopTimer.current !== null) clearTimeout(interactStopTimer.current);
    },
    [],
  );

  const handleMouseEnter = useCallback((slug: string) => {
    if (containerRef.current?.classList.contains('is-interacting')) return;
    setHovered(slug);
  }, []);

  const handleMouseLeave = useCallback((slug: string) => {
    if (containerRef.current?.classList.contains('is-interacting')) return;
    setHovered((h) => (h === slug ? null : h));
  }, []);

  // Sélection initiale (une seule fois, dès que les nœuds sont là) : le premier
  // nœud recommandé — la réponse à « et maintenant, je travaille quoi ? ».
  if (!initialized && nodes && nodes.length > 0) {
    setInitialized(true);
    const next = nodes.find((n) => n.state === 'recommended') ?? nodes[0];
    if (next) {
      setSelected(next.slug);
      setPanelNode(next);
    }
  }

  // Échap referme le panneau flottant pour admirer l'arbre en grand.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const byId = useMemo(() => new Map((nodes ?? []).map((n) => [n.slug, n])), [nodes]);

  const roots = useMemo(() => (nodes ?? []).filter((n) => n.requires.length === 0), [nodes]);

  // Progression globale : combien de compétences maîtrisées, combien de
  // problèmes résolus (dédupliqués, un même problème pouvant figurer dans
  // plusieurs nœuds). C'est le « cap » affiché dans le HUD.
  const progress = useMemo(() => {
    const all = nodes ?? [];
    const masteredSkills = all.filter((n) => n.state === 'mastered').length;
    const seen = new Map<string, boolean>();
    for (const n of all) {
      for (const p of n.problems) {
        if (!seen.has(p.slug) || p.solved) seen.set(p.slug, p.solved);
      }
    }
    let solvedProblems = 0;
    seen.forEach((solved) => {
      if (solved) solvedProblems += 1;
    });
    const totalSkills = all.length;
    return {
      masteredSkills,
      totalSkills,
      solvedProblems,
      totalProblems: seen.size,
      pct: totalSkills ? Math.round((masteredSkills / totalSkills) * 100) : 0,
    };
  }, [nodes]);

  // Cadre du SVG (rendu à l'échelle 1:1 en px) — partagé par le calcul de
  // centrage et le viewBox du rendu.
  const bounds = useMemo(() => {
    if (!nodes?.length) return null;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - PAD;
    const minY = Math.min(...ys) - PAD;
    return {
      minX,
      minY,
      width: Math.max(...xs) - minX + PAD,
      height: Math.max(...ys) - minY + PAD + 20, // marge pour les noms sous les nœuds
    };
  }, [nodes]);

  // Centre la vue sur un nœud. animationTime=0 => saut immédiat (cadrage
  // initial), >0 => transition douce. Par défaut on conserve l'échelle courante
  // (clic sur un nœud = déplacement caméra, sans zoom/dézoom) ; on ne force une
  // échelle que pour le cadrage initial et le bouton recentrer.
  const focusNode = useCallback(
    (node: SkillNode, animationTime: number, scale?: number) => {
      const ref = transformRef.current;
      const wrap = ref?.instance.wrapperComponent;
      if (!ref || !wrap || !bounds) return;
      const sc = scale ?? ref.state.scale;
      const x = wrap.offsetWidth / 2 - (node.x - bounds.minX) * sc;
      const y = wrap.offsetHeight / 2 - (node.y - bounds.minY) * sc;
      // Recentrage animé : on promeut la couche le temps de la transition pour
      // que ce déplacement programmatique soit lui aussi composité, pas repeint.
      if (animationTime > 0) {
        beginInteract();
        window.setTimeout(endInteract, animationTime);
      }
      ref.setTransform(x, y, sc, animationTime);
    },
    [bounds, beginInteract, endInteract],
  );

  // Sélectionne un nœud : on alimente aussi panelNode, qui reste affiché
  // pendant l'animation de fermeture (setSelected(null) ne le vide pas), et on
  // recentre la vue dessus en douceur — même geste que le bouton recentrer.
  const select = useCallback(
    (node: SkillNode) => {
      setSelected(node.slug);
      setPanelNode(node);
      focusNode(node, 400);
    },
    [focusNode],
  );

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGGElement>) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<SVGGElement>) => {
    const touch = e.touches[0];
    if (touch) {
      dragStartRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, []);

  const handleNodeClick = useCallback(
    (e: React.MouseEvent<SVGGElement>, node: SkillNode) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
          return; // Ignore selection if dragging occurred
        }
      }
      select(node);
    },
    [select],
  );

  const name = useCallback(
    (n: SkillNode) => (lang === 'en' && n.name_en ? n.name_en : n.name_fr),
    [lang],
  );

  const description = (n: SkillNode) =>
    lang === 'en' && n.description_en ? n.description_en : n.description_fr;

  // Nœud sous le projecteur : survol prioritaire, sinon sélection.
  const focus = hovered ?? selected;

  // Ensemble surligné : le nœud au centre + toute sa chaîne de prérequis en
  // amont. C'est « le chemin pour en arriver là » qui s'illumine.
  const pathSet = useMemo(() => {
    const set = new Set<string>();
    if (!focus) return set;
    const stack = [focus];
    while (stack.length) {
      const slug = stack.pop()!;
      if (set.has(slug)) continue;
      set.add(slug);
      const node = byId.get(slug);
      node?.requires.forEach((req) => stack.push(req));
    }
    return set;
  }, [focus, byId]);

  // Nœud sur lequel on cadre à l'ouverture : la racine de l'arbre (« Premiers
  // pas »), point d'entrée naturel d'où tout part. On s'y positionne dès l'init
  // de la lib (cf. onInit). La sélection du panneau, elle, reste sur le nœud
  // recommandé (« et maintenant, je travaille quoi ? »).
  const startNode = nodes
    ? nodes.find((n) => n.slug === 'premiers-pas') ??
      nodes.find((n) => n.requires.length === 0) ??
      nodes[0]
    : undefined;

  const svgContent = useMemo(() => {
    if (!bounds || !nodes) return null;
    const { minX, minY, width, height } = bounds;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`${minX} ${minY} ${width} ${height}`}
        role="group"
        aria-label={t.skills.overline}
        className={focus ? 'is-focusing' : ''}
      >
        <defs>
          <radialGradient id="skill-center-glow">
            <stop offset="0%" stopColor="var(--lav)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--lav)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="mastered-hex-bg" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="rgba(255, 208, 122, 0.15)" />
            <stop offset="80%" stopColor="var(--bg-raised)" />
            <stop offset="100%" stopColor="var(--bg-raised)" />
          </radialGradient>
          <radialGradient id="gold-radial-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </radialGradient>
          {nodes.flatMap((n) =>
            n.requires.map((req) => {
              const from = byId.get(req);
              if (!from) return null;
              const fromGolden = from.state === 'mastered';
              const toGolden = n.state === 'mastered';
              if (fromGolden === toGolden) return null;

              const seg = edgeSegment(from, n);
              const startColor = fromGolden ? 'var(--gold)' : 'var(--lav)';
              const endColor = toGolden ? 'var(--gold)' : 'var(--lav)';

              return (
                <linearGradient
                  key={`grad-${req}-${n.slug}`}
                  id={`grad-${req}-${n.slug}`}
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor={startColor} />
                  <stop offset="100%" stopColor={endColor} />
                </linearGradient>
              );
            })
          )}
        </defs>
        {roots.map((n) => (
          <circle
            key={n.slug}
            cx={n.x}
            cy={n.y}
            r={PAD * 1.9}
            fill="url(#skill-center-glow)"
          />
        ))}
        {nodes.flatMap((n) =>
          n.requires.map((req) => {
            const from = byId.get(req);
            if (!from) return null;
            const onPath = focus !== null && pathSet.has(req) && pathSet.has(n.slug);
            const dim = focus !== null && !onPath;
            const flow = from.state === 'mastered' && n.state === 'recommended';
            const seg = edgeSegment(from, n);

            const fromGolden = from.state === 'mastered';
            const toGolden = n.state === 'mastered';
            let strokeVal: string;
            if (fromGolden && toGolden) {
              strokeVal = 'var(--gold)';
            } else if (!fromGolden && !toGolden) {
              strokeVal = 'var(--lav)';
            } else {
              strokeVal = `url(#grad-${req}-${n.slug})`;
            }

            return (
              <line
                key={`${req}->${n.slug}`}
                className={[
                  'skill-edge',
                  from.state === 'mastered' ? 'is-lit' : '',
                  flow ? 'is-flow' : '',
                  onPath ? 'is-path' : '',
                  dim ? 'is-dim' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                style={{ stroke: strokeVal }}
              />
            );
          }),
        )}
        {nodes.map((n) => {
          const dim = focus !== null && !pathSet.has(n.slug);
          return (
            <g
              key={n.slug}
              id={`skill-node-${n.slug}`}
              className={[
                'skill-node',
                `is-${n.state}`,
                selected === n.slug ? 'is-selected' : '',
                dim ? 'is-dim' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              transform={`translate(${n.x} ${n.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${name(n)} — ${t.skills.state[n.state]}`}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onClick={(e) => handleNodeClick(e, n)}
              onMouseEnter={() => handleMouseEnter(n.slug)}
              onMouseLeave={() => handleMouseLeave(n.slug)}
              onFocus={() => handleMouseEnter(n.slug)}
              onBlur={() => handleMouseLeave(n.slug)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(n);
                }
              }}
            >
              <polygon className="skill-hex-halo" points={HEX_POINTS_HALO} />
              <polygon className="skill-hex" points={HEX_POINTS_BASE} />
              {n.state === 'mastered' && (
                <polygon className="skill-hex-inner" points={HEX_POINTS_INNER} />
              )}
              {n.state === 'mastered' ? (
                <g className="skill-mastered-badge">
                  {/* Radial glow around the badge */}
                  <circle r="18" fill="url(#gold-radial-glow)" />
                  {/* Circular golden ring */}
                  <circle r="15" fill="none" stroke="var(--gold)" strokeWidth="1.6" />
                  {/* Neon glow effect line */}
                  <path
                    className="mastered-checkmark-glow"
                    d="M-6.5 -0.5 L-1.5 4.5 L6.5 -3.5"
                    fill="none"
                    stroke="var(--gold)"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.3"
                  />
                  {/* Animated sharp checkmark */}
                  <path
                    className="mastered-checkmark-path"
                    d="M-6.5 -0.5 L-1.5 4.5 L6.5 -3.5"
                    fill="none"
                    stroke="var(--gold)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              ) : (
                <text className="skill-progress" y="2">
                  {`${n.solved_count}/${n.mastery_threshold}`}
                </text>
              )}
              <text className="skill-name" y={HEX_R + 24}>
                {name(n)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }, [
    bounds,
    nodes,
    roots,
    byId,
    focus,
    pathSet,
    selected,
    select,
    handleMouseDown,
    handleTouchStart,
    handleNodeClick,
    handleMouseEnter,
    handleMouseLeave,
    name,
    t.skills,
  ]);

  if (nodes === null) {
    return (
      <div className="skilltree-fullscreen is-message">
        <p className="mono-label">{t.skills.loading}</p>
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <div className="skilltree-fullscreen is-message">
        <ProblemsHeader overline={t.skills.overline} />
        <p className="empty-state">{t.skills.empty}</p>
      </div>
    );
  }

  const current = selected ? byId.get(selected) : undefined;

  return (
    <div
      ref={containerRef}
      className={`skilltree-fullscreen${centered ? '' : ' is-precenter'}`}
    >
      <TransformWrapper
        ref={transformRef}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        initialScale={INITIAL_SCALE}
        limitToBounds={false}
        doubleClick={{ disabled: true }}
        smooth={false}
        wheel={{ step: 0.06 }}
        panning={{ velocityDisabled: false }}
        zoomAnimation={{ size: 0 }}
        onPanningStart={beginInteract}
        onPanningStop={endInteract}
        onZoomStart={beginInteract}
        onZoomStop={endInteract}
        onWheelStart={beginInteract}
        onWheelStop={endInteract}
        onTransform={(ref) => {
          setScale(ref.state.scale);
        }}
        onInit={(ref) => {
          if (startNode) focusNode(startNode, 0, INITIAL_SCALE);
          // Le transform est posé : on peut révéler l'arbre sans flash.
          setCentered(true);
          setScale(ref.state.scale);
        }}
      >
        {({ zoomIn, zoomOut }) => (
          <>
            <TransformComponent
              wrapperClass="skilltree-viewport"
              contentClass="skilltree-content"
            >
              {svgContent}
            </TransformComponent>

            <ProblemsHeader overline={t.skills.overline} />

            <div className="skill-hud floating">
              <div className="skill-progress-hud">
                <div className="skill-progress-header">
                  <span className="mono-label">{t.skills.progress_overline}</span>
                  <span className="hud-percentage-badge">{progress.pct}%</span>
                </div>
                <div className="skill-progress-stat">
                  <span className="skill-progress-count">{progress.masteredSkills}</span>
                  <span className="skill-progress-total">/ {progress.totalSkills}</span>
                  <span className="skill-progress-label">
                    {lang === 'fr' ? 'compétences maîtrisées' : 'skills mastered'}
                  </span>
                </div>
                <div
                  className="skill-progress-bar"
                  role="progressbar"
                  aria-valuenow={progress.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t.skills.progress_overline}
                >
                  <span style={{ width: `${progress.pct}%` }} />
                </div>
                <p className="skill-progress-sub mono-label">
                  {t.skills.problems_solved(progress.solvedProblems, progress.totalProblems)}
                </p>
              </div>
              <ul className="skill-legend">
                {(['mastered', 'recommended', 'not_ready'] as SkillState[]).map((s) => (
                  <li key={s}>
                    <LegendIcon state={s} />
                    <span>{t.skills.state[s]}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="skilltree-controls" role="group" aria-label={t.skills.overline}>
              <button
                type="button"
                className="map-ctrl"
                onClick={() => zoomIn()}
                disabled={isMaxScale}
                aria-label={t.skills.zoom_in}
                title={t.skills.zoom_in}
              >
                +
              </button>
              <button
                type="button"
                className="map-ctrl"
                onClick={() => zoomOut()}
                disabled={isMinScale}
                aria-label={t.skills.zoom_out}
                title={t.skills.zoom_out}
              >
                −
              </button>
              <button
                type="button"
                className="map-ctrl"
                onClick={() => {
                  const node = (selected && byId.get(selected)) || roots[0] || nodes[0];
                  if (node) focusNode(node, 400, INITIAL_SCALE);
                }}
                aria-label={t.skills.recenter}
                title={t.skills.recenter}
              >
                ⌖
              </button>
            </div>

            <span className="skilltree-hint mono-label">{t.skills.explore_hint}</span>

            <aside
              className={`skill-panel floating${current ? ' is-open' : ''}`}
              aria-hidden={!current}
            >
              {panelNode && (
                <div className="panel-inner">
                  <button
                    type="button"
                    className="skill-panel-close"
                    onClick={() => setSelected(null)}
                    aria-label={t.skills.close_panel}
                    title={t.skills.close_panel}
                  >
                    ✕
                  </button>
                  <p className={`mono-label skill-state-label is-${panelNode.state}`}>
                    {t.skills.state[panelNode.state]}
                  </p>
                  <h2>{name(panelNode)}</h2>
                  {description(panelNode) && (
                    <p className="skill-description">{description(panelNode)}</p>
                  )}
                  <p className="skill-mastery mono-label">
                    {t.skills.mastery_progress(
                      panelNode.solved_count,
                      panelNode.mastery_threshold,
                    )}
                  </p>
                  <ul className="skill-problems">
                    {panelNode.problems.map((p) => (
                      <li key={p.slug}>
                        <StatusMark solved={p.solved} attempted={false} />
                        <Link className="problem-link" to={`/problems/${p.slug}`}>
                          {p.title}
                        </Link>
                        <DifficultyDots level={p.difficulty} />
                      </li>
                    ))}
                  </ul>
                  {panelNode.articles.length > 0 && (
                    <div className="skill-articles">
                      <p className="mono-label">{t.skills.articles}</p>
                      <ul>
                        {panelNode.articles.map((a) => (
                          <li key={`${a.course_slug}/${a.article_slug}`}>
                            <Link
                              className="problem-link"
                              to={`/courses/${a.course_slug}/${a.article_slug}`}
                            >
                              📖 {lang === 'en' && a.title_en ? a.title_en : a.title_fr}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {panelNode.requires.length > 0 && (
                    <div className="skill-prereqs">
                      <p className="mono-label">{t.skills.prerequisites}</p>
                      {panelNode.requires.map((req) => {
                        const node = byId.get(req);
                        if (!node) return null;
                        return (
                          <button
                            key={req}
                            className={`chip skill-prereq-chip${
                              node.state === 'mastered' ? ' is-mastered' : ''
                            }`}
                            onClick={() => select(node)}
                            onMouseEnter={() => handleMouseEnter(req)}
                            onMouseLeave={() => handleMouseLeave(req)}
                          >
                            {node.state === 'mastered' ? '✓ ' : ''}
                            {name(node)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </aside>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
