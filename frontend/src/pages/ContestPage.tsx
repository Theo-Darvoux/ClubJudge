import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import type {
  ContestDetail,
  ContestPhase,
  ContestProblemRef,
  ScoreCell,
  ScoreRow,
  Scoreboard,
} from '../api';
import { Balloon } from '../components/Balloon';
import { ContestMeta } from '../components/ContestMeta';
import { DifficultyDots, StatusMark } from '../components/badges';
import {
  balloonColor,
  clientPhase,
  fmtContestMinute,
  fmtCountdown,
  fmtWindow,
  useNowUntil,
} from '../contest-utils';
import { useFlip, usePolling, useVirtualRows } from '../hooks';
import { useI18n } from '../i18n/context';

const SCOREBOARD_REFRESH_MS = 15_000;
// Le client franchit les frontières de phase avant le serveur (cf. clientPhase) :
// tant qu'ils divergent on redemande le détail à ce rythme espacé — jamais en
// rafale — jusqu'à ce que le serveur révèle la nouvelle phase.
const PHASE_SYNC_RETRY_MS = 2_000;

function ScoreCellView({ cell }: { cell: ScoreCell }) {
  if (cell.solved_at_min !== null) {
    return (
      <td className={`score-cell is-solved${cell.first_blood ? ' is-first-blood' : ''}`}>
        <span className="score-cell-main">
          +{cell.tries}
        </span>
        <span className="score-cell-time">{fmtContestMinute(cell.solved_at_min)}</span>
      </td>
    );
  }
  if (cell.pending) return <td className="score-cell is-pending">…</td>;
  if (cell.tries > 0) {
    return (
      <td className="score-cell is-failed">
        <span className="score-cell-main">−{cell.tries}</span>
      </td>
    );
  }
  return <td className="score-cell is-empty">·</td>;
}

/** Au-delà de ce nombre de ballons, on n'en montre qu'un échantillon suivi d'une
 *  pastille « +N » : sur un gros contest (20 problèmes), une équipe en tête ne
 *  doit pas faire déborder la colonne du nom gelée. */
const BALLOON_CAP = 5;

/** Ballons gagnés par une équipe : un par problème résolu, dans l'ordre des
 *  colonnes, teinté par le label — comme les vrais ballons accrochés à la table
 *  d'une équipe en ICPC. Plafonné pour rester sur une seule ligne. */
function TeamBalloons({ row, labels }: { row: ScoreRow; labels: string[] }) {
  const { t } = useI18n();
  const earned = labels.filter((_, j) => row.cells[j]?.solved_at_min !== null);
  if (earned.length === 0) return null;
  const shown = earned.length > BALLOON_CAP ? earned.slice(0, BALLOON_CAP - 1) : earned;
  const extra = earned.length - shown.length;
  return (
    <span className="team-balloons" aria-hidden="true">
      {shown.map((label) => (
        <Balloon key={label} color={balloonColor(label)} title={t.contests.balloon_title(label)} />
      ))}
      {extra > 0 && <span className="balloon-more mono-label">+{extra}</span>}
    </span>
  );
}

interface FirstBlood {
  id: number;
  label: string;
  who: string;
  isMe: boolean;
}

/** Détenteur du premier sang par label de problème, dans l'état courant. */
function firstBloodHolders(board: Scoreboard): Map<string, { name: string; isMe: boolean }> {
  const holders = new Map<string, { name: string; isMe: boolean }>();
  for (const row of board.rows) {
    row.cells.forEach((cell, j) => {
      if (cell.first_blood) holders.set(board.problems[j], { name: row.display_name, isMe: row.is_me });
    });
  }
  return holders;
}

function myRank(board: Scoreboard): number | null {
  return board.rows.find((r) => r.is_me)?.rank ?? null;
}

/** Toast « premier sang » auto-effacé après 5 s. Le timer dépend d'identités
 *  stables (id + onDismiss mémoïsé) pour ne pas se réarmer à chaque tic d'horloge
 *  du parent. */
function FirstBloodToast({
  fb,
  onDismiss,
}: {
  fb: FirstBlood;
  onDismiss: (id: number) => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const id = setTimeout(() => onDismiss(fb.id), 5000);
    return () => clearTimeout(id);
  }, [fb.id, onDismiss]);
  return (
    <div className="scoreboard-toast" role="status" onClick={() => onDismiss(fb.id)}>
      <span className="first-blood-mark">✦</span>
      {t.contests.first_blood_toast(fb.label, fb.isMe ? t.contests.you : fb.who)}
    </div>
  );
}

