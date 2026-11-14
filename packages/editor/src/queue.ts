import type { ReviewBrief, Run } from './types';

/**
 * The rules the web board uses for "Needs you" and the run rows, in one place so the sidebar says the same thing.
 * The originals are `attentionCount` and `runBadge` in packages/web/src/runAttention.ts and packages/web/src/runRows.ts;
 * this package cannot import the React app, so the small pure rules live here with tests beside them.
 */

export interface Viewer {
  id: string;
  canDecide: boolean;
  /** Projects whose approval rule lets the person who asked approve and answer their own run. */
  selfApproval?: ReadonlySet<string>;
}

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'off';

export interface Badge {
  text: string;
  tone: BadgeTone;
}

/** The hub's rule: an owner or admin decides, or the person who asked in a project that trusts its developers. */
export function canAnswer(run: Run, me: Viewer): boolean {
  return me.canDecide || (run.requestedBy === me.id && !!me.selfApproval?.has(run.projectId));
}

/** A run that is waiting for this person: a request they may approve, or a plan they may answer. */
export function needsYou(run: Run, me: Viewer): boolean {
  if (!canAnswer(run, me)) return false;
  if (run.status === 'awaiting_approval') return true;
  if (run.status === 'running' && run.planFirst && run.planStatus === 'ready') return true;
  return false;
}

export function statusLabel(run: Run): string {
  if (run.status === 'running' && run.planFirst && run.planStatus === 'ready') return 'Plan ready';
  const labels: Record<string, string> = {
    awaiting_approval: 'Waiting for approval',
    running: 'Running',
    finished: 'Finished',
    failed: 'Failed',
    declined: 'Declined',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
  return labels[run.status] || run.status.replace(/_/g, ' ');
}

export type GroupKey = 'approval' | 'plan' | 'running' | 'attention' | 'review' | 'done';

export interface RunGroup {
  key: GroupKey;
  label: string;
  runs: Run[];
}

const GROUP_LABELS: Record<GroupKey, string> = {
  approval: 'Waiting for approval',
  plan: 'Plan ready for you',
  running: 'Running',
  attention: 'Needs attention',
  review: 'In review',
  done: 'Recently finished',
};

const GROUP_ORDER: GroupKey[] = ['approval', 'plan', 'running', 'attention', 'review', 'done'];

const openPr = (run: Run) => !!run.prUrl && run.prState !== 'merged' && run.prState !== 'closed';
const checksState = (run: Run) => (openPr(run) ? run.prDetails?.checks?.state ?? 'unknown' : '');

export function hasConflicts(run: Run): boolean {
  return openPr(run) && run.prMergeable === 'conflicting';
}

export function checksFailing(run: Run): boolean {
  return openPr(run) && checksState(run) === 'failing';
}

/** A run a person should hear about even when it is not waiting for a decision. */
export function hasAttention(run: Run): boolean {
  return ['failed', 'declined', 'cancelled', 'expired'].includes(run.status) || hasConflicts(run) || checksFailing(run);
}

/** Why a run needs attention, as the few words a notification uses. */
export function attentionReason(run: Run): string {
  if (hasConflicts(run)) return 'has a pull request that conflicts with its base branch';
  if (checksFailing(run)) return 'has failing checks';
  if (run.status === 'failed') return 'failed';
  if (run.status === 'declined') return 'was declined';
  if (run.status === 'cancelled') return 'was cancelled';
  if (run.status === 'expired') return 'expired without an answer';
  return 'needs attention';
}

/** A pull request that is open, merges cleanly and has no failing checks. */
function readyToMerge(run: Run): boolean {
  if (!openPr(run) || run.prMergeable !== 'clean') return false;
  const state = checksState(run);
  return state === 'passing' || state === 'none';
}

/** The short word on a run's row: what its pull request is doing. Null when it has none. */
export function prBadge(run: Run): Badge | null {
  if (!run.prUrl) return null;
  if (run.prState === 'merged') return { text: 'Merged', tone: 'ok' };
  if (run.prState === 'closed') return { text: 'Closed', tone: 'off' };
  if (run.prMergeable === 'conflicting') return { text: 'Conflicts', tone: 'bad' };
  if (checksState(run) === 'failing') return { text: 'Checks failing', tone: 'bad' };
  if (readyToMerge(run)) return { text: 'Ready to merge', tone: 'ok' };
  if (checksState(run) === 'running') return { text: 'Checks running', tone: 'warn' };
  return { text: 'PR open', tone: 'off' };
}

/** The group each run belongs to, one group per run, groups in the order a person works through them. */
export function groupRuns(runs: Run[]): RunGroup[] {
  const buckets = new Map<GroupKey, Run[]>();
  const put = (key: GroupKey, run: Run) => buckets.set(key, [...(buckets.get(key) ?? []), run]);
  for (const run of runs) {
    if (run.status === 'awaiting_approval') put('approval', run);
    else if (run.status === 'running' && run.planFirst && run.planStatus === 'ready') put('plan', run);
    else if (run.status === 'running') put('running', run);
    else if (hasAttention(run)) put('attention', run);
    else if (openPr(run)) put('review', run);
    else put('done', run);
  }
  const newestFirst = (a: Run, b: Run) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.ticketKey.localeCompare(b.ticketKey));
  return GROUP_ORDER
    .filter((key) => (buckets.get(key) ?? []).length > 0)
    .map((key) => ({ key, label: GROUP_LABELS[key], runs: [...(buckets.get(key) ?? [])].sort(newestFirst) }));
}

