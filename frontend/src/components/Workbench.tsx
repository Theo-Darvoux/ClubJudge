import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import type { RunResult, Submission, SubmissionLanguage } from '../api';
import { useNow } from '../contest-utils';
import { useI18n } from '../i18n/context';
import { VerdictBadge, VerdictChip } from './badges';

const LANGUAGES: { id: SubmissionLanguage; label: string; monaco: string }[] = [
  { id: 'cpp', label: 'C++', monaco: 'cpp' },
  { id: 'python', label: 'Python', monaco: 'python' },
  { id: 'c', label: 'C', monaco: 'c' },
  { id: 'java', label: 'Java', monaco: 'java' },
];

const TEMPLATES: Record<SubmissionLanguage, string> = {
  cpp: '#include <bits/stdc++.h>\n\nint main() {\n    \n}\n',
  python: '',
  c: '#include <stdio.h>\n\nint main(void) {\n    \n}\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n',
};

const POLL_INTERVAL_MS = 1000;
const COOLDOWN_S = 10;

function storageKey(slug: string, lang: SubmissionLanguage) {
  return `clubjudge.code.${slug}.${lang}`;
}

function loadCode(slug: string, lang: SubmissionLanguage): string {
  return localStorage.getItem(storageKey(slug, lang)) ?? TEMPLATES[lang];
}

function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

/* Éditeur + exécution sur les exemples + soumission : le poste de travail
   complet d'un problème. Utilisé en grand sur la page problème et en compact
   dans les blocs TP des articles de cours (le code est partagé entre les
   deux via le même localStorage). */
