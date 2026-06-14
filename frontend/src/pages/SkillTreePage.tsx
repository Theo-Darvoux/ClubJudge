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

function hexPoints(r: number): string {
  // Hexagone pointe en haut, comme les pastilles de difficulté.
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

const HEX_INRADIUS = HEX_R * Math.cos(Math.PI / 6); // distance centre → milieu d'arête
const EDGE_GAP = 3; // petit jour entre le bord de l'hexagone et le connecteur

// Distance centre → bord de l'hexagone (pointe en haut) dans la direction theta.
// Sommets à 30° (mod 60°), arêtes à 0° (mod 60°) : le rayon varie avec l'angle.
function hexEdgeDistance(theta: number): number {
  const sector = Math.PI / 3;
  const m = ((theta % sector) + sector) % sector; // [0, 60°)
  const dev = m > sector / 2 ? m - sector : m; // écart à l'arête la plus proche
  return HEX_INRADIUS / Math.cos(dev);
}

// Segment de bord à bord entre deux nœuds centrés en (ax,ay) et (bx,by).
function edgeSegment(ax: number, ay: number, bx: number, by: number) {
  const theta = Math.atan2(by - ay, bx - ax);
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const da = hexEdgeDistance(theta) + EDGE_GAP;
  const db = hexEdgeDistance(theta + Math.PI) + EDGE_GAP;
  return {
    x1: ax + ca * da,
    y1: ay + sa * da,
    x2: bx - ca * db,
    y2: by - sa * db,
  };
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
  const [initialized, setInitialized] = useState(false);

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

  // Centre la vue sur un nœud à l'échelle de confort. animationTime=0 => saut
  // immédiat (cadrage initial), >0 => transition douce (bouton recentrer).
  const focusNode = useCallback(
    (node: SkillNode, animationTime: number) => {
      const ref = transformRef.current;
      const wrap = ref?.instance.wrapperComponent;
      if (!ref || !wrap || !bounds) return;
      const sc = INITIAL_SCALE;
      const x = wrap.offsetWidth / 2 - (node.x - bounds.minX) * sc;
      const y = wrap.offsetHeight / 2 - (node.y - bounds.minY) * sc;
      ref.setTransform(x, y, sc, animationTime);
    },
    [bounds],
  );

  // Sélectionne un nœud : on alimente aussi panelNode, qui reste affiché
  // pendant l'animation de fermeture (setSelected(null) ne le vide pas), et on
  // recentre la vue dessus en douceur — même geste que le bouton recentrer.
  const select = (node: SkillNode) => {
    setSelected(node.slug);
    setPanelNode(node);
    focusNode(node, 400);
  };
  const name = (n: SkillNode) => (lang === 'en' && n.name_en ? n.name_en : n.name_fr);
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

  const { minX, minY, width, height } = bounds!;
  const roots = nodes.filter((n) => n.requires.length === 0);
  const current = selected ? byId.get(selected) : undefined;

  return (
    <div className={`skilltree-fullscreen${centered ? '' : ' is-precenter'}`}>
      <TransformWrapper
        ref={transformRef}
        minScale={0.35}
        maxScale={2.6}
        initialScale={INITIAL_SCALE}
        limitToBounds={false}
        doubleClick={{ disabled: true }}
        smooth={false}
        wheel={{ step: 0.06 }}
        panning={{ velocityDisabled: false }}
        onInit={() => {
          if (startNode) focusNode(startNode, 0);
          // Le transform est posé : on peut révéler l'arbre sans flash.
          setCentered(true);
        }}
      >
        {({ zoomIn, zoomOut }) => (
          <>
            <TransformComponent
              wrapperClass="skilltree-viewport"
              contentClass="skilltree-content"
            >
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
                    const seg = edgeSegment(from.x, from.y, n.x, n.y);
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
                      onClick={() => select(n)}
                      onMouseEnter={() => setHovered(n.slug)}
                      onMouseLeave={() => setHovered((h) => (h === n.slug ? null : h))}
                      onFocus={() => setHovered(n.slug)}
                      onBlur={() => setHovered((h) => (h === n.slug ? null : h))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          select(n);
                        }
                      }}
                    >
                      <polygon className="skill-hex-halo" points={hexPoints(HEX_R + 7)} />
                      <polygon className="skill-hex" points={hexPoints(HEX_R)} />
                      <text className="skill-progress" y="2">
                        {n.state === 'mastered'
                          ? '✓'
                          : `${n.solved_count}/${n.mastery_threshold}`}
                      </text>
                      <text className="skill-name" y={HEX_R + 24}>
                        {name(n)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </TransformComponent>

            <ProblemsHeader overline={t.skills.overline} />

            <ul className="skill-legend floating">
              {(['mastered', 'recommended', 'not_ready'] as SkillState[]).map((s) => (
                <li key={s}>
                  <span className={`legend-hex is-${s}`} aria-hidden="true" />
                  {t.skills.state[s]}
                </li>
              ))}
              <li className="legend-note">{t.skills.soft_unlock}</li>
            </ul>

            <div className="skilltree-controls" role="group" aria-label={t.skills.overline}>
              <button
                type="button"
                className="map-ctrl"
                onClick={() => zoomIn()}
                aria-label={t.skills.zoom_in}
                title={t.skills.zoom_in}
              >
                +
              </button>
              <button
                type="button"
                className="map-ctrl"
                onClick={() => zoomOut()}
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
                  if (node) focusNode(node, 400);
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
                            onMouseEnter={() => setHovered(req)}
                            onMouseLeave={() => setHovered((h) => (h === req ? null : h))}
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
