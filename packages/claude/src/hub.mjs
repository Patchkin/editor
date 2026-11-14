/** The hub's REST API as the MCP tools use it: the same endpoints and permissions the web app uses. */
import { normalizeHubUrl } from './config.mjs';

export class HubError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'HubError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const enc = encodeURIComponent;

export class HubClient {
  constructor({ hubUrl, token, fetch: doFetch = globalThis.fetch, timeoutMs = 20_000 }) {
    this.hubUrl = normalizeHubUrl(hubUrl);
    this.token = token || '';
    this.doFetch = doFetch;
    this.timeoutMs = timeoutMs;
  }

  async send(path, { method, body, auth = true } = {}) {
    const headers = { Accept: 'application/json', 'User-Agent': 'patchkin-mcp/0.1.0' };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.doFetch(`${this.hubUrl}${path}`, {
        method: method || (body === undefined ? 'GET' : 'POST'),
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed;
      if (text) {
        try { parsed = JSON.parse(text); } catch { parsed = undefined; }
      }
      return { status: res.status, body: parsed };
    } catch (error) {
      if (error?.name === 'AbortError') throw new HubError('The Patchkin hub did not answer in time', 0);
      throw new HubError(`Could not reach Patchkin at ${this.hubUrl}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }

  async request(path, init) {
    const { status, body } = await this.send(path, init);
    if (status < 200 || status >= 300) {
      throw new HubError(String(body?.error || `Patchkin answered ${status}`), status, typeof body?.code === 'string' ? body.code : undefined, body);
    }
    return body ?? {};
  }

  /** The same sign-in the login command uses. A hub with two-factor sign-in answers mfaRequired first. */
  async signIn(input) {
    const { status, body } = await this.send('/api/auth/login', { method: 'POST', body: input, auth: false });
    if (status === 200 && typeof body?.token === 'string') return { ok: true, ...body };
    return { ok: false, error: String(body?.error || 'Could not sign in'), mfaRequired: body?.mfaRequired === true };
  }

  me() {
    return this.request('/api/me');
  }

  runs(teamId, query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params}` : '';
    return this.request(`/api/teams/${enc(teamId)}/runs${suffix}`);
  }

  run(teamId, runId) {
    return this.request(`/api/teams/${enc(teamId)}/runs/${enc(runId)}`);
  }

  decidePlan(teamId, runId, action, input = {}) {
    const body = action === 'revise' ? { feedback: input.feedback } : { ...(input.note ? { note: input.note } : {}), ...(input.acknowledge ? { acknowledge: true } : {}) };
    return this.request(`/api/teams/${enc(teamId)}/runs/${enc(runId)}/plan/${action}`, { method: 'POST', body });
  }

  decideRun(teamId, runId, action) {
    return this.request(`/api/teams/${enc(teamId)}/runs/${enc(runId)}/${action}`, { method: 'POST', body: {} });
  }

  async projects(teamId) {
    const body = await this.request(`/api/teams/${enc(teamId)}/projects`);
    return body.projects ?? [];
  }

  tickets(teamId, projectId, { q = '', state = 'open', limit = 50 } = {}) {
    const params = new URLSearchParams({ state, limit: String(limit) });
    if (q) params.set('q', q);
    return this.request(`/api/teams/${enc(teamId)}/projects/${enc(projectId)}/tickets?${params}`);
  }

  machines(teamId) {
    return this.request(`/api/teams/${enc(teamId)}/machines`);
  }

  createRun(teamId, projectId, ticketId, body) {
    return this.request(`/api/teams/${enc(teamId)}/projects/${enc(projectId)}/tickets/${enc(ticketId)}/runs`, { method: 'POST', body });
  }

  standards() {
    return this.request('/api/standards');
  }
}
