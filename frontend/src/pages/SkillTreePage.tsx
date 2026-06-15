import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import type { SkillNode, SkillState } from '../api';
import { DifficultyDots, StatusMark } from '../components/badges';

import { ProblemsHeader } from '../components/ViewToggle';
import { cx } from '../cx';
import { useI18n, type Lang } from '../i18n/context';
import type { fr } from '../i18n/fr';
import { localized } from '../i18n/localized';
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

const SkillTreeHUD = memo(({
  progress,
  t
}: {
  progress: { masteredSkills: number; totalSkills: number; solvedProblems: number; totalProblems: number; pct: number };
  t: typeof fr;
}) => {
  return (
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
            {t.skills.mastered_label}
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
  );
});

interface SkillPanelProps {
  isOpen: boolean;
  displayNode: SkillNode | undefined;
  lang: Lang;
  t: typeof fr;
  byId: Map<string, SkillNode>;
  onClose: () => void;
  onSelect: (node: SkillNode) => void;
  onMouseEnterPrereq: (slug: string) => void;
  onMouseLeavePrereq: (slug: string) => void;
  name: (n: SkillNode) => string;
  description: (n: SkillNode) => string;
}

const SkillPanel = memo(({
  isOpen,
  displayNode,
  lang,
  t,
  byId,
  onClose,
  onSelect,
  onMouseEnterPrereq,
  onMouseLeavePrereq,
  name,
  description
}: SkillPanelProps) => {
  return (
    <aside
      className={`skill-panel floating${isOpen ? ' is-open' : ''}`}
      aria-hidden={!isOpen}
    >
      {displayNode && (
        <div className="panel-inner">
          <button
            type="button"
            className="skill-panel-close"
            onClick={onClose}
            aria-label={t.skills.close_panel}
            title={t.skills.close_panel}
          >
            ✕
          </button>
          <p className={`mono-label skill-state-label is-${displayNode.state}`}>
            {t.skills.state[displayNode.state]}
          </p>
          <h2>{name(displayNode)}</h2>
          {description(displayNode) && (
            <p className="skill-description">{description(displayNode)}</p>
          )}
          <p className="skill-mastery mono-label">
            {t.skills.mastery_progress(
              displayNode.solved_count,
              displayNode.mastery_threshold,
            )}
          </p>
          <ul className="skill-problems">
            {displayNode.problems.map((p) => (
              <li key={p.slug}>
                <StatusMark solved={p.solved} attempted={p.attempted} />
                <Link className="problem-link" to={`/problems/${p.slug}`}>
                  {p.title}
                </Link>
                <DifficultyDots level={p.difficulty} />
              </li>
            ))}
          </ul>
          {displayNode.articles.length > 0 && (
            <div className="skill-articles">
              <p className="mono-label">{t.skills.articles}</p>
              <ul>
                {displayNode.articles.map((a) => (
                  <li key={`${a.course_slug}/${a.article_slug}`}>
                    <Link
                      className="problem-link"
                      to={`/courses/${a.course_slug}/${a.article_slug}`}
                    >
                      📖 {localized(a.title_fr, a.title_en, lang)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {displayNode.requires.length > 0 && (
            <div className="skill-prereqs">
              <p className="mono-label">{t.skills.prerequisites}</p>
              {displayNode.requires.map((req) => {
                const node = byId.get(req);
                if (!node) return null;
                return (
                  <button
                    key={req}
                    className={`chip skill-prereq-chip${
                      node.state === 'mastered' ? ' is-mastered' : ''
                    }`}
                    onClick={() => onSelect(node)}
                    onMouseEnter={() => onMouseEnterPrereq(req)}
                    onMouseLeave={() => onMouseLeavePrereq(req)}
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
  );
});

export function SkillTreePage() {
  const { t, lang } = useI18n();
  // Nœuds + liste de problèmes partagés avec la vue liste (chargés une fois par
  // le provider) : la bascule liste → arbre est instantanée, sans re-fetch.
  const { skillTree: nodes, solvedProblems, totalProblems, treeError, reload } = useProblemsData();
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
  const focusTimerRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
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
      if (transformRef.current) {
        setScale(transformRef.current.state.scale);
      }
    }, 180);
  }, [transformRef]);
  useEffect(
    () => () => {
      if (interactStopTimer.current !== null) clearTimeout(interactStopTimer.current);
      if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
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

  const handleClosePanel = useCallback(() => {
    setSelected(null);
  }, []);


  // Sélection initiale (une seule fois, dès que les nœuds sont là) : le premier
  // nœud recommandé — la réponse à « et maintenant, je travaille quoi ? ».
  useEffect(() => {
    if (!initializedRef.current && nodes && nodes.length > 0) {
      initializedRef.current = true;
      const next = nodes.find((n) => n.state === 'recommended') ?? nodes[0];
      if (next) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init when data first arrives
        setSelected(next.slug);
        setPanelNode(next);
      }
    }
  }, [nodes]);


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

  // Progression globale : compétences maîtrisées (la barre) et problèmes résolus
  // sur l'ensemble du catalogue — même dénominateur que la vue liste, pour que la
  // bascule arbre ↔ liste n'affiche pas deux totaux différents.
  const progress = useMemo(() => {
    const all = nodes ?? [];
    const masteredSkills = all.filter((n) => n.state === 'mastered').length;
    const totalSkills = all.length;
    return {
      masteredSkills,
      totalSkills,
      solvedProblems,
      totalProblems,
      pct: totalSkills ? Math.round((masteredSkills / totalSkills) * 100) : 0,
    };
  }, [nodes, solvedProblems, totalProblems]);

  // Cadre du SVG (rendu à l'échelle 1:1 en px) — partagé par le calcul de
  // centrage et le viewBox du rendu.
  const bounds = useMemo(() => {
    if (!nodes?.length) return null;
    // Un seul passage (pas de spread Math.min(...xs), qui sature la pile sur de
    // très grands arbres).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    minX -= PAD;
    minY -= PAD;
    return {
      minX,
      minY,
      width: maxX - minX + PAD,
      height: maxY - minY + PAD + 20, // marge pour les noms sous les nœuds
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

      if (focusTimerRef.current !== null) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }

      // Recentrage animé : on promeut la couche le temps de la transition pour
      // que ce déplacement programmatique soit lui aussi composité, pas repeint.
      if (animationTime > 0) {
        beginInteract();
        focusTimerRef.current = window.setTimeout(() => {
          endInteract();
          focusTimerRef.current = null;
        }, animationTime);
      }
      ref.setTransform(x, y, sc, animationTime);
      setScale(sc);
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

  const dragStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGGElement>) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<SVGGElement>) => {
    const touch = e.touches[0];
    if (touch) {
      dragStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }
  }, []);

  const handleNodeClick = useCallback(
    (e: React.MouseEvent<SVGGElement>, node: SkillNode) => {
      const isA11y = e.clientX === 0 && e.clientY === 0;
      if (isA11y) {
        select(node);
        return;
      }
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

  const name = useCallback((n: SkillNode) => localized(n.name_fr, n.name_en, lang), [lang]);

  const description = useCallback(
    (n: SkillNode) => localized(n.description_fr ?? '', n.description_en, lang),
    [lang],
  );

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
  const startNode = useMemo(
    () =>
      nodes
        ? nodes.find((n) => n.slug === 'premiers-pas') ??
          nodes.find((n) => n.requires.length === 0) ??
          nodes[0]
        : undefined,
    [nodes],
  );

  // Géométrie des arêtes, calculée une seule fois (edgeSegment fait de la trigo
  // par arête) et indépendante du survol. Partagée par les dégradés (staticDefs)
  // et le tracé des lignes (svgContent) — fini le double calcul du segment, et
  // surtout un simple hover ne relance plus toute cette géométrie.
  const edges = useMemo(() => {
    if (!nodes) return [];
    return nodes.flatMap((n) =>
      n.requires.flatMap((req) => {
        const from = byId.get(req);
        if (!from) return [];
        const fromGolden = from.state === 'mastered';
        const toGolden = n.state === 'mastered';
        return [
          {
            from: req,
            to: n.slug,
            seg: edgeSegment(from, n),
            fromGolden,
            toGolden,
            // Dégradé seulement quand les deux extrémités diffèrent (or ↔ lavande).
            gradientId: fromGolden !== toGolden ? `grad-${req}-${n.slug}` : null,
            lit: from.state === 'mastered',
            flow: from.state === 'mastered' && n.state === 'recommended',
          },
        ];
      }),
    );
  }, [nodes, byId]);

  // Parties strictement statiques du SVG : les dégradés d'arêtes et les halos de
  // racine. Elles ne dépendent que de la topologie et des positions — jamais du
  // survol. On les mémoïse à part pour qu'un simple focus/hover ne relance pas ce
  // calcul ; svgContent ne fait que réembarquer ces éléments stables (React
  // réconcilie par référence et ne les repeint pas).
  const staticDefs = useMemo(() => {
    if (!nodes) return null;
    return (
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
        {edges.map((e) =>
          e.gradientId ? (
            <linearGradient
              key={e.gradientId}
              id={e.gradientId}
              x1={e.seg.x1}
              y1={e.seg.y1}
              x2={e.seg.x2}
              y2={e.seg.y2}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={e.fromGolden ? 'var(--gold)' : 'var(--lav)'} />
              <stop offset="100%" stopColor={e.toGolden ? 'var(--gold)' : 'var(--lav)'} />
            </linearGradient>
          ) : null,
        )}
      </defs>
    );
  }, [nodes, edges]);

  const rootGlow = useMemo(
    () =>
      roots.map((n) => (
        <circle key={n.slug} cx={n.x} cy={n.y} r={PAD * 1.9} fill="url(#skill-center-glow)" />
      )),
    [roots],
  );

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
      >
        {staticDefs}
        {rootGlow}
        {edges.map((e) => {
          let strokeVal: string;
          if (e.fromGolden && e.toGolden) {
            strokeVal = 'var(--gold)';
          } else if (!e.fromGolden && !e.toGolden) {
            strokeVal = 'var(--lav)';
          } else {
            strokeVal = `url(#${e.gradientId})`;
          }
          // Le surlignage du chemin (.is-path / .is-dim) et le focus du SVG sont
          // appliqués hors React (effet impératif) pour qu'un hover ne reconstruise
          // pas tout le graphe : on n'émet ici que les classes liées à l'état.
          return (
            <line
              key={`${e.from}->${e.to}`}
              className={cx('skill-edge', e.lit && 'is-lit', e.flow && 'is-flow')}
              data-from={e.from}
              data-to={e.to}
              x1={e.seg.x1}
              y1={e.seg.y1}
              x2={e.seg.x2}
              y2={e.seg.y2}
              style={{ stroke: strokeVal }}
            />
          );
        })}
        {nodes.map((n) => {
          return (
            <g
              key={n.slug}
              id={`skill-node-${n.slug}`}
              data-slug={n.slug}
              className={cx('skill-node', `is-${n.state}`)}
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
    edges,
    staticDefs,
    rootGlow,
    select,
    handleMouseDown,
    handleTouchStart,
    handleNodeClick,
    handleMouseEnter,
    handleMouseLeave,
    name,
    t.skills,
  ]);

  // Surlignage du chemin ET marquage du nœud sélectionné appliqués hors du cycle
  // de rendu React : on bascule les classes .is-dim / .is-path / .is-selected
  // directement sur le DOM existant. Ni un hover ni un changement de sélection ne
  // reconstruisent donc le SVG entier (svgContent ne dépend ni de focus ni de
  // selected). svgContent reste en dépendance pour réappliquer après une vraie
  // reconstruction (changement de données), qui réinitialise les className.
  // useLayoutEffect : on applique avant le paint, pas de frame « non assombrie ».
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const svg = root.querySelector('.skilltree-content svg');
    svg?.classList.toggle('is-focusing', focus !== null);
    root.querySelectorAll<SVGGElement>('.skill-node').forEach((el) => {
      const slug = el.dataset.slug;
      el.classList.toggle('is-dim', focus !== null && !!slug && !pathSet.has(slug));
      el.classList.toggle('is-selected', !!slug && slug === selected);
    });
    root.querySelectorAll<SVGLineElement>('.skill-edge').forEach((el) => {
      const { from, to } = el.dataset;
      const onPath = focus !== null && !!from && !!to && pathSet.has(from) && pathSet.has(to);
      el.classList.toggle('is-path', onPath);
      el.classList.toggle('is-dim', focus !== null && !onPath);
    });
  }, [focus, pathSet, selected, svgContent]);

  if (treeError) {
    return (
      <div className="skilltree-fullscreen is-message">
        <ProblemsHeader overline={t.skills.overline} />
        <div className="empty-state-container">
          <p className="empty-state">{t.problems.load_error}</p>
          <button type="button" className="btn-clear-filters" onClick={reload}>
            <span aria-hidden="true">↻</span> {t.problems.retry}
          </button>
        </div>
      </div>
    );
  }
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

  // `current` est le nœud sélectionné vivant ; `displayNode` retombe sur le
  // dernier nœud affiché (panelNode) le temps de l'animation de fermeture.
  // panelNode est toujours alimenté en même temps que la sélection (select() et
  // l'effet d'init), donc aucune synchro supplémentaire n'est nécessaire ici —
  // et surtout, aucun hook ne doit suivre les retours anticipés ci-dessus.
  const current = selected ? byId.get(selected) : undefined;
  const displayNode = current || panelNode;

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
        /* onTransform retiré pour éviter des re-renders continus à 60fps durant les gestes */
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

            <SkillTreeHUD progress={progress} t={t} />

            <div className="skilltree-controls" role="group" aria-label={t.skills.overline}>
              <button
                type="button"
                className="map-ctrl"
                onClick={() => {
                  zoomIn();
                  setTimeout(() => {
                    if (transformRef.current) {
                      setScale(transformRef.current.state.scale);
                    }
                  }, 0);
                }}
                disabled={isMaxScale}
                aria-label={t.skills.zoom_in}
                title={t.skills.zoom_in}
              >
                +
              </button>
              <button
                type="button"
                className="map-ctrl"
                onClick={() => {
                  zoomOut();
                  setTimeout(() => {
                    if (transformRef.current) {
                      setScale(transformRef.current.state.scale);
                    }
                  }, 0);
                }}
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

            <SkillPanel
              isOpen={!!current}
              displayNode={displayNode}
              lang={lang}
              t={t}
              byId={byId}
              onClose={handleClosePanel}
              onSelect={select}
              onMouseEnterPrereq={handleMouseEnter}
              onMouseLeavePrereq={handleMouseLeave}
              name={name}
              description={description}
            />
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
