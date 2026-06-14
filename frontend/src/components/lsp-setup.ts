import type { Monaco } from '@monaco-editor/react';
import type { IDisposable, IRange, Position, editor, languages } from 'monaco-editor';

/* IntelliSense sémantique pour l'éditeur, via des serveurs de langage côté
   serveur (clangd pour C/C++, basedpyright pour Python), relayés en LSP au
   travers d'un WebSocket proxifié par FastAPI (cf. backend/app/lsp.py).

   Plutôt que d'embarquer la pile monaco-languageclient (incompatible avec
   @monaco-editor/react + CDN + COEP), on enregistre nous-mêmes les fournisseurs
   Monaco et on relaie chaque requête au serveur. Un seul client générique sert
   tous les langages ; chacun fournit juste sa config (endpoint, URI, langages).

   - Un document LSP distinct par modèle Monaco (file:///main-N.ext) : plusieurs
     Workbench sur une même page (blocs TP des cours) ne se marchent pas dessus.
   - Reconnexion automatique si le serveur tombe puis revient (backoff) : on
     ré-ouvre tous les documents connus, sans réenregistrer les fournisseurs.

   Tout est défensif : à la moindre erreur (réseau, serveur absent), Workbench
   retombe sur l'auto-complétion statique de editor-intellisense.ts. */

// ---- Configuration par serveur de langage ---------------------------------

export interface LspConfig {
  /** Nom court (logs + propriétaire des marqueurs) : « clangd », « basedpyright ». */
  name: string;
  /** Chemin WebSocket côté API (le {language} de backend/app/lsp.py). */
  wsPath: string;
  /** Langages Monaco couverts (sélecteur des fournisseurs). */
  languages: string[];
  /** Extension de fichier + languageId LSP pour un modèle (pilote la détection). */
  docInfo: (model: editor.ITextModel) => { ext: string; languageId: string };
  completionTriggerCharacters: string[];
  signatureTriggerCharacters?: string[];
  /** Réponses aux requêtes workspace/configuration, par section. */
  configuration?: Record<string, unknown>;
  /** Diagnostics « pull » (requête textDocument/diagnostic à la demande) au lieu
      du « push ». basedpyright ne pousse les diagnostics que pour des fichiers
      présents sur disque ; le pull marche sur le contenu en mémoire (comme la
      complétion). clangd, lui, pousse très bien en mémoire → reste en push. */
  pullDiagnostics?: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 6;

// ---- Types LSP minimaux (uniquement ce qu'on consomme) --------------------

interface LspPosition {
  line: number;
  character: number;
}
interface LspRange {
  start: LspPosition;
  end: LspPosition;
}
interface MarkupContent {
  kind: string;
  value: string;
}
type LspDoc = string | MarkupContent;
interface LspTextEdit {
  range: LspRange;
  newText: string;
}
interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: LspDoc;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: LspTextEdit;
}
interface LspCompletionList {
  items: LspCompletionItem[];
}
interface LspHover {
  contents: LspDoc | LspDoc[];
  range?: LspRange;
}
interface LspParameter {
  label: string | [number, number];
  documentation?: LspDoc;
}
interface LspSignature {
  label: string;
  documentation?: LspDoc;
  parameters?: LspParameter[];
}
interface LspSignatureHelp {
  signatures: LspSignature[];
  activeSignature?: number;
  activeParameter?: number;
}
interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: number;
  source?: string;
}
interface RpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

// ---- Conversions LSP → Monaco ---------------------------------------------

