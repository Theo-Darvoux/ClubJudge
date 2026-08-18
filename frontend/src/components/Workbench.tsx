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
import { useMountedRef } from '../hooks';
import { fmtMemoryMo, fmtTimeS } from '../format';
import { estimateSolvedAttempts, prependSubmission } from '../problems/attempts';
import { useI18n } from '../i18n/context';
import { LANGUAGE_BY_ID, LANGUAGES, languageForExt, languageLabel } from '../languages';
import { CustomSelect } from './CustomSelect';
import { VerdictBadge, VerdictChip } from './badges';
import { DiffView } from './DiffView';
import { registerIntellisense } from './editor-intellisense';
import type { LspProvider } from './lsp-setup';

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

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ value: l.id, label: l.label }));

// Quel serveur de langage outille chaque langage (complétion sémantique +
// diagnostics). Plusieurs langages peuvent partager le même serveur (C et C++
// → clangd) ; un langage absent de la table n'a pas de LSP (auto-complétion
// statique seule).
type LspKey = 'pyright' | 'clangd' | 'ocaml';

const LSP_BY_LANG: Partial<Record<SubmissionLanguage, LspKey>> = {
  python: 'pyright',
  cpp: 'clangd',
  c: 'clangd',
  ocaml: 'ocaml',
};

// Chargeurs (import dynamique du client correspondant) indexés par serveur.
const LSP_LOADERS: Record<LspKey, (monaco: Parameters<OnMount>[1]) => Promise<LspProvider>> = {
  pyright: (m) => import('./lsp-setup').then((mod) => mod.loadPyright(m)),
  clangd: (m) => import('./lsp-setup').then((mod) => mod.loadClangd(m)),
  ocaml: (m) => import('./lsp-setup').then((mod) => mod.loadOcaml(m)),
};

// Bornes de la hauteur ajustable de l'éditeur, partagées par le chargement
// (valeur mémorisée) et le glissement de la poignée — pour qu'une valeur stockée
// trop grande soit aussi plafonnée.
const EDITOR_MIN_H = 200;
const EDITOR_MAX_H = 900;

const POLL_INTERVAL_MS = 1000;
// Au-delà de tant d'échecs réseau consécutifs, on cesse de relancer le polling
// (sinon une soumission bloquée le rejouerait toutes les secondes sans fin) et on
// invite à recharger.
const MAX_POLL_ERRORS = 10;
// Repli si l'en-tête Retry-After manque : le serveur reste la source de vérité
// (cf. api.submit/api.run), ces valeurs ne servent qu'en dépannage.
const COOLDOWN_S = 10;
const RUN_COOLDOWN_S = 1;
// Limites de transport (octets), reflétées du backend (MAX_SOURCE_BYTES /
// MAX_CUSTOM_INPUT_BYTES, cf. backend/app/submissions.py). On valide côté client
// pour un retour immédiat sans aller-retour, mais le serveur reste la source de
// vérité : un 413 résiduel est mappé par code (cf. describeError). Une solution
// tient en quelques Ko ; ces plafonds sont larges mais protègent l'éditeur (et le
// navigateur) d'un fichier énorme déposé par erreur.
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_CUSTOM_INPUT_BYTES = 64 * 1024;

// Taille en octets (UTF-8) d'une chaîne : sert à valider code et entrée contre
// les limites ci-dessus avant l'envoi (un caractère ≠ un octet hors ASCII).
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function storageKey(slug: string, lang: SubmissionLanguage) {
  return `clubjudge.code.${slug}.${lang}`;
}

// Message d'erreur (localisé) affiché dans le bandeau, partagé par
// soumission/exécution. Une ApiError porte un statut HTTP ; tout le reste est un
// échec réseau (serveur injoignable).
type ActionErrorMessages = {
  action_error_network: string;
  action_error_server: (status: number) => string;
  source_too_large: string;
  input_too_large: string;
};
function describeError(err: unknown, msg: ActionErrorMessages): string {
  if (err instanceof ApiError) {
    // Le backend distingue le 413 par code : `input_too_large` pour l'entrée
    // personnalisée, `source_too_large` (défaut) pour le code source. On choisit le
    // message en conséquence au lieu d'en supposer un seul.
    if (err.status === 413) {
      return err.code === 'input_too_large' ? msg.input_too_large : msg.source_too_large;
    }
    return msg.action_error_server(err.status);
  }
  return msg.action_error_network;
}

