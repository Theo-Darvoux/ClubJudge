export interface User {
  id: number;
  email: string;
  display_name: string;
  role: string;
}

export interface ProblemSummary {
  slug: string;
  title: string;
  category: string;
  difficulty: number;
  tags: string[];
  solved: boolean;
  attempted: boolean;
}

export interface Sample {
  input: string;
  expected_output: string;
}

export interface ProblemDetail extends ProblemSummary {
  statement_fr: string;
  statement_en: string | null;
  time_limit_s: number;
  memory_limit_kb: number;
  samples: Sample[];
  hints: string[];
  has_editorial: boolean;
}

export interface Editorial {
  editorial_fr: string;
  editorial_en: string | null;
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
}

export type SkillState = 'mastered' | 'recommended' | 'not_ready';

export interface SkillProblemRef {
  slug: string;
  title: string;
  difficulty: number;
  solved: boolean;
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
}

export type SubmissionLanguage = 'cpp' | 'python' | 'c' | 'java';

export type Verdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'IE';

export interface RunCase {
  verdict: Verdict;
  input: string;
  expected_output: string | null;
  stdout: string | null;
  stderr: string | null;
  time_s: number | null;
  memory_kb: number | null;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  if (resp.status === 204) return undefined as T;
  return resp.json();
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

  problems: (params: { category?: string; difficulty?: number; q?: string }) => {
    const search = new URLSearchParams();
    if (params.category) search.set('category', params.category);
    if (params.difficulty) search.set('difficulty', String(params.difficulty));
    if (params.q) search.set('q', params.q);
    const qs = search.toString();
    return request<ProblemSummary[]>(`/api/problems${qs ? `?${qs}` : ''}`);
  },
  categories: () => request<string[]>('/api/problems/categories'),
  skillTree: () => request<SkillNode[]>('/api/skills/tree'),
  problem: (slug: string) => request<ProblemDetail>(`/api/problems/${slug}`),

  submit: (slug: string, language: SubmissionLanguage, sourceCode: string) =>
    request<Submission>(`/api/problems/${slug}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ language, source_code: sourceCode }),
    }),
  submission: (id: number) => request<Submission>(`/api/submissions/${id}`),
  mySubmissions: (slug: string) => request<Submission[]>(`/api/problems/${slug}/submissions`),

  run: (slug: string, language: SubmissionLanguage, sourceCode: string, customInput?: string) =>
    request<RunResult>(`/api/problems/${slug}/run`, {
      method: 'POST',
      body: JSON.stringify({
        language,
        source_code: sourceCode,
        custom_input: customInput ?? null,
      }),
    }),
  editorial: (slug: string) => request<Editorial>(`/api/problems/${slug}/editorial`),
  solutions: (slug: string) => request<SharedSolution[]>(`/api/problems/${slug}/solutions`),
};