function toRange(r: LspRange): IRange {
  // LSP est en base 0 ; Monaco en base 1.
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

function docToString(doc: LspDoc | undefined): string {
  if (!doc) return '';
  return typeof doc === 'string' ? doc : doc.value;
}

// ---- Client LSP générique sur WebSocket -----------------------------------

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

/** Un document ouvert sur le serveur, associé à un modèle Monaco. */
interface DocState {
  uri: string;
  model: editor.ITextModel;
  languageId: string;
  version: number;
  willDispose: IDisposable;
}

class WsLspClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private monaco: Monaco;
  private config: LspConfig;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private disposables: IDisposable[] = [];
  private providersRegistered = false;
  private disposed = false;

  // Un document par modèle ; index inverse par URI pour router les diagnostics.
  private docCounter = 0;
  private docsByModel = new Map<editor.ITextModel, DocState>();
  private docsByUri = new Map<string, DocState>();
  // Modèles ayant demandé des diagnostics (un éditeur visible), pour ne pas
  // peindre des marqueurs sur un bloc de code en lecture seule.
  private diagModels = new Set<editor.ITextModel>();
  private diagSubs = new Map<
    editor.IStandaloneCodeEditor,
    { content: IDisposable; timer: ReturnType<typeof setTimeout> | null }
  >();

  // Reconnexion.
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(monaco: Monaco, config: LspConfig) {
    this.monaco = monaco;
    this.config = config;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${proto}//${location.host}${config.wsPath}`;
  }

  /** Première connexion + handshake. Rejette si le serveur est indisponible. */
  async init(): Promise<void> {
    await this.openAndHandshake();
    if (!this.providersRegistered) {
      this.registerProviders();
      this.providersRegistered = true;
    }
  }

  /** Ouvre une socket et fait le handshake LSP (initialize + initialized), puis
      ré-ouvre les documents connus (utile à la reconnexion). */
  private openAndHandshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let settled = false;
      ws.onmessage = (ev) => this.onMessage(ev);
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error(`${this.config.name}: erreur WebSocket`));
        }
      };
      ws.onclose = (ev) => {
        this.failPending(new Error(`${this.config.name}: connexion fermée`));
        if (!settled) {
          settled = true;
          reject(new Error(`${this.config.name}: WebSocket fermé (${ev.code} ${ev.reason})`));
        } else if (!this.disposed) {
          // Fermeture après une session établie → on retente.
          this.scheduleReconnect();
        }
      };
      ws.onopen = async () => {
        try {
          await this.handshake();
          this.reopenDocs();
          settled = true;
          resolve();
        } catch (err) {
          settled = true;
          reject(err);
        }
      };
    });
  }

  private async handshake(): Promise<void> {
    await this.request('initialize', {
      processId: null,
      rootUri: null,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          completion: {
            contextSupport: true,
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true },
            },
          },
          publishDiagnostics: { relatedInformation: false },
          ...(this.config.pullDiagnostics
            ? { diagnostic: { dynamicRegistration: false } }
            : {}),
        },
        workspace: { configuration: true },
      },
    });
    this.notify('initialized', {});
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.warn(`${this.config.name}: reconnexion abandonnée après plusieurs essais.`);
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      try {
        await this.openAndHandshake();
        this.reconnectAttempts = 0;
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private onMessage(ev: MessageEvent): void {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(ev.data as string) as RpcMessage;
    } catch {
      return;
    }
    // Réponse à l'une de nos requêtes.
    if (msg.id !== undefined && msg.method === undefined) {
      const pending = this.pending.get(msg.id as number);
      if (!pending) return;
      this.pending.delete(msg.id as number);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
      return;
    }
    // Requête initiée par le serveur : il faut répondre pour ne pas le bloquer.
    if (msg.id !== undefined && msg.method !== undefined) {
      let result: unknown = null;
      if (msg.method === 'workspace/configuration') {
        const params = msg.params as { items?: { section?: string }[] } | undefined;
        const conf = this.config.configuration ?? {};
        result = (params?.items ?? []).map((it) => (it.section ? (conf[it.section] ?? {}) : {}));
      }
      this.send({ jsonrpc: '2.0', id: msg.id, result });
      return;
    }
    // Notification du serveur.
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.applyDiagnostics(msg.params as { uri: string; diagnostics: LspDiagnostic[] });
    }
  }

  private send(msg: RpcMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Pendant une coupure : on échoue vite, les fournisseurs renvoient du vide.
      return Promise.reject(new Error(`${this.config.name}: non connecté`));
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  // ---- Documents (un par modèle) ------------------------------------------

  private getDoc(model: editor.ITextModel): DocState {
    const existing = this.docsByModel.get(model);
    if (existing) return existing;
    const { ext, languageId } = this.config.docInfo(model);
    const uri = `file:///main-${++this.docCounter}.${ext}`;
    const doc: DocState = {
      uri,
      model,
      languageId,
      version: 1,
      willDispose: model.onWillDispose(() => this.closeDoc(model)),
    };
    this.docsByModel.set(model, doc);
    this.docsByUri.set(uri, doc);
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text: model.getValue() },
    });
    return doc;
  }

  /** Pousse le contenu courant du modèle vers le serveur ; renvoie son URI. */
  private syncDoc(model: editor.ITextModel): string {
    const doc = this.getDoc(model);
    doc.version += 1;
    this.notify('textDocument/didChange', {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text: model.getValue() }],
    });
    return doc.uri;
  }

  private closeDoc(model: editor.ITextModel): void {
    const doc = this.docsByModel.get(model);
    if (!doc) return;
    this.docsByModel.delete(model);
    this.docsByUri.delete(doc.uri);
    this.diagModels.delete(model);
    doc.willDispose.dispose();
    this.notify('textDocument/didClose', { textDocument: { uri: doc.uri } });
  }

  /** Ré-ouvre tous les documents connus (après reconnexion : serveur tout neuf). */
  private reopenDocs(): void {
    for (const doc of this.docsByModel.values()) {
      doc.version += 1;
      this.notify('textDocument/didOpen', {
        textDocument: {
          uri: doc.uri,
          languageId: doc.languageId,
          version: doc.version,
          text: doc.model.getValue(),
        },
      });
    }
  }

  // ---- Fournisseurs Monaco ------------------------------------------------

  private registerProviders(): void {
    const monaco = this.monaco;
    const selector = this.config.languages;
    const completionKind = this.completionKindMap();
    const lspPos = (position: Position) => ({
      line: position.lineNumber - 1,
      character: position.column - 1,
    });

    const completion: languages.CompletionItemProvider = {
      triggerCharacters: this.config.completionTriggerCharacters,
      provideCompletionItems: async (model: editor.ITextModel, position: Position) => {
        const uri = this.syncDoc(model);
        const result = (await this.request('textDocument/completion', {
          textDocument: { uri },
          position: lspPos(position),
        }).catch(() => null)) as LspCompletionList | LspCompletionItem[] | null;
        if (!result) return { suggestions: [] };
        const items = Array.isArray(result) ? result : result.items;
        const word = model.getWordUntilPosition(position);
        const fallbackRange: IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const suggestions: languages.CompletionItem[] = items.map((it) => {
          const range = it.textEdit ? toRange(it.textEdit.range) : fallbackRange;
          const insertText = it.textEdit?.newText ?? it.insertText ?? it.label;
          return {
            label: it.label,
            kind: completionKind[it.kind ?? 1] ?? monaco.languages.CompletionItemKind.Text,
            insertText,
            insertTextRules:
              it.insertTextFormat === 2
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            detail: it.detail,
            documentation: it.documentation
              ? { value: docToString(it.documentation) }
              : undefined,
            sortText: it.sortText,
            filterText: it.filterText,
            range,
          };
        });
        return { suggestions };
      },
    };

    const hover: languages.HoverProvider = {
      provideHover: async (model: editor.ITextModel, position: Position) => {
        const uri = this.syncDoc(model);
        const result = (await this.request('textDocument/hover', {
          textDocument: { uri },
          position: lspPos(position),
        }).catch(() => null)) as LspHover | null;
        if (!result || !result.contents) return null;
        const parts = Array.isArray(result.contents) ? result.contents : [result.contents];
        const value = parts.map(docToString).filter(Boolean).join('\n\n');
        if (!value) return null;
        return {
          contents: [{ value }],
          range: result.range ? toRange(result.range) : undefined,
        };
      },
    };

    const signature: languages.SignatureHelpProvider = {
      signatureHelpTriggerCharacters: this.config.signatureTriggerCharacters ?? ['(', ','],
      signatureHelpRetriggerCharacters: [')'],
      provideSignatureHelp: async (model: editor.ITextModel, position: Position) => {
        const uri = this.syncDoc(model);
        const result = (await this.request('textDocument/signatureHelp', {
          textDocument: { uri },
          position: lspPos(position),
        }).catch(() => null)) as LspSignatureHelp | null;
        if (!result || result.signatures.length === 0) return null;
        return {
          value: {
            signatures: result.signatures.map((s) => ({
              label: s.label,
              documentation: s.documentation ? { value: docToString(s.documentation) } : undefined,
              parameters: (s.parameters ?? []).map((p) => ({
                label: p.label,
                documentation: p.documentation
                  ? { value: docToString(p.documentation) }
                  : undefined,
              })),
            })),
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0,
          },
          dispose: () => {},
        };
      },
    };

    this.disposables.push(
      monaco.languages.registerCompletionItemProvider(selector, completion),
      monaco.languages.registerHoverProvider(selector, hover),
      monaco.languages.registerSignatureHelpProvider(selector, signature),
    );
  }

  private completionKindMap(): Record<number, languages.CompletionItemKind> {
    const K = this.monaco.languages.CompletionItemKind;
    return {
      1: K.Text,
      2: K.Method,
      3: K.Function,
      4: K.Constructor,
      5: K.Field,
      6: K.Variable,
      7: K.Class,
      8: K.Interface,
      9: K.Module,
      10: K.Property,
      11: K.Unit,
      12: K.Value,
      13: K.Enum,
      14: K.Keyword,
      15: K.Snippet,
      16: K.Color,
      17: K.File,
      18: K.Reference,
      19: K.Folder,
      20: K.EnumMember,
      21: K.Constant,
      22: K.Struct,
      23: K.Event,
      24: K.Operator,
      25: K.TypeParameter,
    };
  }

  // ---- Diagnostics (par éditeur) ------------------------------------------

  setupDiagnostics(editorInstance: editor.IStandaloneCodeEditor): void {
    const model = editorInstance.getModel();
    if (!model) return;
    this.diagModels.add(model);
    this.getDoc(model); // ouvre le document si besoin
    this.refreshDiagnostics(model); // première analyse
    this.diagSubs.get(editorInstance)?.content.dispose();
    const sub = {
      content: editorInstance.onDidChangeModelContent(() => {
        const m = editorInstance.getModel();
        if (!m) return;
        if (sub.timer) clearTimeout(sub.timer);
        sub.timer = setTimeout(() => this.refreshDiagnostics(m), 300);
      }),
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    this.diagSubs.set(editorInstance, sub);
  }

  /** Pousse le contenu et rafraîchit les diagnostics. En push (clangd) le serveur
      les renverra de lui-même ; en pull (basedpyright) on les demande. */
  private refreshDiagnostics(model: editor.ITextModel): void {
    this.syncDoc(model);
    if (this.config.pullDiagnostics) void this.pullDiagnostics(model);
  }

  private async pullDiagnostics(model: editor.ITextModel): Promise<void> {
    const doc = this.docsByModel.get(model);
    if (!doc || !this.diagModels.has(model) || model.isDisposed()) return;
    const rep = (await this.request('textDocument/diagnostic', {
      textDocument: { uri: doc.uri },
    }).catch(() => null)) as { kind?: string; items?: LspDiagnostic[] } | null;
    // kind « unchanged » (ou échec) → on garde les marqueurs actuels.
    if (!rep || rep.items === undefined) return;
    if (!this.diagModels.has(model) || model.isDisposed()) return;
    this.setMarkers(model, rep.items);
  }

  stopDiagnostics(editorInstance: editor.IStandaloneCodeEditor): void {
    const sub = this.diagSubs.get(editorInstance);
    if (sub) {
      sub.content.dispose();
      if (sub.timer) clearTimeout(sub.timer);
      this.diagSubs.delete(editorInstance);
    }
    const model = editorInstance.getModel();
    if (model) {
      this.diagModels.delete(model);
      if (!model.isDisposed()) this.monaco.editor.setModelMarkers(model, this.config.name, []);
    }
  }

  // Diagnostics « push » (clangd) : le serveur les envoie spontanément par URI.
  private applyDiagnostics(params: { uri: string; diagnostics: LspDiagnostic[] }): void {
    const doc = this.docsByUri.get(params.uri);
    if (!doc || !this.diagModels.has(doc.model)) return;
    this.setMarkers(doc.model, params.diagnostics);
  }

  private setMarkers(model: editor.ITextModel, diagnostics: LspDiagnostic[]): void {
    if (model.isDisposed()) return;
    const S = this.monaco.MarkerSeverity;
    const severity: Record<number, number> = { 1: S.Error, 2: S.Warning, 3: S.Info, 4: S.Hint };
    this.monaco.editor.setModelMarkers(
      model,
      this.config.name,
      diagnostics.map((d) => {
        const r = toRange(d.range);
        return {
          severity: severity[d.severity ?? 1] ?? S.Error,
          message: d.message,
          source: d.source ?? this.config.name,
          startLineNumber: r.startLineNumber,
          startColumn: r.startColumn,
          endLineNumber: r.endLineNumber,
          endColumn: r.endColumn,
        };
      }),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const sub of this.diagSubs.values()) {
      sub.content.dispose();
      if (sub.timer) clearTimeout(sub.timer);
    }
    this.diagSubs.clear();
    for (const doc of this.docsByModel.values()) doc.willDispose.dispose();
    this.docsByModel.clear();
    this.docsByUri.clear();
    this.diagModels.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.failPending(new Error(`${this.config.name}: client détruit`));
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
  }
}