/** How far the change drifted from the plan, or that drift could not be checked. Null when there is no brief. */
export function driftFlag(brief: ReviewBrief | null | undefined): Badge | null {
  if (!brief) return null;
  if (!brief.drift?.checked) return { tone: 'off', text: brief.plan?.state === 'sealed' ? 'Plan not readable here' : 'Drift not checked' };
  const off = (brief.drift.unplanned ?? []).length;
  if (off) return { tone: 'warn', text: `${off} file${off === 1 ? '' : 's'} outside the plan` };
  return { tone: 'ok', text: 'Matches the plan' };
}

/** The one line that says how the brief reads at a glance: failing checks first, then anything to look at. */
export function briefHeadline(brief: ReviewBrief | null | undefined): Badge | null {
  if (!brief) return null;
  if (brief.checks?.state === 'failing') return { tone: 'bad', text: 'Checks failing' };
  const look = brief.lookHere?.length ?? 0;
  if (look) return { tone: 'warn', text: `${look} thing${look === 1 ? '' : 's'} to look at` };
  return { tone: 'ok', text: 'Nothing stood out' };
}

/** The brief as a few short lines for a tooltip or a panel. */
export function briefLines(brief: ReviewBrief | null | undefined): string[] {
  if (!brief) return [];
  const out: string[] = [];
  const plan = {
    approved: 'Approved plan',
    'not approved': 'Plan not approved before the change',
    sealed: 'Plan sealed on an encrypted machine, not read here',
    none: 'No plan for this run',
  }[brief.plan?.state ?? 'none'];
  out.push(plan ?? 'No plan for this run');
  out.push(
    brief.lines?.known
      ? `${brief.lines.files} file${brief.lines.files === 1 ? '' : 's'}, +${brief.lines.add ?? 0} \u2212${brief.lines.del ?? 0} lines`
      : `${brief.lines?.files ?? 0} file${brief.lines?.files === 1 ? '' : 's'}`,
  );
  for (const area of (brief.areas ?? []).slice(0, 3)) out.push(`${area.area}: ${area.files} file${area.files === 1 ? '' : 's'}`);
  const drift = driftFlag(brief);
  if (drift) out.push(drift.text);
  if ((brief.drift?.unplanned ?? []).length) out.push(`Not in the plan: ${brief.drift.unplanned.slice(0, 5).join(', ')}`);
  if ((brief.tests?.changed ?? []).length) out.push(`Tests changed: ${brief.tests.changed.slice(0, 3).join(', ')}`);
  if (brief.checks?.state === 'failing' && (brief.checks.failing ?? []).length) out.push(`Checks failing: ${brief.checks.failing.slice(0, 3).join(', ')}`);
  for (const line of (brief.lookHere ?? []).slice(0, 3)) out.push(line);
  return out;
}

/** The questions an agent listed under an "Open question(s)" heading in its plan, one per bullet or numbered line. */
export function openQuestions(plan: string): string[] {
  const lines = String(plan ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s{0,3}#{1,6}\s*open questions?\b/i.test(line));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) break;
    const match = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
    if (match) out.push(match[1].replace(/\*\*/g, '').trim());
    if (out.length >= 10) break;
  }
  return out;
}

/** Runs that need this person now and did not need them the last time we looked. */
export function newlyWaiting(previous: ReadonlySet<string>, runs: Run[], me: Viewer): Run[] {
  return runs.filter((run) => needsYou(run, me) && !previous.has(run.id));
}