interface ScoreboardEvents {
  toasts: FirstBlood[];
  dismissToast: (id: number) => void;
  gains: Set<number>; // user_ids ayant gagné un résolu au dernier rafraîchissement
  rankDelta: number | null; // déplacement de mon rang (positif = montée)
}

/** Diff entre deux rafraîchissements du classement (toutes les 15 s) : nouveaux
 *  premiers sangs (toasts), lignes qui gagnent un résolu (flash vert) et
 *  déplacement de mon rang (pastille ▲/▼).
 *
 *  Vit au niveau de la **page**, pas dans la vue classement : les événements
 *  continuent ainsi d'être détectés même quand l'onglet « Problèmes » est affiché
 *  (le toast « premier sang » apparaît quoi qu'on regarde), et l'état n'est pas
 *  perdu à chaque bascule d'onglet. Le premier chargement (prev null) sert de
 *  référence, sans effet visuel. Identités par `user_id` — `display_name` n'est
 *  pas unique. */
function useScoreboardEvents(board: Scoreboard | null, live: boolean): ScoreboardEvents {
  const prevRef = useRef<Scoreboard | null>(null);
  const seq = useRef(0);
  const [toasts, setToasts] = useState<FirstBlood[]>([]);
  const [gains, setGains] = useState<Set<number>>(new Set());
  const [rankDelta, setRankDelta] = useState<number | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = board;
    if (!board || !prev || !live) return;

    const before = firstBloodHolders(prev);
    const fresh: FirstBlood[] = [];
    firstBloodHolders(board).forEach((holder, label) => {
      if (!before.has(label)) {
        fresh.push({ id: seq.current++, label, who: holder.name, isMe: holder.isMe });
      }
    });
    if (fresh.length) setToasts((prevToasts) => [...prevToasts, ...fresh]);

    const wasSolved = new Map(prev.rows.map((r) => [r.user_id, r.solved]));
    const gained = new Set<number>();
    for (const row of board.rows) {
      const was = wasSolved.get(row.user_id);
      if (was != null && row.solved > was) gained.add(row.user_id);
    }
    if (gained.size) setGains(gained);

    const beforeRank = myRank(prev);
    const afterRank = myRank(board);
    if (beforeRank != null && afterRank != null && beforeRank !== afterRank) {
      setRankDelta(beforeRank - afterRank);
    }
  }, [board, live]);

  // Le flash vert d'un gain et la pastille de delta s'effacent seuls.
  useEffect(() => {
    if (gains.size === 0) return;
    const id = setTimeout(() => setGains(new Set()), 1600);
    return () => clearTimeout(id);
  }, [gains]);
  useEffect(() => {
    if (rankDelta == null) return;
    const id = setTimeout(() => setRankDelta(null), 6000);
    return () => clearTimeout(id);
  }, [rankDelta]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return { toasts, dismissToast, gains, rankDelta };
}

/** Au-delà de ce nombre d'équipes, on déplie le filtre de recherche : inutile
 *  d'encombrer un petit contest, indispensable à 100 participants. */
const FILTER_THRESHOLD = 12;

/** Hauteur fixe d'une ligne de classement, en px. **Source unique** : injectée en
 *  CSS via la variable `--row-h` sur le conteneur défilant (cf. `scoreboard-scroll`),
 *  que la feuille de style consomme pour `height` des `tbody tr` — JS et CSS ne
 *  peuvent donc plus diverger. Le fenêtrage (useVirtualRows) repose sur cette
 *  hauteur ; les cellules sont par ailleurs bornées en CSS pour qu'aucune ligne ne
 *  puisse la dépasser et faire dériver les cales. */
const ROW_H = 54;

/** Vue classement, purement présentationnelle. Mémoïsée : le compte à rebours de
 *  la page re-rend chaque seconde, mais cette table (jusqu'à 100 × 20 cellules)
 *  ne se reconstruit qu'au changement de `board` / `gains` / `rankDelta`. */
