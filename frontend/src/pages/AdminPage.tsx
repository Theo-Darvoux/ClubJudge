import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import type { ContestPayload, ContestSummary, ProblemSummary } from '../api';
import { useAuth } from '../auth/context';
import { fmtWindow } from '../contest-utils';
import { useI18n } from '../i18n/context';

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface FormState {
  slug: string;
  title: string;
  description: string;
  start: string; // datetime-local
  end: string;
  problemSlugs: string[];
}

const EMPTY_FORM: FormState = {
  slug: '',
  title: '',
  description: '',
  start: '',
  end: '',
  problemSlugs: [],
};

export function AdminPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [contests, setContests] = useState<ContestSummary[]>([]);
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  // null = formulaire fermé ; '' = création ; sinon slug du contest édité.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejudgeProblem, setRejudgeProblem] = useState('');
  const [rejudgeSubmission, setRejudgeSubmission] = useState('');

  const reload = useCallback(() => {
    api.contests().then(setContests).catch(() => {});
    api.problems().then(setProblems).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  if (user && user.role !== 'admin') return <Navigate to="/problems" replace />;
  if (!user) return null;

  const errorLabel = (e: unknown): string => {
    if (e instanceof ApiError) {
      const code = e.code;
      const known = t.admin.errors as Record<string, string>;
      if (code && typeof known[code] === 'string') return known[code];
    }
    return t.admin.errors.generic;
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing('');
    setMessage(null);
    setError(null);
  };

  const openEdit = async (slug: string) => {
    const detail = await api.contest(slug);
    setForm({
      slug: detail.slug,
      title: detail.title,
      description: detail.description ?? '',
      start: toLocalInput(detail.start_at),
      end: toLocalInput(detail.end_at),
      problemSlugs: (detail.problems ?? []).map((p) => p.slug),
    });
    setEditing(slug);
    setMessage(null);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    const payload: ContestPayload = {
      slug: form.slug,
      title: form.title,
      description: form.description.trim() || null,
      start_at: new Date(form.start).toISOString(),
      end_at: new Date(form.end).toISOString(),
      problems: form.problemSlugs.map((slug, i) => ({ slug, label: LABELS[i] ?? 'Z' })),
    };
    try {
      if (editing === '') {
        await api.createContest(payload);
        setMessage(t.admin.created);
      } else {
        await api.updateContest(editing!, payload);
        setMessage(t.admin.saved);
      }
      setEditing(null);
      reload();
    } catch (e) {
      setError(errorLabel(e));
    }
  };

  const remove = async (slug: string) => {
    if (!window.confirm(t.admin.delete_confirm)) return;
    try {
      await api.deleteContest(slug);
      reload();
    } catch (e) {
      setError(errorLabel(e));
    }
  };

  const doRejudge = async (kind: 'problem' | 'submission') => {
    setError(null);
    setMessage(null);
    try {
      const out =
        kind === 'problem'
          ? await api.rejudgeProblem(rejudgeProblem.trim())
          : await api.rejudgeSubmission(Number(rejudgeSubmission.trim()));
      setMessage(t.admin.rejudged(out.rejudged));
    } catch (e) {
      setError(errorLabel(e));
    }
  };

  const availableProblems = problems.filter((p) => !form.problemSlugs.includes(p.slug));
  const formValid =
    form.title.trim() && form.slug.trim() && form.start && form.end && form.start < form.end;

  return (
    <div className="admin-page">
      <header className="page-head">
        <div className="page-head-titles">
          <h1>{t.admin.title}</h1>
          <span className="mono-label">{t.admin.overline}</span>
        </div>
        {editing === null && (
          <button className="btn btn-primary" onClick={openCreate}>
            {t.admin.new_contest}
          </button>
        )}
      </header>

      {message && <p className="admin-flash">{message}</p>}
      {error && <p className="admin-flash is-error">{error}</p>}

      {editing !== null && (
        <section className="admin-form">
          <h2 className="mono-label contest-section-title">
            {editing === '' ? t.admin.new_contest : `${t.admin.edit_contest} — ${editing}`}
          </h2>
          <div className="admin-form-grid">
            <label>
              <span className="mono-label">{t.admin.form_title}</span>
              <input
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    title: e.target.value,
                    slug: editing === '' ? slugify(e.target.value) : f.slug,
                  }))
                }
              />
            </label>
            <label>
              <span className="mono-label">{t.admin.form_slug}</span>
              <input
                value={form.slug}
                disabled={editing !== ''}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              />
            </label>
            <label>
              <span className="mono-label">{t.admin.form_start}</span>
              <input
                type="datetime-local"
                value={form.start}
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
              />
            </label>
            <label>
              <span className="mono-label">{t.admin.form_end}</span>
              <input
                type="datetime-local"
                value={form.end}
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
              />
            </label>
            <label className="admin-form-wide">
              <span className="mono-label">{t.admin.form_description}</span>
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
          </div>

          <div className="admin-problems">
            <span className="mono-label">{t.admin.form_problems}</span>
            {form.problemSlugs.length === 0 && (
              <p className="empty-state">{t.admin.form_no_problem}</p>
            )}
            <ul>
              {form.problemSlugs.map((slug, i) => (
                <li key={slug}>
                  <span className="mono-label">{LABELS[i]}</span>
                  <span className="admin-problem-title">
                    {problems.find((p) => p.slug === slug)?.title ?? slug}
                  </span>
                  <button
                    className="nav-ghost-btn"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        problemSlugs: f.problemSlugs.filter((s) => s !== slug),
                      }))
                    }
                  >
                    {t.admin.form_remove}
                  </button>
                </li>
              ))}
            </ul>
            {availableProblems.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const slug = e.target.value;
                  if (slug) {
                    setForm((f) => ({ ...f, problemSlugs: [...f.problemSlugs, slug] }));
                  }
                }}
              >
                <option value="">+ {t.admin.form_add_problem}</option>
                {availableProblems.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.title} ({p.slug})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="admin-form-actions">
            <button className="btn btn-primary" onClick={submit} disabled={!formValid}>
              {editing === '' ? t.admin.create : t.admin.save}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              {t.admin.cancel}
            </button>
          </div>
        </section>
      )}

      <section className="admin-contests">
        <h2 className="mono-label contest-section-title">{t.contests.title}</h2>
        {contests.length === 0 ? (
          <p className="empty-state">{t.contests.empty}</p>
        ) : (
          <ul className="admin-contest-list">
            {contests.map((c) => (
              <li key={c.slug}>
                <div>
                  <strong>{c.title}</strong>
                  <span className="mono-label"> {fmtWindow(c.start_at, c.end_at, lang)}</span>
                </div>
                <div className="admin-contest-actions">
                  <span className={`phase-chip is-${c.phase}`}>{t.contests[c.phase]}</span>
                  {c.phase === 'upcoming' && (
                    <button className="nav-ghost-btn" onClick={() => openEdit(c.slug)}>
                      {t.admin.edit_contest}
                    </button>
                  )}
                  {c.phase === 'upcoming' && (
                    <button className="nav-ghost-btn" onClick={() => remove(c.slug)}>
                      {t.admin.delete_contest}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-rejudge">
        <h2 className="mono-label contest-section-title">{t.admin.rejudge_title}</h2>
        <p className="contest-note">{t.admin.rejudge_hint}</p>
        <div className="admin-rejudge-row">
          <input
            aria-label={t.admin.rejudge_problem_placeholder}
            placeholder={t.admin.rejudge_problem_placeholder}
            value={rejudgeProblem}
            onChange={(e) => setRejudgeProblem(e.target.value)}
          />
          <button
            className="btn btn-ghost"
            disabled={!rejudgeProblem.trim()}
            onClick={() => doRejudge('problem')}
          >
            {t.admin.rejudge_btn}
          </button>
        </div>
        <div className="admin-rejudge-row">
          <input
            aria-label={t.admin.rejudge_submission_placeholder}
            placeholder={t.admin.rejudge_submission_placeholder}
            value={rejudgeSubmission}
            onChange={(e) => setRejudgeSubmission(e.target.value)}
          />
          <button
            className="btn btn-ghost"
            disabled={!/^\d+$/.test(rejudgeSubmission.trim())}
            onClick={() => doRejudge('submission')}
          >
            {t.admin.rejudge_btn}
          </button>
        </div>
      </section>
    </div>
  );
}
