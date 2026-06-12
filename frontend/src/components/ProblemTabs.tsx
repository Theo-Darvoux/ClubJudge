import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { api } from '../api';
import type { Editorial, ProblemDetail, SharedSolution, SubmissionLanguage } from '../api';
import { useI18n } from '../i18n/context';

type TabId = 'statement' | 'hints' | 'editorial' | 'solutions';

const LANGUAGE_LABELS: Record<SubmissionLanguage, string> = {
  cpp: 'C++',
  python: 'Python',
  c: 'C',
  java: 'Java',
};

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
      {children}
    </ReactMarkdown>
  );
}

function hintsKey(slug: string) {
  return `clubjudge.hints.${slug}`;
}

function loadRevealedHints(slug: string, total: number): number {
  const raw = Number(localStorage.getItem(hintsKey(slug)) ?? '0');
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), total) : 0;
}

export function ProblemTabs({ problem, slug }: { problem: ProblemDetail; slug: string }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<TabId>('statement');

  const statement =
    lang === 'en' && problem.statement_en ? problem.statement_en : problem.statement_fr;
  const showFallbackNote = lang === 'en' && !problem.statement_en;

  const tabs: { id: TabId; label: string; locked?: boolean }[] = [
    { id: 'statement', label: t.problem.tabs.statement },
  ];
  // Pendant un contest, conditions ICPC : énoncé seul (l'API ferme de toute
  // façon indices, éditorial et solutions tant que la fenêtre est ouverte).
  if (!problem.contest) {
    tabs.push({ id: 'hints', label: `${t.problem.tabs.hints} · ${problem.hints.length}` });
    if (problem.has_editorial) {
      tabs.push({ id: 'editorial', label: t.problem.tabs.editorial, locked: !problem.solved });
    }
    tabs.push({ id: 'solutions', label: t.problem.tabs.solutions, locked: !problem.solved });
  }

  return (
    <article className="statement">
      <div className="statement-tabs" role="tablist">
        {tabs.map(({ id, label, locked }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`statement-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {locked && (
              <span className="tab-lock" aria-hidden="true">
                ⬡
              </span>
            )}
            {label}
          </button>
        ))}
      </div>

      {tab === 'statement' && (
        <div className="tab-panel">
          {showFallbackNote && <p className="mono-label">{t.problem.statement_fallback_fr}</p>}
          <Markdown>{statement}</Markdown>
        </div>
      )}
      {tab === 'hints' && <HintsPanel slug={slug} hints={problem.hints} />}
      {tab === 'editorial' && <EditorialPanel slug={slug} solved={problem.solved} />}
      {tab === 'solutions' && <SolutionsPanel slug={slug} solved={problem.solved} />}
    </article>
  );
}

function HintsPanel({ slug, hints }: { slug: string; hints: string[] }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(() => loadRevealedHints(slug, hints.length));

  if (hints.length === 0) {
    return (
      <div className="tab-panel">
        <p className="empty-state">{t.problem.no_hints}</p>
      </div>
    );
  }

  function revealNext() {
    const next = revealed + 1;
    setRevealed(next);
    localStorage.setItem(hintsKey(slug), String(next));
  }

  return (
    <div className="tab-panel">
      <p className="hints-intro">{t.problem.hints_intro}</p>
      {hints.slice(0, revealed).map((hint, i) => (
        <section key={i} className="hint-card">
          <h3 className="mono-label">{t.problem.hint_label(i + 1)}</h3>
          <Markdown>{hint}</Markdown>
        </section>
      ))}
      {revealed < hints.length && (
        <button className="btn btn-ghost hint-reveal" onClick={revealNext}>
          {t.problem.reveal_hint(revealed + 1, hints.length)}
        </button>
      )}
    </div>
  );
}

function LockedPanel({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="tab-panel locked-panel">
      <span className="locked-glyph" aria-hidden="true">
        ⬡
      </span>
      <h3>{t.problem.locked_title}</h3>
      <p>{message}</p>
    </div>
  );
}

function EditorialPanel({ slug, solved }: { slug: string; solved: boolean }) {
  const { t, lang } = useI18n();
  const [editorial, setEditorial] = useState<Editorial | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!solved) return;
    api
      .editorial(slug)
      .then(setEditorial)
      .catch(() => setFailed(true));
  }, [slug, solved]);

  if (!solved) return <LockedPanel message={t.problem.editorial_locked} />;
  if (failed) {
    return (
      <div className="tab-panel">
        <p className="empty-state">{t.problem.no_editorial}</p>
      </div>
    );
  }
  if (!editorial) {
    return (
      <div className="tab-panel">
        <p className="mono-label">{t.problems.loading}</p>
      </div>
    );
  }
  const text =
    lang === 'en' && editorial.editorial_en ? editorial.editorial_en : editorial.editorial_fr;
  return (
    <div className="tab-panel">
      <Markdown>{text}</Markdown>
    </div>
  );
}

function SolutionsPanel({ slug, solved }: { slug: string; solved: boolean }) {
  const { t } = useI18n();
  const [solutions, setSolutions] = useState<SharedSolution[] | null>(null);
  const [language, setLanguage] = useState<SubmissionLanguage | 'all'>('all');
  const [sort, setSort] = useState<'time' | 'memory' | 'recent'>('time');

  useEffect(() => {
    if (!solved) return;
    api
      .solutions(slug)
      .then(setSolutions)
      .catch(() => setSolutions([]));
  }, [slug, solved]);

  if (!solved) return <LockedPanel message={t.problem.solutions_locked} />;
  if (solutions === null) {
    return (
      <div className="tab-panel">
        <p className="mono-label">{t.problems.loading}</p>
      </div>
    );
  }

  const visible = solutions
    .filter((s) => language === 'all' || s.language === language)
    .sort((a, b) => {
      if (sort === 'time') return (a.time_s ?? Infinity) - (b.time_s ?? Infinity);
      if (sort === 'memory') return (a.memory_kb ?? Infinity) - (b.memory_kb ?? Infinity);
      return b.created_at.localeCompare(a.created_at);
    });
  const languages = [...new Set(solutions.map((s) => s.language))];

  return (
    <div className="tab-panel">
      {solutions.length === 0 ? (
        <p className="empty-state">{t.problem.no_solutions}</p>
      ) : (
        <>
          <div className="solutions-bar">
            <p className="hints-intro">{t.problem.solutions_intro}</p>
            <div className="solutions-filters">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as SubmissionLanguage | 'all')}
                aria-label={t.problem.th_lang}
              >
                <option value="all">{t.problem.all_languages}</option>
                {languages.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label={t.problem.sort_time}
              >
                <option value="time">{t.problem.sort_time}</option>
                <option value="memory">{t.problem.sort_memory}</option>
                <option value="recent">{t.problem.sort_recent}</option>
              </select>
            </div>
          </div>
          {visible.map((s) => (
            <section key={s.id} className="solution-card">
              <header>
                <span className="solution-author">
                  {s.author}
                  {s.is_mine && <span className="chip mine-chip">{t.problem.mine_badge}</span>}
                </span>
                <span className="solution-meta mono-label">
                  {LANGUAGE_LABELS[s.language]}
                  {s.time_s != null && ` · ${s.time_s.toFixed(2)} s`}
                  {s.memory_kb != null && ` · ${Math.round(s.memory_kb / 1024)} Mo`}
                </span>
              </header>
              <pre className="solution-code">
                <code>{s.source_code}</code>
              </pre>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