const ScoreboardView = memo(function ScoreboardView({
  board,
  gains,
  rankDelta,
}: {
  board: Scoreboard;
  gains: Set<number>;
  rankDelta: number | null;
}) {
  const { t } = useI18n();
  const flipRef = useFlip(board);
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const needle = filter.trim().toLowerCase();
  const rows = useMemo(
    () => (needle ? board.rows.filter((r) => r.display_name.toLowerCase().includes(needle)) : board.rows),
    [board.rows, needle],
  );

  // Fenêtrage : seules les lignes visibles sont montées (cf. useVirtualRows) —
  // sinon, ouvrir le classement à 100+ équipes bloque le temps de créer toute la
  // table d'un coup. La hauteur de ligne est fixée en CSS pour rester égale à ROW_H.
  // On passe l'index de ma ligne : le hook recentre l'ascenseur dessus avant le
  // premier peint — le réflexe n°1 du compétiteur, se voir où qu'il soit dans 100
  // lignes — sans le triple rendu d'un recentrage post-peint.
  const myIndex = useMemo(() => rows.findIndex((r) => r.is_me), [rows]);
  const { start, end, padTop, padBottom } = useVirtualRows(rows.length, ROW_H, scrollRef, myIndex);
  const visibleRows = rows.slice(start, end);
  const colSpan = 4 + board.problems.length;

  if (board.rows.length === 0) {
    return <p className="empty-state">{t.contests.scoreboard_empty}</p>;
  }
  const anyPending = board.rows.some((r) => r.cells.some((c) => c.pending));
  const showFilter = board.rows.length > FILTER_THRESHOLD;

  return (
    <>
      {showFilter && (
        <div className="scoreboard-tools">
          <input
            className="scoreboard-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t.contests.filter_placeholder}
            aria-label={t.contests.filter_placeholder}
          />
          {needle && (
            <span className="scoreboard-count mono-label">
              {t.contests.filter_count(rows.length, board.rows.length)}
            </span>
          )}
        </div>
      )}
      <div
        className="scoreboard-scroll"
        ref={scrollRef}
        style={{ '--row-h': `${ROW_H}px` } as CSSProperties}
      >
        <table className="scoreboard-table">
          <thead>
            <tr>
              <th className="col-rank">{t.contests.th_rank}</th>
              <th className="col-member">{t.contests.th_member}</th>
              <th className="col-solved col-num">{t.contests.th_solved}</th>
              <th className="col-penalty col-num">{t.contests.th_penalty}</th>
              {board.problems.map((label) => (
                <th key={label} className="col-problem">
                  <span className="col-problem-head">
                    <Balloon color={balloonColor(label)} />
                    {label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="scoreboard-no-match">
                <td colSpan={colSpan}>{t.contests.filter_empty}</td>
              </tr>
            ) : (
              <>
                {padTop > 0 && (
                  <tr className="vrow-pad" aria-hidden="true">
                    <td colSpan={colSpan} style={{ height: padTop }} />
                  </tr>
                )}
                {visibleRows.map((row) => (
                <tr
                  key={row.user_id}
                  ref={flipRef(String(row.user_id))}
                  className={
                    [row.is_me ? 'is-me' : '', gains.has(row.user_id) ? 'is-gain' : '']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                >
                  <td className="col-rank mono-label">
                    {row.rank}
                    {row.is_me && rankDelta != null && rankDelta !== 0 && (
                      <span
                        className={`rank-delta ${rankDelta > 0 ? 'is-up' : 'is-down'}`}
                        aria-label={
                          rankDelta > 0
                            ? t.contests.rank_up_title(rankDelta)
                            : t.contests.rank_down_title(-rankDelta)
                        }
                      >
                        {rankDelta > 0 ? '▲' : '▼'}
                        {Math.abs(rankDelta)}
                      </span>
                    )}
                  </td>
                  <td className="col-member">
                    <span className="team-name">
                      <span className="team-name-text">{row.display_name}</span>
                      {row.is_me && <span className="chip me-chip">{t.contests.you}</span>}
                      <TeamBalloons row={row} labels={board.problems} />
                    </span>
                  </td>
                  <td className="col-solved col-num">{row.solved}</td>
                  <td className="col-penalty col-num mono-label">{row.penalty_min}</td>
                  {row.cells.map((cell, j) => (
                    <ScoreCellView key={j} cell={cell} />
                  ))}
                </tr>
                ))}
                {padBottom > 0 && (
                  <tr className="vrow-pad" aria-hidden="true">
                    <td colSpan={colSpan} style={{ height: padBottom }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
      {anyPending && (
        <p className="scoreboard-legend mono-label">
          <span>{t.contests.pending_legend}</span>
        </p>
      )}
    </>
  );
});

/** Description Markdown du contest, mémoïsée : la page re-rend chaque seconde
 *  (compte à rebours) mais le Markdown ne doit pas être re-parsé à chaque tic. */
const ContestDescription = memo(function ContestDescription({ markdown }: { markdown: string }) {
  return (
    <div className="contest-description">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
});

/** Vue problèmes, mémoïsée pour les mêmes raisons que le classement : ses props
 *  (problèmes, phase) ne bougent qu'au rechargement du détail, pas au tic du
 *  compte à rebours — la table ne se reconstruit donc pas chaque seconde. */
const ProblemsView = memo(function ProblemsView({
  problems,
  phase,
  showToggle,
}: {
  problems: ContestProblemRef[];
  phase: ContestPhase;
  showToggle: boolean;
}) {
  const { t } = useI18n();
  return (
    <section className="contest-problems">
      {!showToggle && (
        <h2 className="mono-label contest-section-title">{t.contests.problems_title}</h2>
      )}
      {phase === 'finished' && <p className="contest-note">{t.contests.upsolving_note}</p>}
      <table className="problem-table">
        <thead>
          <tr>
            <th className="col-status" aria-label={t.problems.th_status} />
            <th className="col-label">{t.contests.th_label}</th>
            <th>{t.contests.th_problem}</th>
            <th className="col-difficulty">{t.contests.th_difficulty}</th>
            {phase === 'finished' && <th className="col-resources">{t.contests.th_resources}</th>}
          </tr>
        </thead>
        <tbody>
          {problems.map((p) => (
            <tr key={p.slug}>
              <td className="col-status">
                <StatusMark solved={p.solved} attempted={p.attempted} />
              </td>
              <td className="col-label mono-label">
                <span className="label-with-balloon">
                  <Balloon color={balloonColor(p.label)} />
                  {p.label}
                </span>
              </td>
              <td>
                <Link className="problem-link" to={`/problems/${p.slug}`}>
                  {p.title}
                </Link>
              </td>
              <td className="col-difficulty">
                <DifficultyDots level={p.difficulty} />
              </td>
              {phase === 'finished' && (
                <td className="col-resources">
                  {p.has_editorial ? (
                    <Link
                      className="editorial-link"
                      to={`/problems/${p.slug}#editorial`}
                      state={{ tab: 'editorial' }}
                    >
                      {t.contests.editorial_link}
                    </Link>
                  ) : (
                    <span className="resources-empty" aria-hidden="true">
                      ·
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});

/** En-tête de la section classement. Avec onglets, le segment « Classement » fait
 *  déjà office de titre : on n'ajoute que la note de rafraîchissement en direct.
 *  Sans onglets (vue unique), un vrai titre de section, suivi de la même note. */
function ScoreboardSectionHeader({
  showToggle,
  phase,
}: {
  showToggle: boolean;
  phase: ContestPhase;
}) {
  const { t } = useI18n();
  const refreshNote = phase === 'running' && (
    <span className="scoreboard-refresh">{t.contests.refresh_note}</span>
  );
  if (showToggle) {
    return phase === 'running' ? (
      <p className="mono-label contest-scoreboard-refresh">{refreshNote}</p>
    ) : null;
  }
  return (
    <h2 className="mono-label contest-section-title">
      {phase === 'finished' ? t.contests.scoreboard_final : t.contests.scoreboard_title}
      {refreshNote}
    </h2>
  );
}

export function ContestPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, lang } = useI18n();
  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [boardError, setBoardError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [justStarted, setJustStarted] = useState(false);
  // Onglet actif quand les deux vues coexistent ; problèmes par défaut — c'est
  // ce qu'on vient lire, le classement est un second temps.
  const [view, setView] = useState<'problems' | 'scoreboard'>('problems');
  const prevPhase = useRef<ContestPhase | null>(null);
  // L'horloge se fige à la fin du contest : une page terminée est statique, nul
  // besoin de la re-rendre chaque seconde.
  const now = useNowUntil(contest ? Date.parse(contest.end_at) : null);

  const reload = useCallback(() => {
    if (!slug) return;
    api
      .contest(slug)
      .then(setContest)
      .catch(() => setNotFound(true));
  }, [slug]);

  useEffect(reload, [reload]);

  const phase = contest ? clientPhase(contest, now) : null;
  const live = phase === 'running';
  const { toasts, dismissToast, gains, rankDelta } = useScoreboardEvents(board, live);

  // Le front voit la frontière passer (compte à rebours) avant le serveur : tant
  // que le serveur n'a pas basculé de phase, on redemande le détail à intervalle
  // espacé jusqu'à convergence (énoncés révélés, etc.). Une seule requête en vol
  // par mismatch — jamais de rafale, même si les horloges divergent longuement.
  useEffect(() => {
    if (!contest || !phase || phase === contest.phase) return;
    const id = setTimeout(reload, PHASE_SYNC_RETRY_MS);
    return () => clearTimeout(id);
  }, [contest, phase, reload]);

  // Auto-entrée : quand le compte à rebours franchit le départ sous nos yeux
  // (salle d'attente → contest), on fête le lancement quelques secondes pendant
  // que le rechargement débloque les énoncés.
  useEffect(() => {
    if (!phase) return;
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === 'upcoming' && phase === 'running') {
      setJustStarted(true);
      const id = setTimeout(() => setJustStarted(false), 8000);
      return () => clearTimeout(id);
    }
  }, [phase]);

  // Le classement n'existe côté serveur qu'une fois le contest démarré : on pilote
  // donc la récupération sur la phase **confirmée par le serveur** (contest.phase),
  // pas sur la phase client (qui devance la frontière). Sinon, au démarrage, le
  // premier fetch partirait trop tôt, prendrait un 409, et le classement resterait
  // vide jusqu'au tic d'intervalle suivant (jusqu'à 15 s de blanc au pic d'affluence).
  // La boucle de synchro de phase recharge le détail jusqu'à convergence ; dès que
  // contest.phase bascule, cet effet refait un fetch immédiat.
  const serverPhase = contest?.phase ?? null;
  const loadBoard = useCallback(() => {
    if (!slug) return;
    api
      .scoreboard(slug)
      .then((b) => {
        setBoard(b);
        setBoardError(false);
      })
      .catch(() => setBoardError(true));
  }, [slug]);

  // En cours : on sonde le classement toutes les 15 s, mais seulement quand l'onglet
  // est au premier plan (usePolling met en pause en arrière-plan et rattrape au
  // retour) — pas de rafale de requêtes pour un onglet que personne ne regarde.
  usePolling(loadBoard, SCOREBOARD_REFRESH_MS, serverPhase === 'running');

  // Terminé : le classement final est figé, un seul fetch suffit (pas de sondage).
  useEffect(() => {
    if (serverPhase === 'finished') loadBoard();
  }, [serverPhase, loadBoard]);

  if (notFound) {
    return (
      <nav className="breadcrumb">
        <Link to="/contests">{t.contests.back}</Link>
      </nav>
    );
  }
  if (!contest || !phase) return <p className="mono-label">{t.contests.loading}</p>;

  // L'inscription peut échouer sur une course (contest qui démarre/se termine
  // pile à ce moment → 409) : on remonte l'erreur au lieu de la laisser filer en
  // rejet non géré, et on l'efface au prochain succès.
  const register = () =>
    api
      .contestRegister(contest.slug)
      .then(() => {
        setActionError(false);
        reload();
      })
      .catch(() => setActionError(true));
  const unregister = () =>
    api
      .contestUnregister(contest.slug)
      .then(() => {
        setActionError(false);
        reload();
      })
      .catch(() => setActionError(true));

  // Problèmes et classement cohabitent une fois le contest lancé : on bascule de
  // l'un à l'autre par onglet plutôt que de les empiler. S'il n'y a qu'une vue
  // (salle d'attente, non-inscrit), elle s'affiche seule, sans onglets.
  const hasProblems = contest.problems !== null;
  const hasBoard = phase !== 'upcoming' && board !== null;
  const showToggle = hasProblems && hasBoard;
  const activeView = showToggle ? view : hasProblems ? 'problems' : 'scoreboard';

  return (
    <div className="contest-page">
      <nav className="breadcrumb">
        <Link to="/contests">{t.contests.back}</Link>
      </nav>

      <header className="contest-head">
        <div className="contest-head-main">
          <span className="mono-label overline">
            {t.contests.overline}
            {phase === 'running' && <span className="live-chip">{t.contests.live}</span>}
          </span>
          <h1>{contest.title}</h1>
          <span className="mono-label contest-window">
            {fmtWindow(contest.start_at, contest.end_at, lang)}
          </span>
          <ContestMeta
            problemCount={contest.problem_count}
            registeredCount={contest.registered_count}
          />
        </div>

        <div className="contest-head-side">
          {phase !== 'finished' ? (
            <div className="contest-countdown">
              <span className="mono-label">
                {phase === 'upcoming' ? t.contests.starts_in : t.contests.ends_in}
              </span>
              <strong>
                {fmtCountdown(
                  Date.parse(phase === 'upcoming' ? contest.start_at : contest.end_at) - now,
                  lang,
                )}
              </strong>
            </div>
          ) : (
            <span className="mono-label contest-finished-note">{t.contests.finished_note}</span>
          )}

          {phase !== 'finished' &&
            (contest.registered ? (
              <div className="contest-reg-state">
                <span className="registered-chip">{t.contests.registered_chip}</span>
                {phase === 'upcoming' && (
                  <button className="nav-ghost-btn" onClick={unregister}>
                    {t.contests.unregister}
                  </button>
                )}
              </div>
            ) : (
              <button className="btn btn-primary" onClick={register}>
                {t.contests.register}
              </button>
            ))}

          {actionError && (
            <span className="contest-action-error" role="alert">
              {t.contests.action_error}
            </span>
          )}
        </div>
      </header>

      {justStarted && (
        <div className="contest-start-flash" role="status">
          <span className="contest-start-balloons" aria-hidden="true">
            {['A', 'B', 'C', 'D', 'E'].map((l) => (
              <Balloon key={l} color={balloonColor(l)} />
            ))}
          </span>
          {t.contests.started_flash}
        </div>
      )}

      {contest.description && <ContestDescription markdown={contest.description} />}

      {showToggle && (
        <div className="contest-view-toggle status-segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'problems'}
            className={`seg-btn ${activeView === 'problems' ? 'is-active' : ''}`}
            onClick={() => setView('problems')}
          >
            {t.contests.problems_title}
            <span className="seg-count">{contest.problem_count}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'scoreboard'}
            className={`seg-btn ${activeView === 'scoreboard' ? 'is-active' : ''}`}
            onClick={() => setView('scoreboard')}
          >
            {t.contests.scoreboard_title}
            {board && <span className="seg-count">{board.rows.length}</span>}
          </button>
        </div>
      )}

      {contest.problems && activeView === 'problems' ? (
        <ProblemsView problems={contest.problems} phase={phase} showToggle={showToggle} />
      ) : null}

      {!contest.problems &&
        (phase === 'upcoming' && contest.registered ? (
          <div className="contest-lobby">
            <span className="contest-lobby-balloons" aria-hidden="true">
              {['A', 'C', 'B'].map((l) => (
                <Balloon key={l} color={balloonColor(l)} />
              ))}
            </span>
            <h2 className="contest-lobby-title">{t.contests.lobby_title}</h2>
            <strong className="contest-lobby-countdown">
              {fmtCountdown(Date.parse(contest.start_at) - now, lang)}
            </strong>
            <p className="contest-lobby-hint">{t.contests.lobby_hint}</p>
          </div>
        ) : (
          <p className="contest-note">
            {phase === 'upcoming'
              ? t.contests.register_pitch
              : contest.registered
                ? t.contests.unlocking
                : t.contests.register_pitch_running}
          </p>
        ))}

      {hasBoard && board && activeView === 'scoreboard' && (
        <section className="contest-scoreboard">
          <ScoreboardSectionHeader showToggle={showToggle} phase={phase} />
          <ScoreboardView board={board} gains={gains} rankDelta={rankDelta} />
        </section>
      )}

      {/* Échec de chargement du classement (pendant/après le contest) : on le dit
          au lieu de laisser une vue vide sans explication. */}
      {boardError && !board && phase !== 'upcoming' && (
        <p className="contest-note" role="alert">
          {t.contests.scoreboard_error}
        </p>
      )}

      {/* Toasts « premier sang » : rendus au niveau de la page (overlay), pas dans
          la vue classement — ils doivent apparaître même quand on regarde les
          problèmes, et survivre à une bascule d'onglet. */}
      <div className="scoreboard-toasts" aria-live="polite">
        {toasts.map((fb) => (
          <FirstBloodToast key={fb.id} fb={fb} onDismiss={dismissToast} />
        ))}
      </div>
    </div>
  );
}