export type LspProvider = WsLspClient;

// ---- Loaders par langage (singleton par endpoint) -------------------------

const clients = new Map<string, Promise<WsLspClient>>();

function load(monaco: Monaco, config: LspConfig): Promise<WsLspClient> {
  const existing = clients.get(config.wsPath);
  if (existing) return existing;
  const client = new WsLspClient(monaco, config);
  const promise = client
    .init()
    .then(() => client)
    .catch((err) => {
      clients.delete(config.wsPath);
      client.dispose();
      throw err;
    });
  clients.set(config.wsPath, promise);
  return promise;
}

/** clangd côté serveur — IntelliSense C / C++. */
export function loadClangd(monaco: Monaco): Promise<WsLspClient> {
  return load(monaco, {
    name: 'clangd',
    wsPath: '/api/lsp/cpp',
    languages: ['cpp', 'c'],
    docInfo: (model) =>
      model.getLanguageId() === 'c'
        ? { ext: 'c', languageId: 'c' }
        : { ext: 'cpp', languageId: 'cpp' },
    completionTriggerCharacters: ['.', '>', ':', '<', '"', '/', '*', ' '],
  });
}

/** basedpyright côté serveur — IntelliSense Python. */
export function loadPyright(monaco: Monaco): Promise<WsLspClient> {
  return load(monaco, {
    name: 'basedpyright',
    wsPath: '/api/lsp/python',
    languages: ['python'],
    docInfo: () => ({ ext: 'py', languageId: 'python' }),
    completionTriggerCharacters: ['.', '[', '"', "'"],
    // basedpyright ne pousse les diagnostics que pour des fichiers sur disque ;
    // on les récupère donc en pull (marche sur le buffer en mémoire).
    pullDiagnostics: true,
    // Mode « basique » : on signale les vraies erreurs sans noyer les débutants
    // sous les avertissements de typage stricts de basedpyright. Les sections
    // sont celles que basedpyright réclame réellement (python, basedpyright[.analysis]).
    configuration: {
      python: { analysis: { typeCheckingMode: 'basic' } },
      basedpyright: { analysis: { typeCheckingMode: 'basic' } },
      'basedpyright.analysis': { typeCheckingMode: 'basic' },
    },
  });
}
