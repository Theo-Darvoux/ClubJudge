import Editor, { type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import type {
  RunCase,
  RunResult,
  Sample,
  Submission,
  SubmissionLanguage,
  Verdict,
} from '../api';
import { useNow } from '../contest-utils';
import { useI18n } from '../i18n/context';
import { CustomSelect } from './CustomSelect';
import { VerdictBadge, VerdictChip } from './badges';
import { outputsMatch } from './diff';
import { DiffView } from './DiffView';
import { registerIntellisense } from './editor-intellisense';
import type { LspProvider } from './lsp-setup';

const LANGUAGES: { id: SubmissionLanguage; label: string; monaco: string; ext: string }[] = [
  { id: 'python', label: 'Python', monaco: 'python', ext: 'py' },
  { id: 'cpp', label: 'C++', monaco: 'cpp', ext: 'cpp' },
  { id: 'c', label: 'C', monaco: 'c', ext: 'c' },
  { id: 'java', label: 'Java', monaco: 'java', ext: 'java' },
  { id: 'ocaml', label: 'OCaml', monaco: 'ocaml', ext: 'ml' },
];

const LANG_STORAGE_KEY = 'clubjudge.lang';
const HEIGHT_STORAGE_KEY = 'clubjudge.editorHeight';

function loadLastLanguage(): SubmissionLanguage {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  if (saved && LANGUAGES.some((l) => l.id === saved)) {
    return saved as SubmissionLanguage;
  }
  return 'python';
}

const TEMPLATES: Record<SubmissionLanguage, string> = {
  cpp: '#include <bits/stdc++.h>\n\nint main() {\n    \n}\n',
  python: '',
  c: '#include <stdio.h>\n\nint main(void) {\n    \n}\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n',
  ocaml: 'let () =\n  ()\n',
};

const POLL_INTERVAL_MS = 1000;
const COOLDOWN_S = 10;
// Une solution tient en quelques Ko ; ce plafond est large mais protège
// l'éditeur (et le navigateur) d'un fichier énorme déposé par erreur.
const MAX_UPLOAD_BYTES = 1_000_000;

function storageKey(slug: string, lang: SubmissionLanguage) {
  return `clubjudge.code.${slug}.${lang}`;
}

function loadCode(slug: string, lang: SubmissionLanguage): string {
  return localStorage.getItem(storageKey(slug, lang)) ?? TEMPLATES[lang];
}

// Petites icônes de barre d'outils (style « ligne », cohérentes entre elles).
// Les flèches nues ↑/↓ se confondaient avec de la navigation : ici le bac
// + flèche rend explicite l'idée d'import/export.
function ToolIcon({ paths }: { paths: React.ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

const ICON_TRAY = <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />;
const IconCopy = (
  <ToolIcon
    paths={
      <>
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    }
  />
);
const IconDownload = (
  <ToolIcon
    paths={
      <>
        {ICON_TRAY}
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    }
  />
);
const IconUpload = (
  <ToolIcon
    paths={
      <>
        {ICON_TRAY}
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </>
    }
  />
);
const IconReset = (
  <ToolIcon
    paths={
      <>
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </>
    }
  />
);

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
  samples = [],
  onSolved,
}: {
  slug: string;
  height?: string;
  showHistory?: boolean;
  samples?: Sample[];
  onSolved?: (attempts: number) => void;
}) {
  const { t } = useI18n();
  const [language, setLanguageState] = useState<SubmissionLanguage>(loadLastLanguage);
  const [code, setCode] = useState(() => loadCode(slug, loadLastLanguage()));
  const [history, setHistory] = useState<Submission[]>([]);
  const [current, setCurrent] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useCountdown();
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runCooldown, setRunCooldown] = useCountdown();
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Hauteur de l'éditeur ajustable (poignée), mémorisée globalement. En mode
  // compact (blocs TP), on garde la hauteur fixe passée en prop.
  const [editorHeight, setEditorHeight] = useState(() => {
    const base = parseInt(height, 10) || 420;
    if (!showHistory) return base;
    const saved = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));
    return saved >= 200 ? saved : base;
  });

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pyrightRef = useRef<LspProvider | null>(null);
  const clangdRef = useRef<LspProvider | null>(null);
  const ocamlRef = useRef<LspProvider | null>(null);
  // Historique le plus à jour, lisible depuis le polling (sans rejouer l'effet).
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    if (!showHistory) return;
    api.mySubmissions(slug).then(setHistory).catch(() => {});
  }, [slug, showHistory]);

  // Le bandeau d'erreur d'import s'efface tout seul (et reste cliquable pour
  // un rejet immédiat) — plus discret qu'une window.alert bloquante.
  useEffect(() => {
    if (!uploadError) return;
    const id = setTimeout(() => setUploadError(null), 5000);
    return () => clearTimeout(id);
  }, [uploadError]);

  // IntelliSense sémantique via les serveurs de langage côté serveur (basedpyright
  // pour Python, clangd pour C/C++), relayés en WebSocket par l'API (cf.
  // lsp-setup.ts + backend/app/lsp.py). Chargés à la demande, défensifs : on
  // retombe sur l'auto-complétion statique si le serveur (ou son binaire) est
  // indisponible. Les diagnostics se branchent par éditeur, donc on les coupe en
  // quittant le langage (sinon on linterait un langage avec l'analyseur d'un autre).
  const startPyright = useCallback(async () => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    try {
      if (!pyrightRef.current) {
        const { loadPyright } = await import('./lsp-setup');
        pyrightRef.current = await loadPyright(monaco);
      }
      pyrightRef.current.setupDiagnostics(editor);
    } catch (err) {
      console.warn('basedpyright indisponible — auto-complétion Python réduite.', err);
    }
  }, []);

  const startClangd = useCallback(async () => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    try {
      if (!clangdRef.current) {
        const { loadClangd } = await import('./lsp-setup');
        clangdRef.current = await loadClangd(monaco);
      }
      clangdRef.current.setupDiagnostics(editor);
    } catch (err) {
      console.warn('clangd indisponible — auto-complétion C/C++ réduite.', err);
    }
  }, []);

  const startOcaml = useCallback(async () => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    try {
      if (!ocamlRef.current) {
        const { loadOcaml } = await import('./lsp-setup');
        ocamlRef.current = await loadOcaml(monaco);
      }
      ocamlRef.current.setupDiagnostics(editor);
    } catch (err) {
      console.warn('ocamllsp indisponible — auto-complétion OCaml réduite.', err);
    }
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (language === 'python') {
      startPyright();
    } else if (editor) {
      pyrightRef.current?.stopDiagnostics(editor);
    }
    if (language === 'cpp' || language === 'c') {
      startClangd();
    } else if (editor) {
      clangdRef.current?.stopDiagnostics(editor);
    }
    if (language === 'ocaml') {
      startOcaml();
    } else if (editor) {
      ocamlRef.current?.stopDiagnostics(editor);
    }
  }, [language, startPyright, startClangd, startOcaml]);

  // Au démontage du Workbench (ex. navigation, ou bloc TP qui disparaît), on
  // détache cet éditeur des serveurs LSP : dispose l'écouteur et efface les
  // marqueurs. Le client lui-même (singleton) reste pour les autres éditeurs.
  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (!editor) return;
      pyrightRef.current?.stopDiagnostics(editor);
      clangdRef.current?.stopDiagnostics(editor);
      ocamlRef.current?.stopDiagnostics(editor);
    };
  }, []);

  const switchLanguage = useCallback(
    (next: SubmissionLanguage) => {
      setLanguageState(next);
      setCode(loadCode(slug, next));
      localStorage.setItem(LANG_STORAGE_KEY, next);
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
          if (updated.verdict === 'AC') {
            const prior = historyRef.current.filter((s) => s.id !== updated.id).length;
            onSolved?.(prior + 1);
          }
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

  // Exécute un unique exemple ; comme le juge ne compare pas une entrée
  // « personnalisée », on tranche AC/WA localement (même tolérance).
  const runSample = useCallback(
    async (input: string, expected: string): Promise<RunCase | null> => {
      if (busy || runBusy || runCooldown > 0 || !hasCode) return null;
      setRunBusy(true);
      try {
        const result = await api.run(slug, language, code, input);
        const c = result.cases[0];
        if (!c) return null;
        let verdict: Verdict = c.verdict;
        if (verdict === 'AC') {
          verdict = outputsMatch(expected, c.stdout ?? '') ? 'AC' : 'WA';
        }
        return { ...c, expected_output: expected, verdict };
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          const detail = err.detail as { retry_after_s?: number } | null;
          setRunCooldown(detail?.retry_after_s ?? 3);
        }
        return null;
      } finally {
        setRunBusy(false);
      }
    },
    [busy, runBusy, runCooldown, hasCode, slug, language, code, setRunCooldown],
  );

  // Les raccourcis Monaco capturent leur closure au montage : on passe par une
  // ref toujours à jour pour appeler les dernières fonctions/états.
  const actionsRef = useRef<{ run: () => void; submit: () => void }>({
    run: () => {},
    submit: () => {},
  });
  useEffect(() => {
    actionsRef.current.run = () => {
      if (canRun) run();
    };
    actionsRef.current.submit = () => {
      if (canSubmit) submit();
    };
  });

  const onEditorMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
        actionsRef.current.run(),
      );
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => actionsRef.current.submit(),
      );
      if (language === 'python') startPyright();
      if (language === 'cpp' || language === 'c') startClangd();
      if (language === 'ocaml') startOcaml();
    },
    [language, startPyright, startClangd, startOcaml],
  );

  // Poignée de redimensionnement vertical de l'éditeur.
  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = editorHeight;
      let lastH = startH;
      const onMove = (ev: PointerEvent) => {
        lastH = Math.min(900, Math.max(200, startH + ev.clientY - startY));
        setEditorHeight(lastH);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(lastH)));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [editorHeight],
  );

  function resetTemplate() {
    if (hasCode && !window.confirm(t.problem.reset_confirm)) return;
    const next = TEMPLATES[language];
    setCode(next);
    localStorage.setItem(storageKey(slug, language), next);
    editorRef.current?.setValue(next);
  }

  function copyCode() {
    navigator.clipboard?.writeText(code).catch(() => {});
  }

  function downloadCode() {
    const ext = LANGUAGES.find((l) => l.id === language)?.ext ?? 'txt';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Importe un fichier depuis le disque (l'utilisateur code dans son propre
  // éditeur). Garde-fous : on plafonne la taille avant toute lecture, puis on
  // refuse ce qui n'est pas du texte (octets nuls / décodage UTF-8 truffé de
  // remplacements) pour ne pas inonder Monaco d'un binaire. Le langage est
  // déduit de l'extension ; si elle est inconnue, on dépose le code tel quel
  // dans le langage courant.
  async function uploadCode(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(t.problem.upload_too_large);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const probe = Math.min(bytes.length, 8000);
    for (let i = 0; i < probe; i++) {
      if (bytes[i] === 0) {
        setUploadError(t.problem.upload_binary);
        return;
      }
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    let replacements = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 0xfffd && ++replacements > 8) {
        setUploadError(t.problem.upload_binary);
        return;
      }
    }
    setUploadError(null);
    if (hasCode && !window.confirm(t.problem.upload_confirm)) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const targetLang = LANGUAGES.find((l) => l.ext === ext)?.id ?? language;
    if (targetLang !== language) {
      setLanguageState(targetLang);
      localStorage.setItem(LANG_STORAGE_KEY, targetLang);
    }
    setCode(text);
    localStorage.setItem(storageKey(slug, targetLang), text);
    editorRef.current?.setValue(text);
  }

  async function restoreSubmission(s: Submission) {
    try {
      const detail = await api.submission(s.id);
      if (!detail.source_code) return;
      if (s.language !== language) {
        setLanguageState(s.language);
        localStorage.setItem(LANG_STORAGE_KEY, s.language);
      }
      setCode(detail.source_code);
      localStorage.setItem(storageKey(slug, s.language), detail.source_code);
      editorRef.current?.setValue(detail.source_code);
    } catch {
      // soumission introuvable : on ne fait rien
    }
  }

  const coachVerdict =
    current?.status === 'done' && current.verdict && current.verdict !== 'AC'
      ? current.verdict
      : null;

  return (
    <section className="workbench">
      <div className="workbench-bar">
        <span className="mono-label">{t.problem.editor_title}</span>
        <div className="workbench-tools">
          <button className="tool-btn" onClick={copyCode} title={t.problem.copy_code}>
            {IconCopy}
          </button>
          <button className="tool-btn" onClick={downloadCode} title={t.problem.download_code}>
            {IconDownload}
          </button>
          <button
            className="tool-btn"
            onClick={() => fileInputRef.current?.click()}
            title={t.problem.upload_code}
          >
            {IconUpload}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadCode(f);
              e.target.value = ''; // réautorise le même fichier deux fois de suite
            }}
          />
          <button className="tool-btn" onClick={resetTemplate} title={t.problem.reset_template}>
            {IconReset}
          </button>
        </div>
        <CustomSelect
          className="workbench-lang-select"
          value={language}
          onChange={(val) => switchLanguage(val as SubmissionLanguage)}
          options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
          ariaLabel={t.problem.language}
        />
      </div>

      {uploadError && (
        <button
          type="button"
          className="workbench-error"
          role="alert"
          onClick={() => setUploadError(null)}
        >
          <span className="workbench-error-glyph" aria-hidden="true">
            ⚠
          </span>
          {uploadError}
        </button>
      )}

      <div className="editor-frame">
        <Editor
          height={editorHeight}
          language={monacoLang}
          value={code}
          onChange={onCodeChange}
          onMount={onEditorMount}
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
            registerIntellisense(monaco);
          }}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            // Monaco ne rend que les lignes du viewport (rendu virtualisé) : un
            // gros fichier importé n'injecte pas tout le DOM d'un coup. On garde
            // les optimisations « gros fichier » actives et le retour à la ligne
            // désactivé pour ne pas reflouer des milliers de lignes.
            largeFileOptimizations: true,
            wordWrap: 'off',
            fontSize: 14,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            scrollBeyondLastLine: false,
            padding: { top: 12 },
            // Rend les popups (complétion, hover, signature) au niveau du body :
            // sinon ils sont rognés par l'overflow: hidden de .editor-frame.
            fixedOverflowWidgets: true,
            // Auto-complétion plus réactive (snippets en tête + mots du buffer).
            quickSuggestions: { other: true, comments: false, strings: false },
            suggestOnTriggerCharacters: true,
            tabCompletion: 'on',
            snippetSuggestions: 'top',
            wordBasedSuggestions: 'currentDocument',
          }}
        />
      </div>
      {showHistory && (
        <div
          className="editor-resize"
          onPointerDown={onResizeStart}
          role="separator"
          aria-orientation="horizontal"
          title={t.problem.resize_editor}
        >
          <span className="editor-resize-grip" aria-hidden="true" />
        </div>
      )}

      <div className="submit-row submit-row--sticky">
        <button
          className="btn btn-ghost"
          onClick={() => run()}
          disabled={!canRun}
          title={`${t.problem.run} · ${t.problem.shortcut_run}`}
        >
          {runBusy
            ? t.problem.running
            : runCooldown > 0
              ? t.problem.cooldown(runCooldown)
              : t.problem.run}
        </button>
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={!canSubmit}
          title={`${t.problem.submit} · ${t.problem.shortcut_submit}`}
        >
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

      {coachVerdict && (
        <CoachCard verdict={coachVerdict} />
      )}

      {samples.length > 0 && (
        <SamplesPanel samples={samples} runSample={runSample} disabled={!canRun} />
      )}

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

      {showHistory && <SubmissionHistory history={history} onRestore={restoreSubmission} />}
    </section>
  );
}

