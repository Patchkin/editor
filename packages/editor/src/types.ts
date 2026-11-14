/**
 * The shapes the hub sends the browser, as the extension sees them (see runView in packages/hub/src/projects.ts).
 * Only the fields the sidebar, the plan panel and the commands use are listed; everything is optional where an older hub may leave it out.
 */

export interface Team {
  id: string;
  name: string;
  description?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export interface Organization {
  id: string;
  name: string;
  plan?: string;
}

export interface SignInReply {
  token: string;
  user: User;
  organization: Organization;
  teams: Team[];
}

export interface CheckFailure {
  name: string;
  url: string;
}

export interface PrDetails {
  files: number;
  add: number | null;
  del: number | null;
  checks: { state: string; failing: CheckFailure[] };
}

export interface PlanConflict {
  adr: string;
  reason: string;
  path?: string;
}

export interface PlanCheck {
  consistent?: boolean;
  summary?: string;
  conflicts?: PlanConflict[];
  concerns?: string[];
  second?: {
    provider?: string;
    model?: string;
    consistent?: boolean;
    summary?: string;
    conflicts?: PlanConflict[];
    concerns?: string[];
    error?: string;
  };
}

export interface ReviewBrief {
  at: string;
  plan: { state: 'approved' | 'not approved' | 'sealed' | 'none'; files: string[] };
  lines: { files: number; add: number | null; del: number | null; known: boolean };
  areas: Array<{ area: string; files: number; add: number; del: number; paths: string[] }>;
  drift: { checked: boolean; unplanned: string[]; untouched: string[] };
  tests: { changed: string[] };
  checks: { state: string; failing: string[] };
  conflicts: string[];
  lookHere: string[];
  activityId?: string;
  approvalId?: string;
  commented?: boolean;
}

export interface Run {
  id: string;
  ticketId: string;
  projectId: string;
  ticketKey: string;
  ticketTitle: string;
  requestedBy: string;
  requestedByName: string;
  machineId: string;
  machineName: string;
  agent: string;
  cwd: string;
  notes: string;
  status: string;
  decidedByName: string | null;
  decidedAt: string | null;
  sessionId: string | null;
  branch: string | null;
  prUrl: string | null;
  prState: string;
  prMergeable: string;
  prDetails: PrDetails | null;
  ticketState: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  kind: string;
  attempt: number;
  planFirst: boolean;
  planStatus: string;
  planLock: string;
  planEncrypted: boolean;
  planCheck: PlanCheck | null;
  planError: string | null;
  reviewStatus: string;
  review: { summary?: string; ready?: boolean; size?: string; missing?: string[]; conflicts?: Array<{ adr: string; reason: string }> } | null;
  brief: ReviewBrief | null;
}

export interface RunsPage {
  canDecide: boolean;
  runs: Run[];
  nextCursor?: string | null;
  counts?: Record<string, number>;
}

export interface RunDetail {
  run: Run;
  prompt: string;
  plan: string | null;
  planSealed: unknown;
  aiCalls: unknown[];
}

export interface Project {
  id: string;
  name: string;
  repo: string;
  approval: 'required' | 'self' | string;
  planFirst: boolean;
  openTickets: number;
}

export interface Ticket {
  id: string;
  key: string;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url: string;
  updatedAt: string;
}

export interface Machine {
  id: string;
  name: string;
  platform: string;
  status: 'online' | 'offline';
  e2e?: boolean;
  canUse?: boolean;
  ownerId?: string;
  installedAgents: string[];
  daemonVersion?: string;
  updateAvailable?: boolean;
}

export interface Pairing {
  code: string;
  signature?: string;
  expiresInSeconds: number;
  hub: string;
  command?: string;
}

export interface Me {
  user: User;
  organization: Organization;
  teams: Team[];
  emailEnabled?: boolean;
}

/** Coding agents a ticket can be given to (the hub's RUN_AGENTS). A shell or git is not one. */
export const RUN_AGENTS = [
  'claude',
  'codex',
  'aider',
  'opencode',
  'cursor-agent',
  'gemini',
  'copilot',
  'amp',
  'kiro-cli',
  'goose',
  'cline',
] as const;
