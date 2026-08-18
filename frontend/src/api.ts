export interface User {
  id: number;
  email: string;
  display_name: string;
  role: string;
}

export interface ProblemSummary {
  slug: string;
  title: string;
  difficulty: number;
  tags: string[];
  solved: boolean;
  attempted: boolean;
}

export interface Sample {
  input: string;
  expected_output: string;
}

export interface ProblemContestRef {
  slug: string;
  title: string;
  label: string;
  end_at: string;
}

export interface ArticleRef {
  course_slug: string;
  article_slug: string;
  title_fr: string;
  title_en: string | null;
}

export interface ProblemDetail extends ProblemSummary {
  statement_fr: string;
  statement_en: string | null;
  time_limit_s: number;
  memory_limit_kb: number;
  samples: Sample[];
  hints: string[];
  has_editorial: boolean;
  contest: ProblemContestRef | null;
  articles: ArticleRef[];
  // Nombre de soumissions jusqu'au premier AC inclus ; null si pas résolu.
  solved_attempts: number | null;
}

export interface Editorial {
  editorial_fr: string;
  editorial_en: string | null;
}

export interface SolveStats {
  solved: boolean;
  attempted: boolean;
  // Nombre de soumissions jusqu'au premier AC inclus ; null si pas résolu.
  solved_attempts: number | null;
}

export interface SharedSolution {
  id: number;
  author: string;
  is_mine: boolean;
  language: SubmissionLanguage;
  time_s: number | null;
  memory_kb: number | null;
  created_at: string;
  source_code: string;
  percentile?: number | null;
}

export type SkillState = 'mastered' | 'recommended' | 'not_ready';

export interface SkillProblemRef {
  slug: string;
  title: string;
  difficulty: number;
  solved: boolean;
  attempted: boolean;
}

export interface SkillNode {
  slug: string;
  name_fr: string;
  name_en: string | null;
  description_fr: string | null;
  description_en: string | null;
  x: number;
  y: number;
  requires: string[];
  problems: SkillProblemRef[];
  solved_count: number;
  mastery_threshold: number;
  state: SkillState;
  articles: ArticleRef[];
}

export interface CourseSummary {
  slug: string;
  title: string;
  category: string;
  description: string | null;
  article_count: number;
  read_count: number;
  tp_total: number;
  tp_solved: number;
}

export interface ArticleSummary {
  slug: string;
  title_fr: string;
  title_en: string | null;
  read: boolean;
  tp_total: number;
  tp_solved: number;
}

export interface CourseDetail extends CourseSummary {
  articles: ArticleSummary[];
}

export interface ArticleNeighbor {
  slug: string;
  title_fr: string;
  title_en: string | null;
}

export interface ArticleProblemRef {
  slug: string;
  title: string;
  difficulty: number;
  solved: boolean;
}

export interface ArticleDetail {
  slug: string;
  title_fr: string;
  title_en: string | null;
  body_fr: string;
  body_en: string | null;
  read: boolean;
  course_slug: string;
  course_title: string;
  practice: ArticleProblemRef[];
  prev: ArticleNeighbor | null;
  next: ArticleNeighbor | null;
}

export type ContestPhase = 'upcoming' | 'running' | 'finished';

export interface ContestSummary {
  slug: string;
  title: string;
  phase: ContestPhase;
  start_at: string;
  end_at: string;
  problem_count: number;
  registered_count: number;
  registered: boolean;
}

export interface ContestProblemRef {
  label: string;
  slug: string;
  title: string;
  difficulty: number;
  solved: boolean;
  attempted: boolean;
  // Éditorial disponible : vrai seulement une fois le contest terminé.
  has_editorial: boolean;
}

export interface ContestDetail extends ContestSummary {
  description: string | null;
  problems: ContestProblemRef[] | null;
}

export interface ScoreCell {
  tries: number;
  solved_at_min: number | null;
  first_blood: boolean;
  pending: boolean;
}

export interface ScoreRow {
  rank: number;
  // Identité stable de la ligne : display_name n'est pas unique, donc tout ce qui
  // identifie une ligne (clé React, FLIP, diff) s'appuie sur user_id.
  user_id: number;
  display_name: string;
  is_me: boolean;
  solved: number;
  penalty_min: number;
  cells: ScoreCell[];
}

export interface Scoreboard {
  problems: string[];
  rows: ScoreRow[];
}

export interface ContestPayload {
  slug: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  problems: { slug: string; label: string }[];
}

export type SubmissionLanguage = 'cpp' | 'python' | 'c' | 'java' | 'ocaml';

export type Verdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'IE';

export interface RunCase {
  verdict: Verdict;
  input: string;
  expected_output: string | null;
  stdout: string | null;
  stderr: string | null;
  time_s: number | null;
  // Un champ texte (entrée/attendu/sortie) a été coupé pour le transport : le
  // diff/affichage peut être incomplet. (La mémoire n'est pas remontée pour un
  // essai — l'affichage se limite au verdict, au temps et aux E/S.)
  truncated: boolean;
}

export interface RunResult {
  compile_output: string | null;
  cases: RunCase[];
}

export interface Submission {
  id: number;
  problem_slug: string;
  language: SubmissionLanguage;
  status: 'queued' | 'running' | 'done';
  verdict: 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'IE' | null;
  time_s: number | null;
  memory_kb: number | null;
  compile_output: string | null;
  failed_test: number | null;
  created_at: string;
  // Présent seulement sur le détail d'une soumission (GET /submissions/:id),
  // pas dans la liste d'historique — sert à recharger le code dans l'éditeur.
  source_code?: string;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.detail = detail;
  }

  get code(): string | null {
    if (typeof this.detail === 'string') return this.detail;
    if (this.detail && typeof this.detail === 'object' && 'code' in this.detail) {
      return String((this.detail as { code: unknown }).code);
    }
    return null;
  }
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const resp = await fetch(path, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!resp.ok) {
    let detail: unknown = null;
    try {
      detail = (await resp.json()).detail;
    } catch {
      // corps non-JSON : on garde le statut seul
    }
    throw new ApiError(resp.status, detail);
  }
  return resp;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await rawFetch(path, init);
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

