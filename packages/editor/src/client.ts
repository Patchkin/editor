import { normalizeHubUrl, REQUEST_TIMEOUT_MS } from './config';
import type {
  Machine,
  Me,
  Pairing,
  Project,
  Run,
  RunDetail,
  RunsPage,
  SignInReply,
  Team,
  Ticket,
  User,
} from './types';

/** What a request to the hub failed with: the message the hub gave, the status, and a code for special cases. */
export class HubError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HubError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type SignInResult =
  | { ok: true; token: string; user: User; organization: SignInReply['organization']; teams: Team[] }
  | { ok: false; error: string; mfaRequired?: boolean };

export interface RunsQuery {
  status?: string;
  person?: string;
  project?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface PlanDecisionInput {
  /** Answers or notes sent with an approval (the hub cuts them at 800 characters, as one line). */
  note?: string;
  /** What should change, when sending a plan back. */
  feedback?: string;
  /** Confirm a plan that conflicts with an accepted decision, when governance asks. */
  acknowledge?: boolean;
}

export interface HubClientOptions {
  hubUrl: string;
  token?: string;
  /** Injected so the client can be tested without the network. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The hub's REST API, as the extension uses it. The same endpoints and permission checks the web app uses:
 * nothing here decides who may approve a plan or start a run, it only carries the person's token.
 */
export class HubClient {
  readonly hubUrl: string;
  private readonly token?: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HubClientOptions) {
    this.hubUrl = normalizeHubUrl(options.hubUrl);
    this.token = options.token;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  withToken(token: string): HubClient {
    return new HubClient({ hubUrl: this.hubUrl, token, fetch: this.doFetch, timeoutMs: this.timeoutMs });
  }

  private async send(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<{ status: number; body: Record<string, unknown> | undefined }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.auth !== false && this.token) headers.Authorization = `Bearer ${this.token}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.doFetch(`${this.hubUrl}${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      const text = await res.text();
      let body: Record<string, unknown> | undefined;
      if (text) {
        try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = undefined; }
      }
      return { status: res.status, body };
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new HubError('The Patchkin hub did not answer in time', 0);
      throw new HubError(`Could not reach Patchkin at ${this.hubUrl}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown; auth?: boolean }): Promise<T> {
    const { status, body } = await this.send(path, init);
    if (status < 200 || status >= 300) {
      const message = String(body?.error || `Patchkin answered ${status}`);
      throw new HubError(message, status, typeof body?.code === 'string' ? body.code : undefined, body);
    }
    return (body ?? {}) as T;
  }

  /** Sign in with a person's email and password. A hub with two-factor sign-in answers `mfaRequired` first. */
  async signIn(input: { email: string; password: string; code?: string }): Promise<SignInResult> {
    const { status, body } = await this.send('/api/auth/login', { method: 'POST', body: input, auth: false });
    if (status === 200 && typeof body?.token === 'string') {
      return {
        ok: true,
        token: body.token,
        user: body.user as User,
        organization: body.organization as SignInReply['organization'],
        teams: (body.teams as Team[]) ?? [],
      };
    }
    return {
      ok: false,
      error: String(body?.error || (status === 401 ? 'Email or password is incorrect' : `Patchkin answered ${status}`)),
      mfaRequired: body?.mfaRequired === true,
    };
  }

  me(): Promise<Me> {
    return this.request<Me>('/api/me');
  }

  runs(teamId: string, query: RunsQuery = {}): Promise<RunsPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params}` : '';
    return this.request<RunsPage>(`/api/teams/${encodeURIComponent(teamId)}/runs${suffix}`);
  }

  run(teamId: string, runId: string): Promise<RunDetail> {
    return this.request<RunDetail>(`/api/teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}`);
  }

  decidePlan(teamId: string, runId: string, action: 'approve' | 'revise', input: PlanDecisionInput = {}): Promise<{ run: Run }> {
    const body: Record<string, unknown> = {};
    if (action === 'revise') body.feedback = input.feedback;
    else {
      if (input.note) body.note = input.note;
      if (input.acknowledge) body.acknowledge = true;
    }
    return this.request<{ run: Run }>(`/api/teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/plan/${action}`, { method: 'POST', body });
  }

  decideRun(teamId: string, runId: string, action: 'approve' | 'decline'): Promise<{ run: Run }> {
    return this.request<{ run: Run }>(`/api/teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/${action}`, { method: 'POST', body: {} });
  }

  async projects(teamId: string): Promise<Project[]> {
    const body = await this.request<{ projects: Project[] }>(`/api/teams/${encodeURIComponent(teamId)}/projects`);
    return body.projects ?? [];
  }

  async tickets(teamId: string, projectId: string, query: { q?: string; limit?: number } = {}): Promise<Ticket[]> {
    const params = new URLSearchParams({ state: 'open', limit: String(query.limit ?? 100) });
    if (query.q) params.set('q', query.q);
    const body = await this.request<{ tickets: Ticket[] }>(
      `/api/teams/${encodeURIComponent(teamId)}/projects/${encodeURIComponent(projectId)}/tickets?${params}`,
    );
    return body.tickets ?? [];
  }

  machines(teamId: string): Promise<Machine[]> {
    return this.request<Machine[]>(`/api/teams/${encodeURIComponent(teamId)}/machines`);
  }

  createPairing(teamId: string): Promise<Pairing> {
    return this.request<Pairing>(`/api/teams/${encodeURIComponent(teamId)}/pairings`, { method: 'POST', body: {} });
  }

  createRun(teamId: string, projectId: string, ticketId: string, body: Record<string, unknown>): Promise<{ run: Run }> {
    return this.request<{ run: Run }>(
      `/api/teams/${encodeURIComponent(teamId)}/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/runs`,
      { method: 'POST', body },
    );
  }
}

/**
 * The command the web board's Pair a machine sheet shows, so pairing from the editor does the same thing:
 * install the daemon if needed, pair with this one-time code, and start it at sign-in.
 */
export function pairInstallCommand(hubUrl: string, code: string, platform: NodeJS.Platform | string): string {
  const origin = normalizeHubUrl(hubUrl);
  const safe = String(code).replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe) throw new Error('The hub did not send a pairing code');
  if (platform === 'win32') return `& ([scriptblock]::Create((irm ${origin}/api/install.ps1))) -Code ${safe}`;
  return `curl -fsSL ${origin}/api/install.sh | sh -s -- --code ${safe}`;
}

