import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { SkillNode, SkillState } from '../api';
import { DifficultyDots, StatusMark } from '../components/badges';
import { ViewToggle } from '../components/ViewToggle';
import { useI18n } from '../i18n/context';

const HEX_R = 46;
const PAD = 110;

function hexPoints(r: number): string {
  // Hexagone pointe en haut, comme les pastilles de difficulté.
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

export function SkillTreePage() {
  const { t, lang } = useI18n();
  const [nodes, setNodes] = useState<SkillNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api
      .skillTree()
      .then((tree) => {
        setNodes(tree);
        // Sélection initiale : le premier nœud recommandé — la réponse à
        // « et maintenant, je travaille quoi ? » sans demander.
        const next = tree.find((n) => n.state === 'recommended') ?? tree[0];
        if (next) setSelected(next.slug);
      })
      .catch(() => setNodes([]));
  }, []);

  const byId = useMemo(() => new Map((nodes ?? []).map((n) => [n.slug, n])), [nodes]);
  const name = (n: SkillNode) => (lang === 'en' && n.name_en ? n.name_en : n.name_fr);
  const description = (n: SkillNode) =>
    lang === 'en' && n.description_en ? n.description_en : n.description_fr;

  if (nodes === null) {
    return (
      <div className="skilltree-page">
        <Head />
        <p className="mono-label">{t.skills.loading}</p>
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <div className="skilltree-page">
        <Head />
        <p className="empty-state">{t.skills.empty}</p>
      </div>
    );
  }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const width = Math.max(...xs) - minX + PAD;
  const height = Math.max(...ys) - minY + PAD + 20; // marge pour les noms sous les nœuds
  const roots = nodes.filter((n) => n.requires.length === 0);
  const current = selected ? byId.get(selected) : undefined;

  return (
    <div className="skilltree-page">
      <Head />
      <div className="skilltree-layout">
        <div className="panel skilltree-canvas">
          <div className="panel-inner">
            <svg
              viewBox={`${minX} ${minY} ${width} ${height}`}
              role="group"
              aria-label={t.skills.overline}
            >
              <defs>
                <radialGradient id="skill-center-glow">
                  <stop offset="0%" stopColor="var(--lav)" stopOpacity="0.09" />
                  <stop offset="100%" stopColor="var(--lav)" stopOpacity="0" />
                </radialGradient>
              </defs>
              {roots.map((n) => (
                <circle
                  key={n.slug}
                  cx={n.x}
                  cy={n.y}
                  r={PAD * 1.8}
                  fill="url(#skill-center-glow)"
                />
              ))}
              {nodes.flatMap((n) =>
                n.requires.map((req) => {
                  const from = byId.get(req);
                  if (!from) return null;
                  return (
                    <line
                      key={`${req}->${n.slug}`}
                      className={`skill-edge${from.state === 'mastered' ? ' is-lit' : ''}`}
                      x1={from.x}
                      y1={from.y}
                      x2={n.x}
                      y2={n.y}
                    />
                  );
                }),
              )}
              {nodes.map((n) => (
                <g
                  key={n.slug}
                  className={`skill-node is-${n.state}${selected === n.slug ? ' is-selected' : ''}`}
                  transform={`translate(${n.x} ${n.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${name(n)} — ${t.skills.state[n.state]}`}
                  onClick={() => setSelected(n.slug)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(n.slug);
                    }
                  }}
                >
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
              ))}
            </svg>
            <ul className="skill-legend">
              {(['mastered', 'recommended', 'not_ready'] as SkillState[]).map((s) => (
                <li key={s}>
                  <span className={`legend-hex is-${s}`} aria-hidden="true" />
                  {t.skills.state[s]}
                </li>
              ))}
              <li className="legend-note">{t.skills.soft_unlock}</li>
            </ul>
          </div>
        </div>

        <aside className="panel skill-panel">
          <div className="panel-inner">
            {!current ? (
              <p className="empty-state">{t.skills.panel_hint}</p>
            ) : (
              <>
                <p className={`mono-label skill-state-label is-${current.state}`}>
                  {t.skills.state[current.state]}
                </p>
                <h2>{name(current)}</h2>
                {description(current) && (
                  <p className="skill-description">{description(current)}</p>
                )}
                <p className="skill-mastery mono-label">
                  {t.skills.mastery_progress(current.solved_count, current.mastery_threshold)}
                </p>
                <ul className="skill-problems">
                  {current.problems.map((p) => (
                    <li key={p.slug}>
                      <StatusMark solved={p.solved} attempted={false} />
                      <Link className="problem-link" to={`/problems/${p.slug}`}>
                        {p.title}
                      </Link>
                      <DifficultyDots level={p.difficulty} />
                    </li>
                  ))}
                </ul>
                {current.requires.length > 0 && (
                  <div className="skill-prereqs">
                    <p className="mono-label">{t.skills.prerequisites}</p>
                    {current.requires.map((req) => {
                      const node = byId.get(req);
                      if (!node) return null;
                      return (
                        <button
                          key={req}
                          className={`chip skill-prereq-chip${
                            node.state === 'mastered' ? ' is-mastered' : ''
                          }`}
                          onClick={() => setSelected(req)}
                        >
                          {node.state === 'mastered' ? '✓ ' : ''}
                          {name(node)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Head() {
  const { t } = useI18n();
  return (
    <header className="page-head">
      <div>
        <p className="mono-label">{t.skills.overline}</p>
        <h1>{t.skills.title}</h1>
      </div>
      <ViewToggle />
    </header>
  );
}