// Cooldown réclamé par un 429 : valeur serveur (retry_after_s) ou repli.
function retryAfterFrom(err: ApiError, fallback: number): number {
  const detail = err.detail as { retry_after_s?: number } | null;
  return detail?.retry_after_s ?? fallback;
}

function loadCode(slug: string, lang: SubmissionLanguage): string {
  return localStorage.getItem(storageKey(slug, lang)) ?? TEMPLATES[lang];
}

// Copie de repli (contexte non sécurisé, sans navigator.clipboard) : textarea
// hors écran + execCommand. Renvoie true si la copie a abouti.
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
const IconCheck = <ToolIcon paths={<polyline points="20 6 9 17 4 12" />} />;

function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

// Efface tout seul un bandeau d'erreur au bout de `ms` (il reste cliquable pour
// un rejet immédiat). `reset` est le setter d'état React, stable d'un rendu à
// l'autre — d'où une dépendance sans re-création du minuteur à chaque frappe.
const AUTO_DISMISS_MS = 5000;
function useAutoDismiss(value: string | null, reset: (v: null) => void) {
  useEffect(() => {
    if (!value) return;
    const id = setTimeout(() => reset(null), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [value, reset]);
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
  onSolved?: (attempts: number, isEstimated: boolean) => void;
}) {
  const { t } = useI18n();
  const [language, setLanguageState] = useState<SubmissionLanguage>(loadLastLanguage);
  const [code, setCode] = useState(() => loadCode(slug, language));
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
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pollTrigger, setPollTrigger] = useState(0);
  // Soumission dont on recharge le code (aller-retour réseau) : verrouille et
  // signale la ligne « réutiliser » correspondante de l'historique.
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const mounted = useMountedRef();
  const [editorMounted, setEditorMounted] = useState(false);

  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  // `t` change d'identité à chaque bascule de langue de l'interface : on le lit
  // via une ref dans le polling pour ne pas relancer son minuteur (et donc
  // retarder le prochain sondage) à chaque changement de langue.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });
  // Hauteur de l'éditeur ajustable (poignée), mémorisée globalement. En mode
  // compact (blocs TP), on garde la hauteur fixe passée en prop.
  const [editorHeight, setEditorHeight] = useState(() => {
    const base = parseInt(height, 10) || 420;
    if (!showHistory) return base;
    const saved = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));
    return saved >= EDITOR_MIN_H ? Math.min(saved, EDITOR_MAX_H) : base;
  });

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorFrameRef = useRef<HTMLDivElement | null>(null);
  // Échecs réseau consécutifs du polling (remis à zéro à chaque réponse reçue).
  const pollErrorsRef = useRef(0);
  // Un client par serveur de langage, chargé à la demande puis réutilisé (un
  // même serveur sert plusieurs éditeurs/langages).
  const lspRefs = useRef<Partial<Record<LspKey, LspProvider>>>({});
  // Historique le plus à jour, lisible depuis le polling (sans rejouer l'effet).
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    if (!showHistory) return;
    api
      .mySubmissions(slug)
      .then((subs) => {
        setHistory(subs);
        // Reprend le suivi d'une soumission encore en jugement (ex. on a quitté la
        // page puis on est revenu : `current` avait été perdu au démontage). Sans
        // cela, sa ligne resterait « en file » dans l'historique sans jamais se
        // mettre à jour. Le polling repart dès que `current` est posé.
        const pending = subs.find((s) => s.status !== 'done');
        if (pending) setCurrent(pending);
      })
      .catch(() => {});
  }, [slug, showHistory]);

  // Les bandeaux d'erreur (import refusé, échec d'action) s'effacent seuls —
  // plus discrets qu'une window.alert bloquante.
  useAutoDismiss(uploadError, setUploadError);
  // Les erreurs d'action/réseau restent visibles jusqu'à fermeture explicite ou
  // nouvelle action : cinq secondes étaient trop courtes pour un lecteur d'écran.

  // IntelliSense sémantique via les serveurs de langage côté serveur (basedpyright
  // pour Python, clangd pour C/C++, ocamllsp pour OCaml), relayés en WebSocket par
  // l'API (cf. lsp-setup.ts + backend/app/lsp.py). Chargés à la demande, défensifs :
  // on retombe sur l'auto-complétion statique si le serveur (ou son binaire) est
  // indisponible. Les diagnostics se branchent par éditeur.
  const startLsp = useCallback(async (lang: SubmissionLanguage) => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const key = LSP_BY_LANG[lang];
    if (!key) return;
    try {
      let provider = lspRefs.current[key];
      if (!provider) {
        const loaded = await LSP_LOADERS[key](monaco);
        if (!mounted.current || languageRef.current !== lang) return;
        provider = loaded;
        lspRefs.current[key] = provider;
      } else {
        if (!mounted.current || languageRef.current !== lang) return;
      }
      provider.setupDiagnostics(editor);
    } catch (err) {
      console.warn(`Serveur de langage « ${key} » indisponible — auto-complétion réduite.`, err);
    }
  }, [mounted]);

  // Détache de cet éditeur les diagnostics des serveurs chargés, sauf
  // (optionnellement) celui qu'on s'apprête à rebrancher — sinon on linterait un
  // langage avec l'analyseur d'un autre.
  const stopDiagnostics = useCallback((except?: LspKey) => {
    const editor = editorRef.current;
    if (!editor) return;
    for (const [key, provider] of Object.entries(lspRefs.current)) {
      if (key !== except) provider?.stopDiagnostics(editor);
    }
  }, []);

  useEffect(() => {
    if (!editorMounted) return;
    const key = LSP_BY_LANG[language];
    stopDiagnostics(key);
    if (key) startLsp(language);
  }, [language, editorMounted, startLsp, stopDiagnostics]);

  // Au démontage du Workbench (ex. navigation, ou bloc TP qui disparaît), on
  // détache cet éditeur des serveurs LSP : dispose l'écouteur et efface les
  // marqueurs. Le client lui-même (singleton) reste pour les autres éditeurs.
  useEffect(() => {
    return () => stopDiagnostics();
  }, [stopDiagnostics]);

  // Bascule + mémorise le langage choisi (réutilisé par l'import et la reprise
  // d'une soumission, qui changent de langage en posant leur propre code).
  const persistLanguage = useCallback((next: SubmissionLanguage) => {
    setLanguageState(next);
    localStorage.setItem(LANG_STORAGE_KEY, next);
  }, []);

  // Retire un verdict TERMINÉ devenu obsolète (le code ou l'entrée qu'il décrivait
  // a changé) ; un jugement encore EN COURS est laissé intact (il est persisté et
  // atterrira dans l'historique). Point unique partagé par tous les chemins qui
  // remplacent le buffer ou relancent un essai, pour qu'aucun ne puisse l'oublier.
  const clearFinishedVerdict = useCallback(() => {
    setCurrent((c) => (c && c.status === 'done' ? null : c));
  }, []);

  // Point d'entrée unique pour remplacer ce qu'il y a dans l'éditeur (bascule de
  // langage, réinitialisation, import, réutilisation). Centralisé pour qu'aucun
  // chemin ne puisse remplacer le buffer en oubliant d'effacer les résultats qui
  // décrivaient l'ANCIEN buffer : un résultat d'essai ou un verdict terminé ne doit
  // jamais s'afficher à côté d'un code qui n'est plus là.
  const replaceEditor = useCallback(
    (nextCode: string, lang: SubmissionLanguage = languageRef.current) => {
      if (lang !== languageRef.current) persistLanguage(lang);
      setCode(nextCode);
      localStorage.setItem(storageKey(slug, lang), nextCode);
      setRunResult(null);
      clearFinishedVerdict();
    },
    [slug, persistLanguage, clearFinishedVerdict],
  );

  const switchLanguage = useCallback(
    (next: SubmissionLanguage) => {
      replaceEditor(loadCode(slug, next), next);
    },
    [slug, replaceEditor],
  );

  const onCodeChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? '';
      setCode(next);
      localStorage.setItem(storageKey(slug, languageRef.current), next);
      clearFinishedVerdict();
    },
    [slug, clearFinishedVerdict],
  );

  // Suivi en quasi-temps réel de la soumission en cours (polling 1 s).
  useEffect(() => {
    if (!current || current.status === 'done') return;
    let active = true;
    const id = setTimeout(async () => {
      try {
        const updated = await api.submission(current.id);
        if (!active) return;
        pollErrorsRef.current = 0; // réponse reçue : on repart à zéro
        // Tant que ce n'est pas terminé, `updated` est un nouvel objet à chaque
        // tour : le setCurrent relance l'effet (donc le prochain sondage) sans
        // qu'on ait à incrémenter pollTrigger — celui-ci ne sert qu'au réarmement
        // du chemin d'erreur, où `current` ne change pas.
        setCurrent(updated);
        setHistory((h) => prependSubmission(h, updated));
        if (updated.status === 'done' && updated.verdict === 'AC') {
          const { attempts, isEstimated } = estimateSolvedAttempts(historyRef.current, updated);
          onSolved?.(attempts, isEstimated);
        }
      } catch {
        if (!active) return;
        // On retente, mais pas indéfiniment : au-delà du seuil on abandonne le
        // suivi. On oublie alors la soumission en cours (setCurrent(null)) pour
        // débloquer le bouton « soumettre » — sinon `submissionPending` resterait
        // vrai et forcerait un rechargement de page.
        if (++pollErrorsRef.current >= MAX_POLL_ERRORS) {
          setCurrent(null);
          setActionError(tRef.current.problem.poll_failed);
        } else {
          setPollTrigger((p) => p + 1);
        }
      }
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [current, pollTrigger, onSolved]);

  // Aiguillage commun des erreurs d'action : un 429 arme le compte à rebours
  // (setter et repli propres à l'action), tout le reste affiche le bandeau.
  const handleActionError = useCallback(
    (err: unknown, setCooldownFor: (n: number) => void, fallback: number) => {
      if (err instanceof ApiError && err.status === 429) {
        setCooldownFor(retryAfterFrom(err, fallback));
      } else {
        setActionError(describeError(err, t.problem));
      }
    },
    [t],
  );

  // Toute exécution d'essai (tous les exemples, un exemple unique, ou une entrée
  // personnalisée) repart d'un affichage propre : on retire le résultat d'essai
  // précédent et le verdict d'une soumission DÉJÀ terminée, qui décrivaient un
  // autre code ou une autre entrée. Point unique partagé par `run` et
  // `runSample` pour qu'ils ne puissent plus diverger (l'un oubliait ce
  // nettoyage et laissait un panneau de résultats périmé à côté du nouveau).
  const beginRun = useCallback(() => {
    setActionError(null);
    setRunResult(null);
    clearFinishedVerdict();
  }, [clearFinishedVerdict]);

  // Valide la taille du code (et, le cas échéant, d'une entrée personnalisée)
  // contre les limites du backend AVANT tout envoi : retour immédiat avec le bon
  // message, sans requête perdue. Pose le bandeau et renvoie false si trop gros.
  // Partagé par soumission et essais pour qu'aucun chemin n'échappe au contrôle.
  const validateSizes = useCallback(
    (custom?: string): boolean => {
      if (byteLength(code) > MAX_SOURCE_BYTES) {
        setActionError(t.problem.source_too_large);
        return false;
      }
      if (custom !== undefined && byteLength(custom) > MAX_CUSTOM_INPUT_BYTES) {
        setActionError(t.problem.input_too_large);
        return false;
      }
      return true;
    },
    [code, t],
  );

  async function submit() {
    if (!validateSizes()) return;
    setBusy(true);
    setUploadError(null); // un bandeau d'import obsolète n'a plus lieu d'être
    setActionError(null);
    try {
      const { submission, cooldownS } = await api.submit(slug, language, code);
      pollErrorsRef.current = 0; // nouvelle soumission : compteur d'échecs remis à zéro
      setCurrent(submission);
      setHistory((h) => prependSubmission(h, submission));
      setRunResult(null); // place au verdict : l'essai libre a fait son office
      setCooldown(cooldownS ?? COOLDOWN_S);
    } catch (err) {
      handleActionError(err, setCooldown, COOLDOWN_S);
    } finally {
      setBusy(false);
    }
  }

  async function run(custom?: string) {
    if (!validateSizes(custom)) return;
    setRunBusy(true);
    beginRun();
    try {
      const { result, cooldownS } = await api.run(slug, language, code, { customInput: custom });
      setRunResult(result);
      setRunCooldown(cooldownS ?? RUN_COOLDOWN_S); // le serveur impose un délai entre essais
    } catch (err) {
      handleActionError(err, setRunCooldown, RUN_COOLDOWN_S);
    } finally {
      setRunBusy(false);
    }
  }

  const monacoLang = LANGUAGE_BY_ID[language]?.monaco ?? 'cpp';
  const hasCode = code.trim().length > 0;
  // Une soumission encore en cours de jugement bloque la suivante : sinon elle
  // remplacerait `current`, et son verdict (ainsi que la célébration d'un AC)
  // serait perdu sans recharger la page.
  const submissionPending = current != null && current.status !== 'done';
  const canSubmit = !busy && !runBusy && cooldown === 0 && hasCode && !submissionPending;
  const canRun = !busy && !runBusy && runCooldown === 0 && hasCode;
  const hasSamples = samples.length > 0;

  // Exécute un unique exemple (par index) : le juge compare la sortie attendue
  // et renvoie déjà le verdict AC/WA — pas de comparaison à refaire côté client.
  const runSample = useCallback(
    async (index: number): Promise<RunCase | null> => {
      if (busy || runBusy || runCooldown > 0 || !hasCode) return null;
      if (!validateSizes()) return null;
      setRunBusy(true);
      beginRun();
      try {
        const { result, cooldownS } = await api.run(slug, language, code, { sampleIndex: index });
        setRunCooldown(cooldownS ?? RUN_COOLDOWN_S); // le serveur impose un délai entre essais
        return result.cases[0] ?? null;
      } catch (err) {
        handleActionError(err, setRunCooldown, RUN_COOLDOWN_S);
        return null;
      } finally {
        setRunBusy(false);
      }
    },
    [busy, runBusy, runCooldown, hasCode, slug, language, code, setRunCooldown, handleActionError, beginRun, validateSizes],
  );

  // Les raccourcis Monaco capturent leur closure au montage : on passe par une
  // ref toujours à jour pour appeler les dernières fonctions/états.
  const actionsRef = useRef<{ run: () => void; submit: () => void }>({
    run: () => {},
    submit: () => {},
  });
  useEffect(() => {
    actionsRef.current.run = () => {
      if (!canRun) return;
      // Même règle que les boutons « exécuter » visibles : on lance les exemples
      // de l'énoncé, ou — à défaut (ex. bloc TP) — l'entrée personnalisée. Le
      // raccourci et les boutons partagent ainsi exactement la même définition de
      // « exécuter », sans pouvoir diverger (le serveur tolère une entrée vide).
      if (hasSamples) run();
      else run(customInput);
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
      setEditorMounted(true);
    },
    [],
  );

  // Poignée de redimensionnement vertical de l'éditeur. Pendant le glissement on
  // mute directement la hauteur du cadre (Monaco se réajuste via automaticLayout)
  // au lieu de passer par l'état : on évite un re-rendu complet à chaque pixel.
  // La valeur n'est figée dans l'état (rendu contrôlé + persistance) qu'au relâché.
  // On garde une référence vers le détachement des écouteurs en cours pour pouvoir
  // les retirer si le Workbench se démonte au beau milieu d'un glissement.
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanupRef.current?.(), []);
  // Minuteur du retour visuel « copié » : annulé au démontage (et réarmé à
  // chaque clic) pour ne pas écrire dans un composant démonté.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);
  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const frame = editorFrameRef.current;
      const startY = e.clientY;
      const startH = frame?.offsetHeight ?? editorHeight;
      let lastH = startH;
      const onMove = (ev: PointerEvent) => {
        lastH = Math.min(EDITOR_MAX_H, Math.max(EDITOR_MIN_H, startH + ev.clientY - startY));
        if (frame) frame.style.height = `${lastH}px`;
      };
      const detach = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        resizeCleanupRef.current = null;
      };
      const onUp = () => {
        detach();
        setEditorHeight(lastH);
        localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(lastH)));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      resizeCleanupRef.current = detach;
    },
    [editorHeight],
  );

  const onResizeReset = useCallback(() => {
    const defaultH = parseInt(height, 10) || 420;
    setEditorHeight(defaultH);
    localStorage.removeItem(HEIGHT_STORAGE_KEY);
    const frame = editorFrameRef.current;
    if (frame) frame.style.height = `${defaultH}px`;
  }, [height]);

  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let next = editorHeight;
      if (e.key === 'ArrowUp') next -= 20;
      else if (e.key === 'ArrowDown') next += 20;
      else if (e.key === 'Home') next = EDITOR_MIN_H;
      else if (e.key === 'End') next = EDITOR_MAX_H;
      else return;
      e.preventDefault();
      next = Math.min(EDITOR_MAX_H, Math.max(EDITOR_MIN_H, next));
      setEditorHeight(next);
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(next));
      const frame = editorFrameRef.current;
      if (frame) frame.style.height = `${next}px`;
    },
    [editorHeight],
  );

  // Le code courant/sauvegardé diffère-t-il du modèle vierge du langage ?
  // Garde-fou commun aux actions qui écrasent l'éditeur (réinitialisation, import, réutilisation).
  function isLanguageCodeModified(lang: SubmissionLanguage) {
    if (lang === language) {
      return code !== TEMPLATES[language];
    }
    return loadCode(slug, lang) !== TEMPLATES[lang];
  }

  // `value` est contrôlé : mettre à jour l'état suffit à recharger l'éditeur.
  // (Un editor.setValue() manuel déclencherait onChange avec le langage de la
  // frame précédente et écraserait le code sauvegardé de l'ancien langage.)
  function resetTemplate() {
    if (isLanguageCodeModified(language) && !window.confirm(t.problem.reset_confirm)) return;
    replaceEditor(TEMPLATES[language]);
  }

  function copyCode() {
    const flash = () => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    };
    // navigator.clipboard manque en contexte non sécurisé : on retombe alors sur
    // l'ancienne API execCommand pour que le bouton reste fonctionnel.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(code)
        .then(flash)
        .catch(() => legacyCopy(code) && flash());
    } else if (legacyCopy(code)) {
      flash();
    }
  }

  function downloadCode() {
    const ext = LANGUAGE_BY_ID[language]?.ext ?? 'txt';
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
    if (file.size > MAX_SOURCE_BYTES) {
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
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      setUploadError(t.problem.upload_binary);
      return;
    }
    setUploadError(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    const targetLang = languageForExt(ext)?.id ?? language;
    if (isLanguageCodeModified(targetLang) && !window.confirm(t.problem.upload_confirm)) return;
    replaceEditor(text, targetLang);
  }

  async function restoreSubmission(s: Submission) {
    // On confirme l'écrasement AVANT l'aller-retour réseau : pas de latence
    // entre le clic « réutiliser » et la question.
    if (isLanguageCodeModified(s.language) && !window.confirm(t.problem.reuse_confirm)) return;
    setRestoringId(s.id);
    setActionError(null);
    try {
      const detail = await api.submission(s.id);
      if (!mounted.current) return;
      if (!detail.source_code) {
        // Le code n'a pas pu être récupéré : on le dit plutôt que de ne rien
        // faire (un clic sans effet laisse croire à un bug).
        setActionError(t.problem.reuse_empty);
        return;
      }
      replaceEditor(detail.source_code, s.language);
    } catch (err) {
      if (mounted.current) setActionError(describeError(err, t.problem));
    } finally {
      if (mounted.current) setRestoringId(null);
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
          <button
            type="button"
            className={`tool-btn${copied ? ' is-success' : ''}`}
            onClick={copyCode}
            title={copied ? t.problem.copied : t.problem.copy_code}
            aria-label={copied ? t.problem.copied : t.problem.copy_code}
          >
            {copied ? IconCheck : IconCopy}
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={downloadCode}
            title={t.problem.download_code}
            aria-label={t.problem.download_code}
          >
            {IconDownload}
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => fileInputRef.current?.click()}
            title={t.problem.upload_code}
            aria-label={t.problem.upload_code}
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
          <button
            type="button"
            className="tool-btn"
            onClick={resetTemplate}
            title={t.problem.reset_template}
            aria-label={t.problem.reset_template}
          >
            {IconReset}
          </button>
        </div>
        <CustomSelect
          className="workbench-lang-select"
          value={language}
          onChange={(val) => switchLanguage(val as SubmissionLanguage)}
          options={LANGUAGE_OPTIONS}
          ariaLabel={t.problem.language}
        />
      </div>

      {uploadError && (
        <WorkbenchError message={uploadError} onDismiss={() => setUploadError(null)} />
      )}
      {actionError && (
        <WorkbenchError message={actionError} onDismiss={() => setActionError(null)} />
      )}

      <div className="editor-frame" ref={editorFrameRef} style={{ height: editorHeight }}>
        <Editor
          height="100%"
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
          onDoubleClick={onResizeReset}
          onKeyDown={onResizeKeyDown}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t.problem.resize_editor}
          aria-valuemin={EDITOR_MIN_H}
          aria-valuemax={EDITOR_MAX_H}
          aria-valuenow={editorHeight}
          tabIndex={0}
          title={t.problem.resize_editor}
        >
          <span className="editor-resize-grip" aria-hidden="true" />
        </div>
      )}

      <div className="submit-row submit-row--sticky">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => run()}
          disabled={!canRun || !hasSamples}
          title={
            hasSamples
              ? `${t.problem.run} · ${t.problem.shortcut_run}`
              : t.problem.run_no_samples
          }
        >
          {runBusy
            ? t.problem.running
            : runCooldown > 0
              ? t.problem.cooldown(runCooldown)
              : t.problem.run}
        </button>
        <button
          type="button"
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
        type="button"
        className="custom-input-toggle mono-label"
        aria-expanded={showCustom}
        onClick={() => setShowCustom((v) => !v)}
      >
        {showCustom ? '▾' : '▸'} {t.problem.custom_input_toggle}
      </button>
      {showCustom && (
        <div className="custom-input">
          <textarea
            aria-label={t.problem.custom_input_toggle}
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder={t.problem.custom_input_placeholder}
            rows={4}
            spellCheck={false}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => run(customInput)}
            disabled={!canRun}
          >
            {runBusy ? t.problem.running : t.problem.run_custom}
          </button>
        </div>
      )}

      {runResult && <RunResults result={runResult} />}

      {current?.status === 'done' &&
        current.verdict === 'CE' &&
        current.compile_output && <CompileOutput text={current.compile_output} />}

      {showHistory && (
        <SubmissionHistory
          history={history}
          onRestore={restoreSubmission}
          restoringId={restoringId}
        />
      )}
    </section>
  );
}

