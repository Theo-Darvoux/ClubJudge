import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import type { ContestDetail, ContestPhase, ScoreCell, Scoreboard } from '../api';
import { DifficultyDots, StatusMark } from '../components/badges';
import { fmtContestMinute, fmtCountdown, fmtWindow, useNow } from '../contest-utils';
import { useI18n } from '../i18n/context';

const SCOREBOARD_REFRESH_MS = 15_000;

function clientPhase(contest: ContestDetail, now: number): ContestPhase {
  if (now < Date.parse(contest.start_at)) return 'upcoming';
  if (now < Date.parse(contest.end_at)) return 'running';
  return 'finished';
}

function ScoreCellView({ cell }: { cell: ScoreCell }) {
  if (cell.solved_at_min !== null) {
    return (
      <td className={`score-cell is-solved${cell.first_blood ? ' is-first-blood' : ''}`}>
        <span className="score-cell-main">
          {cell.first_blood && <span className="first-blood-mark">✦</span>}+
          {cell.tries > 0 ? cell.tries : ''}
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

function ScoreboardView({ board }: { board: Scoreboard }) {
  const { t } = useI18n();
  if (board.rows.length === 0) {
    return <p className="empty-state">{t.contests.scoreboard_empty}</p>;
  }
  const anyFirstBlood = board.rows.some((r) => r.cells.some((c) => c.first_blood));
  const anyPending = board.rows.some((r) => r.cells.some((c) => c.pending));
  return (
    <>
      <table className="scoreboard-table">
        <thead>
          <tr>
            <th className="col-rank">{t.contests.th_rank}</th>
            <th>{t.contests.th_member}</th>
            <th className="col-num">{t.contests.th_solved}</th>
            <th className="col-num">{t.contests.th_penalty}</th>
            {board.problems.map((label) => (
              <th key={label} className="col-problem">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row, i) => (
            <tr key={i} className={row.is_me ? 'is-me' : undefined}>
              <td className="col-rank mono-label">{row.rank}</td>
              <td>
                {row.display_name}
                {row.is_me && <span className="chip me-chip">{t.contests.you}</span>}
              </td>
              <td className="col-num">{row.solved}</td>
              <td className="col-num mono-label">{row.penalty_min}</td>
              {row.cells.map((cell, j) => (
                <ScoreCellView key={j} cell={cell} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(anyFirstBlood || anyPending) && (
        <p className="scoreboard-legend mono-label">
          {anyFirstBlood && <span>{t.contests.first_blood_legend}</span>}
          {anyPending && <span>{t.contests.pending_legend}</span>}
        </p>
      )}
    </>
  );
}

export function ContestPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, lang } = useI18n();
  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [notFound, setNotFound] = useState(false);
  const now = useNow();

  const reload = useCallback(() => {
    if (!slug) return;
    api
      .contest(slug)
      .then(setContest)
      .catch(() => setNotFound(true));
  }, [slug]);

  useEffect(reload, [reload]);

  const phase = contest ? clientPhase(contest, now) : null;

  // Le front voit la frontière passer (compte à rebours) avant le serveur :
  // on re-demande le détail au changement de phase (énoncés révélés, etc.).
  useEffect(() => {
    if (contest && phase && phase !== contest.phase) reload();
  }, [contest, phase, reload]);

  useEffect(() => {
    if (!slug || !phase || phase === 'upcoming') return;
    const fetchBoard = () => api.scoreboard(slug).then(setBoard).catch(() => {});
    fetchBoard();
    if (phase !== 'running') return;
    const id = setInterval(fetchBoard, SCOREBOARD_REFRESH_MS);
    return () => clearInterval(id);
  }, [slug, phase]);

  if (notFound) {
    return (
      <nav className="breadcrumb">
        <Link to="/contests">{t.contests.back}</Link>
      </nav>
    );
  }
  if (!contest || !phase) return <p className="mono-label">{t.contests.loading}</p>;

  const register = () => api.contestRegister(contest.slug).then(reload);
  const unregister = () => api.contestUnregister(contest.slug).then(reload);

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
          <span className="contest-card-meta">
            {t.contests.problems_count(contest.problem_count)} ·{' '}
            {t.contests.registered_count(contest.registered_count)}
          </span>
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
        </div>
      </header>

      {contest.description && (
        <div className="contest-description">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{contest.description}</ReactMarkdown>
        </div>
      )}

      {contest.problems ? (
        <section className="contest-problems">
          <h2 className="mono-label contest-section-title">{t.contests.problems_title}</h2>
          {phase === 'finished' && (
            <p className="contest-note">{t.contests.upsolving_note}</p>
          )}
          <table className="problem-table">
            <thead>
              <tr>
                <th className="col-status" aria-label={t.problems.th_status} />
                <th className="col-label">{t.contests.th_label}</th>
                <th>{t.contests.th_problem}</th>
                <th className="col-difficulty">{t.contests.th_difficulty}</th>
              </tr>
            </thead>
            <tbody>
              {contest.problems.map((p) => (
                <tr key={p.slug}>
                  <td className="col-status">
                    <StatusMark solved={p.solved} attempted={false} />
                  </td>
                  <td className="col-label mono-label">{p.label}</td>
                  <td>
                    <Link className="problem-link" to={`/problems/${p.slug}`}>
                      {p.title}
                    </Link>
                  </td>
                  <td className="col-difficulty">
                    <DifficultyDots level={p.difficulty} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="contest-note">
          {phase === 'upcoming'
            ? contest.registered
              ? t.contests.upcoming_hidden
              : t.contests.register_pitch
            : t.contests.register_pitch_running}
        </p>
      )}

      {phase !== 'upcoming' && board && (
        <section className="contest-scoreboard">
          <h2 className="mono-label contest-section-title">
            {phase === 'finished' ? t.contests.scoreboard_final : t.contests.scoreboard_title}
            {phase === 'running' && (
              <span className="scoreboard-refresh">{t.contests.refresh_note}</span>
            )}
          </h2>
          <ScoreboardView board={board} />
        </section>
      )}
    </div>
  );
}