/** Cooldown (en secondes) renvoyé sur succès via `X-Cooldown-Seconds`, sinon null.
 *  Volontairement distinct de `Retry-After`, réservé aux réponses 429/503 (cf.
 *  backend submissions.COOLDOWN_HEADER). */
function cooldownSeconds(resp: Response): number | null {
  const raw = resp.headers.get('X-Cooldown-Seconds');
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Comme `request` mais expose aussi le cooldown : le serveur reste la source de
 *  vérité pour le compte à rebours côté éditeur (cf. submit/run). */
async function requestWithCooldown<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; cooldownS: number | null }> {
  const resp = await rawFetch(path, init);
  const data = resp.status === 204 ? (undefined as T) : await resp.json();
  return { data, cooldownS: cooldownSeconds(resp) };
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),

  me: () => request<User>('/api/auth/me'),
  register: (email: string, password: string, displayName: string) =>
    request<User>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name: displayName }),
    }),
  login: (email: string, password: string) =>
    request<User>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),

  // La liste est filtrée côté client (voir ProblemsPage) : l'endpoint renvoie
  // tout le catalogue, sans paramètres de requête.
  problems: () => request<ProblemSummary[]>('/api/problems'),
  skillTree: () => request<SkillNode[]>('/api/skills/tree'),
  problem: (slug: string) => request<ProblemDetail>(`/api/problems/${slug}`),
  // Statut de résolution seul (léger) : rafraîchit le badge « résolu en N essais »
  // après une résolution sans re-télécharger l'énoncé complet.
  solveStats: (slug: string) =>
    request<SolveStats>(`/api/problems/${slug}/solve-stats`),

  // Renvoie aussi `cooldownS` (en-tête Retry-After) : le délai avant la prochaine
  // soumission, fixé côté serveur — le client n'a plus à le deviner.
  submit: async (
    slug: string,
    language: SubmissionLanguage,
    sourceCode: string,
  ): Promise<{ submission: Submission; cooldownS: number | null }> => {
    const { data, cooldownS } = await requestWithCooldown<Submission>(
      `/api/problems/${slug}/submissions`,
      {
        method: 'POST',
        body: JSON.stringify({ language, source_code: sourceCode }),
      },
    );
    return { submission: data, cooldownS };
  },
  submission: (id: number) => request<Submission>(`/api/submissions/${id}`),
  mySubmissions: (slug: string) => request<Submission[]>(`/api/problems/${slug}/submissions`),

  // `customInput` : entrée personnalisée unique (pas de comparaison côté juge).
  // `sampleIndex` : exécute un seul exemple, comparé par le juge. Sans options,
  // on exécute tous les exemples de l'énoncé. `cooldownS` : délai serveur avant
  // la prochaine exécution (Retry-After).
  run: async (
    slug: string,
    language: SubmissionLanguage,
    sourceCode: string,
    opts?: { customInput?: string; sampleIndex?: number },
  ): Promise<{ result: RunResult; cooldownS: number | null }> => {
    const { data, cooldownS } = await requestWithCooldown<RunResult>(
      `/api/problems/${slug}/run`,
      {
        method: 'POST',
        body: JSON.stringify({
          language,
          source_code: sourceCode,
          custom_input: opts?.customInput ?? null,
          sample_index: opts?.sampleIndex ?? null,
        }),
      },
    );
    return { result: data, cooldownS };
  },
  editorial: (slug: string) => request<Editorial>(`/api/problems/${slug}/editorial`),
  solutions: (slug: string) => request<SharedSolution[]>(`/api/problems/${slug}/solutions`),

  courses: () => request<CourseSummary[]>('/api/courses'),
  course: (slug: string) => request<CourseDetail>(`/api/courses/${slug}`),
  article: (courseSlug: string, articleSlug: string) =>
    request<ArticleDetail>(`/api/courses/${courseSlug}/articles/${articleSlug}`),
  markArticleRead: (courseSlug: string, articleSlug: string) =>
    request<void>(`/api/courses/${courseSlug}/articles/${articleSlug}/read`, { method: 'POST' }),

  contests: () => request<ContestSummary[]>('/api/contests'),
  contest: (slug: string) => request<ContestDetail>(`/api/contests/${slug}`),
  contestRegister: (slug: string) =>
    request<void>(`/api/contests/${slug}/register`, { method: 'POST' }),
  contestUnregister: (slug: string) =>
    request<void>(`/api/contests/${slug}/register`, { method: 'DELETE' }),
  scoreboard: (slug: string) => request<Scoreboard>(`/api/contests/${slug}/scoreboard`),

  createContest: (payload: ContestPayload) =>
    request<ContestDetail>('/api/contests', { method: 'POST', body: JSON.stringify(payload) }),
  updateContest: (slug: string, payload: ContestPayload) =>
    request<ContestDetail>(`/api/contests/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteContest: (slug: string) =>
    request<void>(`/api/contests/${slug}`, { method: 'DELETE' }),
  rejudgeProblem: (slug: string) =>
    request<{ rejudged: number }>(`/api/admin/problems/${slug}/rejudge`, { method: 'POST' }),
  rejudgeSubmission: (id: number) =>
    request<{ rejudged: number }>(`/api/admin/submissions/${id}/rejudge`, { method: 'POST' }),
};