// Bandeau d'erreur cliquable (import refusé, échec d'action) : auto-effacé par
// le parent au bout de 5 s, mais rejetable d'un clic.
function WorkbenchError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <button type="button" className="workbench-error" role="alert" onClick={onDismiss}>
      <span className="workbench-error-glyph" aria-hidden="true">
        ⚠
      </span>
      {message}
    </button>
  );
}

// Sortie du compilateur (repliable), partagée par le verdict CE d'une soumission
// et le panneau de résultats d'essai.
function CompileOutput({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <details className="compile-output" open>
      <summary className="mono-label">{t.problem.compile_output}</summary>
      <pre>{text}</pre>
    </details>
  );
}

function CoachCard({ verdict }: { verdict: Verdict }) {
  const { t } = useI18n();
  // IE (erreur interne du juge) n'a volontairement pas de conseil : rien d'utile
  // à dire au membre, c'est un incident côté serveur.
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

// Bloc étiqueté « entrée / attendu / votre sortie / stderr » : la brique de base
// répétée dans tous les affichages d'exécution.
function RunIo({ label, text, className }: { label: string; text: string; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={`run-io${className ? ` ${className}` : ''}`}>
      <h4 className="mono-label">{label}</h4>
      <pre>{text || t.problem.run_empty_output}</pre>
    </div>
  );
}

// Corps détaillé d'un cas exécuté (entrée, diff ou attendu+sortie, stderr),
// partagé par les exemples cliquables et le panneau de résultats. Une entrée
// personnalisée (expected_output === null) masque l'entrée et l'attendu.
function RunCaseBody({ c }: { c: RunCase }) {
  const { t } = useI18n();
  const isCustom = c.expected_output === null;
  const showDiff = !isCustom && c.verdict === 'WA';
  return (
    <div className="run-case-body">
      {!isCustom && <RunIo label={t.problem.run_input} text={c.input} />}
      {showDiff ? (
        <div className="run-io">
          <h4 className="mono-label">{t.problem.run_diff}</h4>
          <DiffView expected={c.expected_output ?? ''} got={c.stdout ?? ''} />
        </div>
      ) : (
        <>
          {c.expected_output !== null && (
            <RunIo label={t.problem.run_expected} text={c.expected_output} />
          )}
          <RunIo label={t.problem.run_got} text={c.stdout ?? ''} />
        </>
      )}
      {c.stderr && <RunIo className="run-stderr" label={t.problem.run_stderr} text={c.stderr} />}
      {c.truncated && <p className="run-truncated mono-label">{t.problem.run_truncated}</p>}
    </div>
  );
}

// En-tête commun d'un cas exécuté : libellé + verdict + temps (+ extras, ex. le
// bouton « exécuter » d'un exemple). Partagé par le panneau de résultats et les
// exemples cliquables pour ne pas dupliquer cette ligne.
function RunCaseHeader({
  label,
  verdict,
  timeS,
  children,
}: {
  label: string;
  verdict?: Verdict;
  timeS?: number | null;
  children?: React.ReactNode;
}) {
  return (
    <header className="run-case-head">
      <span className="mono-label">{label}</span>
      {verdict && <VerdictBadge verdict={verdict} />}
      {timeS != null && <span className="run-time">{fmtTimeS(timeS)}</span>}
      {children}
    </header>
  );
}

function SamplesPanel({
  samples,
  runSample,
  disabled,
}: {
  samples: Sample[];
  runSample: (index: number) => Promise<RunCase | null>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  return (
    <div className="samples-panel">
      <button
        type="button"
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
  runSample: (index: number) => Promise<RunCase | null>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<RunCase | null>(null);
  const [busy, setBusy] = useState(false);
  // L'exécution est asynchrone et l'exemple peut disparaître entre-temps (repli
  // du panneau, navigation) : on n'écrit pas le résultat dans un composant démonté.
  const mounted = useMountedRef();

  async function go() {
    setBusy(true);
    const c = await runSample(index);
    if (!mounted.current) return;
    if (c) setResult(c);
    setBusy(false);
  }

  return (
    <section className={`run-case sample-case${result ? ` v-${result.verdict}` : ''}`}>
      <RunCaseHeader
        label={t.problem.run_case(index + 1)}
        verdict={result?.verdict}
        timeS={result?.time_s}
      >
        <button
          type="button"
          className="btn btn-ghost btn-mini"
          onClick={go}
          disabled={disabled || busy}
        >
          {busy ? t.problem.running : t.problem.run_this}
        </button>
      </RunCaseHeader>
      {result ? (
        // Le juge renvoie l'entrée et l'attendu d'un exemple exécuté : même
        // affichage détaillé que le panneau de résultats.
        <RunCaseBody c={result} />
      ) : (
        // Avant exécution : simple aperçu de l'exemple (entrée + attendu).
        <div className="run-case-body">
          <RunIo label={t.problem.run_input} text={sample.input} />
          <RunIo label={t.problem.run_expected} text={sample.expected_output} />
        </div>
      )}
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

      {result.compile_output && <CompileOutput text={result.compile_output} />}

      {allPassed && <p className="run-all-passed">✓ {t.problem.run_all_passed}</p>}

      {result.cases.map((c, i) => {
        const isCustom = c.expected_output === null;
        // Un exemple AC n'a rien à montrer de plus ; on détaille les échecs
        // et toujours l'entrée personnalisée (voir sa sortie est le but).
        const showDetail = isCustom || c.verdict !== 'AC';
        return (
          <section key={i} className={`run-case v-${c.verdict}`}>
            <RunCaseHeader
              label={isCustom ? t.problem.run_custom_case : t.problem.run_case(i + 1)}
              verdict={c.verdict}
              timeS={c.time_s}
            />
            {showDetail && <RunCaseBody c={c} />}
          </section>
        );
      })}
    </div>
  );
}

function SubmissionHistory({
  history,
  onRestore,
  restoringId,
}: {
  history: Submission[];
  onRestore: (s: Submission) => void;
  restoringId: number | null;
}) {
  const { t, lang } = useI18n();
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
                <td>{languageLabel(s.language)}</td>
                <td>
                  <VerdictChip submission={s} />
                </td>
                <td className="num">{s.time_s != null ? fmtTimeS(s.time_s) : '—'}</td>
                <td className="num">{s.memory_kb != null ? fmtMemoryMo(s.memory_kb, lang) : '—'}</td>
                <td className="num">
                  <button
                    type="button"
                    className="btn btn-ghost btn-mini"
                    onClick={() => onRestore(s)}
                    disabled={restoringId != null}
                    title={t.problem.reuse_code}
                  >
                    {restoringId === s.id ? t.problem.reuse_loading : t.problem.reuse}
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