function CoachCard({ verdict }: { verdict: Verdict }) {
  const { t } = useI18n();
  const tip = t.problem.coach[verdict as keyof typeof t.problem.coach];
  if (!tip) return null;
  return (
    <aside className={`coach-card v-${verdict}`}>
      <span className="coach-glyph" aria-hidden="true">
        💡
      </span>
      <div>
        <p className="coach-title mono-label">{t.problem.coach_title(t.verdict[verdict])}</p>
        <p className="coach-text">{tip}</p>
      </div>
    </aside>
  );
}

function SamplesPanel({
  samples,
  runSample,
  disabled,
}: {
  samples: Sample[];
  runSample: (input: string, expected: string) => Promise<RunCase | null>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  return (
    <div className="samples-panel">
      <button
        className="custom-input-toggle mono-label"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} {t.problem.samples_title} · {samples.length}
      </button>
      {open && (
        <div className="samples-list">
          {samples.map((s, i) => (
            <SampleCase
              key={i}
              index={i}
              sample={s}
              runSample={runSample}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SampleCase({
  index,
  sample,
  runSample,
  disabled,
}: {
  index: number;
  sample: Sample;
  runSample: (input: string, expected: string) => Promise<RunCase | null>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<RunCase | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const c = await runSample(sample.input, sample.expected_output);
    if (c) setResult(c);
    setBusy(false);
  }

  return (
    <section className={`run-case sample-case${result ? ` v-${result.verdict}` : ''}`}>
      <header className="run-case-head">
        <span className="mono-label">{t.problem.run_case(index + 1)}</span>
        {result && <VerdictBadge verdict={result.verdict} />}
        {result?.time_s != null && (
          <span className="run-time">{result.time_s.toFixed(2)} s</span>
        )}
        <button className="btn btn-ghost btn-mini" onClick={go} disabled={disabled || busy}>
          {busy ? t.problem.running : t.problem.run_this}
        </button>
      </header>
      <div className="run-case-body">
        <div className="run-io">
          <h4 className="mono-label">{t.problem.run_input}</h4>
          <pre>{sample.input || t.problem.run_empty_output}</pre>
        </div>
        {result && result.verdict === 'WA' ? (
          <div className="run-io">
            <h4 className="mono-label">{t.problem.run_diff}</h4>
            <DiffView expected={sample.expected_output} got={result.stdout ?? ''} />
          </div>
        ) : (
          <div className="run-io">
            <h4 className="mono-label">{t.problem.run_expected}</h4>
            <pre>{sample.expected_output || t.problem.run_empty_output}</pre>
          </div>
        )}
        {result && result.verdict !== 'AC' && result.verdict !== 'WA' && (
          <div className="run-io">
            <h4 className="mono-label">{t.problem.run_got}</h4>
            <pre>{result.stdout || t.problem.run_empty_output}</pre>
          </div>
        )}
        {result?.stderr && (
          <div className="run-io run-stderr">
            <h4 className="mono-label">{t.problem.run_stderr}</h4>
            <pre>{result.stderr}</pre>
          </div>
        )}
      </div>
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
        const showDiff = !isCustom && c.verdict === 'WA' && c.expected_output !== null;
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
                {showDiff ? (
                  <div className="run-io">
                    <h4 className="mono-label">{t.problem.run_diff}</h4>
                    <DiffView expected={c.expected_output ?? ''} got={c.stdout ?? ''} />
                  </div>
                ) : (
                  <>
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
                  </>
                )}
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

function SubmissionHistory({
  history,
  onRestore,
}: {
  history: Submission[];
  onRestore: (s: Submission) => void;
}) {
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
              <th />
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
                <td className="num">
                  <button
                    className="btn btn-ghost btn-mini"
                    onClick={() => onRestore(s)}
                    title={t.problem.reuse_code}
                  >
                    {t.problem.reuse}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