export function Workbench({
  slug,
  height = '420px',
  showHistory = true,
  onSolved,
}: {
  slug: string;
  height?: string;
  showHistory?: boolean;
  onSolved?: () => void;
}) {
  const { t } = useI18n();
  const [language, setLanguageState] = useState<SubmissionLanguage>('cpp');
  const [code, setCode] = useState(() => loadCode(slug, 'cpp'));
  const [history, setHistory] = useState<Submission[]>([]);
  const [current, setCurrent] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useCountdown();
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runCooldown, setRunCooldown] = useCountdown();
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');

  useEffect(() => {
    if (!showHistory) return;
    api.mySubmissions(slug).then(setHistory).catch(() => {});
  }, [slug, showHistory]);

  const switchLanguage = useCallback(
    (next: SubmissionLanguage) => {
      setLanguageState(next);
      setCode(loadCode(slug, next));
    },
    [slug],
  );

  const onCodeChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? '';
      setCode(next);
      localStorage.setItem(storageKey(slug, language), next);
    },
    [slug, language],
  );

  // Suivi en quasi-temps réel de la soumission en cours (polling 1 s).
  useEffect(() => {
    if (!current || current.status === 'done') return;
    const id = setTimeout(async () => {
      try {
        const updated = await api.submission(current.id);
        setCurrent(updated);
        if (updated.status === 'done') {
          setHistory((h) => [updated, ...h.filter((s) => s.id !== updated.id)]);
          if (updated.verdict === 'AC') onSolved?.();
        }
      } catch {
        // erreur transitoire : on retentera au prochain tick
      }
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [current, onSolved]);

  async function submit() {
    setBusy(true);
    try {
      const submission = await api.submit(slug, language, code);
      setCurrent(submission);
      setRunResult(null); // place au verdict : l'essai libre a fait son office
      setCooldown(COOLDOWN_S);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const detail = err.detail as { retry_after_s?: number } | null;
        setCooldown(detail?.retry_after_s ?? COOLDOWN_S);
      }
    } finally {
      setBusy(false);
    }
  }

  async function run(custom?: string) {
    setRunBusy(true);
    try {
      const result = await api.run(slug, language, code, custom);
      setRunResult(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const detail = err.detail as { retry_after_s?: number } | null;
        setRunCooldown(detail?.retry_after_s ?? 3);
      }
    } finally {
      setRunBusy(false);
    }
  }

  const monacoLang = LANGUAGES.find((l) => l.id === language)?.monaco ?? 'cpp';
  const hasCode = code.trim().length > 0;
  const canSubmit = !busy && !runBusy && cooldown === 0 && hasCode;
  const canRun = !busy && !runBusy && runCooldown === 0 && hasCode;

  return (
    <section className="workbench">
      <div className="workbench-bar">
        <span className="mono-label">{t.problem.editor_title}</span>
        <select
          value={language}
          onChange={(e) => switchLanguage(e.target.value as SubmissionLanguage)}
          aria-label={t.problem.language}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="editor-frame">
        <Editor
          height={height}
          language={monacoLang}
          value={code}
          onChange={onCodeChange}
          theme="clubjudge"
          beforeMount={(monaco) => {
            monaco.editor.defineTheme('clubjudge', {
              base: 'vs-dark',
              inherit: true,
              rules: [],
              colors: {
                'editor.background': '#0d0d15',
                'editorLineNumber.foreground': '#807c92',
              },
            });
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            scrollBeyondLastLine: false,
            padding: { top: 12 },
          }}
        />
      </div>

      <div className="submit-row">
        <button className="btn btn-ghost" onClick={() => run()} disabled={!canRun}>
          {runBusy
            ? t.problem.running
            : runCooldown > 0
              ? t.problem.cooldown(runCooldown)
              : t.problem.run}
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
          {busy
            ? t.problem.submitting
            : cooldown > 0
              ? t.problem.cooldown(cooldown)
              : t.problem.submit}
        </button>
        {current && <VerdictChip submission={current} />}
        {current?.status === 'done' &&
          current.verdict !== 'AC' &&
          current.verdict !== 'CE' &&
          current.failed_test != null && (
            <span className="failed-test">{t.problem.failed_test(current.failed_test)}</span>
          )}
      </div>

      <button
        className="custom-input-toggle mono-label"
        aria-expanded={showCustom}
        onClick={() => setShowCustom((v) => !v)}
      >
        {showCustom ? '▾' : '▸'} {t.problem.custom_input_toggle}
      </button>
      {showCustom && (
        <div className="custom-input">
          <textarea
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder={t.problem.custom_input_placeholder}
            rows={4}
            spellCheck={false}
          />
          <button className="btn btn-ghost" onClick={() => run(customInput)} disabled={!canRun}>
            {runBusy ? t.problem.running : t.problem.run_custom}
          </button>
        </div>
      )}

      {runResult && <RunResults result={runResult} />}

      {current?.status === 'done' && current.verdict === 'CE' && current.compile_output && (
        <details className="compile-output" open>
          <summary className="mono-label">{t.problem.compile_output}</summary>
          <pre>{current.compile_output}</pre>
        </details>
      )}

      {showHistory && <SubmissionHistory history={history} />}
    </section>
  );
}

function RunResults({ result }: { result: RunResult }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // Les résultats arrivent sous la ligne de flottaison : on les amène à l'écran.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [result]);
  const allPassed =
    result.cases.length > 0 &&
    result.cases.every((c) => c.verdict === 'AC' && c.expected_output !== null);

  return (
    <div className="run-results" ref={ref}>
      <div className="run-results-head">
        <h2 className="mono-label">{t.problem.run_results}</h2>
        <span className="run-note">{t.problem.run_no_judgment}</span>
      </div>

      {result.compile_output && (
        <details className="compile-output" open>
          <summary className="mono-label">{t.problem.compile_output}</summary>
          <pre>{result.compile_output}</pre>
        </details>
      )}

      {allPassed && <p className="run-all-passed">✓ {t.problem.run_all_passed}</p>}

      {result.cases.map((c, i) => {
        const isCustom = c.expected_output === null;
        // Un exemple AC n'a rien à montrer de plus ; on détaille les échecs
        // et toujours l'entrée personnalisée (voir sa sortie est le but).
        const showDetail = isCustom || c.verdict !== 'AC';
        return (
          <section key={i} className={`run-case v-${c.verdict}`}>
            <header className="run-case-head">
              <span className="mono-label">
                {isCustom ? t.problem.run_custom_case : t.problem.run_case(i + 1)}
              </span>
              <VerdictBadge verdict={c.verdict} />
              {c.time_s != null && <span className="run-time">{c.time_s.toFixed(2)} s</span>}
            </header>
            {showDetail && (
              <div className="run-case-body">
                {!isCustom && (
                  <div className="run-io">
                    <h4 className="mono-label">{t.problem.run_input}</h4>
                    <pre>{c.input || t.problem.run_empty_output}</pre>
                  </div>
                )}
                {c.expected_output !== null && (
                  <div className="run-io">
                    <h4 className="mono-label">{t.problem.run_expected}</h4>
                    <pre>{c.expected_output}</pre>
                  </div>
                )}
                <div className="run-io">
                  <h4 className="mono-label">{t.problem.run_got}</h4>
                  <pre>{c.stdout || t.problem.run_empty_output}</pre>
                </div>
                {c.stderr && (
                  <div className="run-io run-stderr">
                    <h4 className="mono-label">{t.problem.run_stderr}</h4>
                    <pre>{c.stderr}</pre>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SubmissionHistory({ history }: { history: Submission[] }) {
  const { t } = useI18n();
  // Horloge à 30 s : assez pour des temps relatifs à la minute.
  const now = useNow(30_000);

  function relativeTime(iso: string): string {
    const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
    if (minutes < 1) return t.problem.just_now;
    if (minutes < 60) return t.problem.minutes_ago(minutes);
    if (minutes < 48 * 60) return t.problem.hours_ago(Math.floor(minutes / 60));
    return new Date(iso).toLocaleDateString();
  }

  return (
    <div className="history">
      <h2 className="mono-label">{t.problem.history}</h2>
      {history.length === 0 ? (
        <p className="empty-state">{t.problem.no_submissions}</p>
      ) : (
        <table className="history-table">
          <thead>
            <tr>
              <th>{t.problem.th_when}</th>
              <th>{t.problem.th_lang}</th>
              <th>{t.problem.th_verdict}</th>
              <th className="num">{t.problem.th_time}</th>
              <th className="num">{t.problem.th_memory}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((s) => (
              <tr key={s.id}>
                <td>{relativeTime(s.created_at)}</td>
                <td>{LANGUAGES.find((l) => l.id === s.language)?.label ?? s.language}</td>
                <td>
                  <VerdictChip submission={s} />
                </td>
                <td className="num">{s.time_s != null ? `${s.time_s.toFixed(2)} s` : '—'}</td>
                <td className="num">
                  {s.memory_kb != null ? `${Math.round(s.memory_kb / 1024)} Mo` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
