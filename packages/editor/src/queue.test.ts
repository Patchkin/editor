import assert from 'node:assert/strict';
import test from 'node:test';
import { attentionReason, briefHeadline, briefLines, driftFlag, groupRuns, hasAttention, needsYou, newlyWaiting, openQuestions, prBadge, statusLabel } from './queue';
import type { Run } from './types';

function run(over: Partial<Run> = {}): Run {
  return {
    id: 'r1',
    ticketId: 'ticket-1',
    projectId: 'p1',
    ticketKey: '#324',
    ticketTitle: 'Editor plugins',
    requestedBy: 'u-dev',
    requestedByName: 'Dana',
    machineId: 'm1',
    machineName: 'dana-mac',
    agent: 'claude',
    cwd: '/work/app',
    notes: '',
    status: 'running',
    decidedByName: null,
    decidedAt: null,
    sessionId: 's1',
    branch: 'patchkin/task-1',
    prUrl: null,
    prState: '',
    prMergeable: '',
    prDetails: null,
    ticketState: 'open',
    error: null,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    kind: '',
    attempt: 0,
    planFirst: true,
    planStatus: 'waiting',
    planLock: '',
    planEncrypted: false,
    planCheck: null,
    planError: null,
    reviewStatus: 'off',
    review: null,
    brief: null,
    ...over,
  };
}

test('a failed run or a broken pull request needs attention, with words for a notification', () => {
  assert.equal(hasAttention(run({ status: 'failed' })), true);
  assert.equal(attentionReason(run({ status: 'failed' })), 'failed');
  const conflict = run({ status: 'finished', prUrl: 'https://pr/1', prState: 'open', prMergeable: 'conflicting' });
  assert.equal(hasAttention(conflict), true);
  assert.match(attentionReason(conflict), /conflicts/);
  const failing = run({ status: 'finished', prUrl: 'https://pr/1', prState: 'open', prDetails: { files: 1, add: 1, del: 0, checks: { state: 'failing', failing: [] } } });
  assert.equal(hasAttention(failing), true);
  assert.match(attentionReason(failing), /failing checks/);
  assert.equal(hasAttention(run({ status: 'running' })), false);
  assert.equal(attentionReason(run({ status: 'running' })), 'needs attention');
});

test('a run needs you only when you may answer it: an owner, an admin, or the person who asked in a self-approval project', () => {
  const lead = { id: 'u-lead', canDecide: true };
  const dev = { id: 'u-dev', canDecide: false };
  const devSelf = { id: 'u-dev', canDecide: false, selfApproval: new Set(['p1']) };
  const other = { id: 'u-other', canDecide: false };
  const otherSelf = { id: 'u-other', canDecide: false, selfApproval: new Set(['p1']) };
  assert.equal(needsYou(run({ status: 'awaiting_approval' }), lead), true);
  assert.equal(needsYou(run({ status: 'awaiting_approval', requestedBy: 'u-other' }), dev), false);
  assert.equal(needsYou(run({ status: 'awaiting_approval', requestedBy: 'u-other' }), other), false, 'a project that requires approval waits for an owner');
  assert.equal(needsYou(run({ status: 'awaiting_approval', requestedBy: 'u-other' }), otherSelf), true, 'in a self-approval project the request is theirs to approve');
  assert.equal(needsYou(run({ status: 'running', planStatus: 'ready' }), dev), false, 'a project that requires approval keeps the plan for an owner');
  assert.equal(needsYou(run({ status: 'running', planStatus: 'ready' }), devSelf), true, 'a self-approval project lets the person who asked answer');
  assert.equal(needsYou(run({ status: 'running', planStatus: 'ready', requestedBy: 'u-other' }), dev), false);
  assert.equal(needsYou(run({ status: 'running', planStatus: 'approved' }), lead), false);
  assert.equal(needsYou(run({ status: 'finished' }), lead), false);
});

test('runs are grouped the way a person works through them, newest first inside a group', () => {
  const groups = groupRuns([
    run({ id: 'done', status: 'finished' }),
    run({ id: 'review', status: 'finished', prUrl: 'https://pr/1', prState: 'open', prMergeable: 'clean', updatedAt: '2026-01-01T12:00:00.000Z' }),
    run({ id: 'conflict', status: 'finished', prUrl: 'https://pr/2', prState: 'open', prMergeable: 'conflicting' }),
    run({ id: 'plan', status: 'running', planStatus: 'ready' }),
    run({ id: 'run', status: 'running', updatedAt: '2026-01-01T11:00:00.000Z' }),
    run({ id: 'approval', status: 'awaiting_approval' }),
    run({ id: 'failed', status: 'failed' }),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ['approval', 'plan', 'running', 'attention', 'review', 'done']);
  assert.deepEqual(groups.find((g) => g.key === 'attention')!.runs.map((r) => r.id), ['conflict', 'failed']);
  assert.equal(statusLabel(run({ status: 'running', planStatus: 'ready' })), 'Plan ready');
  assert.equal(statusLabel(run({ status: 'awaiting_approval' })), 'Waiting for approval');
});

test('a pull request badge says ready to merge, conflicting, failing, running, merged or closed', () => {
  const base = { prUrl: 'https://pr/1', prState: 'open', prMergeable: 'clean', prDetails: { files: 1, add: 1, del: 0, checks: { state: 'passing', failing: [] } } };
  assert.deepEqual(prBadge(run(base)), { text: 'Ready to merge', tone: 'ok' });
  assert.deepEqual(prBadge(run({ ...base, prMergeable: 'conflicting' })), { text: 'Conflicts', tone: 'bad' });
  assert.deepEqual(prBadge(run({ ...base, prDetails: { ...base.prDetails, checks: { state: 'failing', failing: [{ name: 'tests', url: 'u' }] } } })), { text: 'Checks failing', tone: 'bad' });
  assert.deepEqual(prBadge(run({ ...base, prDetails: { ...base.prDetails, checks: { state: 'running', failing: [] } } })), { text: 'Checks running', tone: 'warn' });
  assert.deepEqual(prBadge(run({ ...base, prState: 'merged' })), { text: 'Merged', tone: 'ok' });
  assert.deepEqual(prBadge(run({ ...base, prState: 'closed' })), { text: 'Closed', tone: 'off' });
  assert.deepEqual(prBadge(run({ ...base, prMergeable: 'unknown' })), { text: 'PR open', tone: 'off' });
  assert.equal(prBadge(run()), null);
});

test('the review brief reads as a plan state, size, drift and what to look at', () => {
  const brief = {
    at: '2026-01-01T00:00:00.000Z',
    plan: { state: 'approved' as const, files: ['packages/hub/src/a.ts'] },
    lines: { files: 2, add: 30, del: 4, known: true },
    areas: [{ area: 'packages/hub', files: 2, add: 30, del: 4, paths: [] }],
    drift: { checked: true, unplanned: ['packages/web/src/b.ts'], untouched: [] },
    tests: { changed: ['packages/hub/src/a.test.ts'] },
    checks: { state: 'passing', failing: [] },
    conflicts: [],
    lookHere: ['packages/hub/src/a.ts: check the fallback'],
  };
  assert.deepEqual(driftFlag(brief), { tone: 'warn', text: '1 file outside the plan' });
  assert.deepEqual(briefHeadline(brief), { tone: 'warn', text: '1 thing to look at' });
  const lines = briefLines(brief);
  assert.ok(lines.includes('Approved plan'));
  assert.ok(lines.includes('2 files, +30 \u22124 lines'));
  assert.ok(lines.includes('Not in the plan: packages/web/src/b.ts'));
  assert.deepEqual(driftFlag({ ...brief, drift: { checked: false, unplanned: [], untouched: [] }, plan: { state: 'sealed', files: [] } }), { tone: 'off', text: 'Plan not readable here' });
  assert.deepEqual(briefHeadline({ ...brief, checks: { state: 'failing', failing: ['tests'] }, lookHere: [] }), { tone: 'bad', text: 'Checks failing' });
});

test('open questions are read from the plan heading and stop at the next heading', () => {
  const questions = openQuestions('# Plan\n\n## Open questions\n- Which region?\n- **Keep** the old key?\n\n## Risks\n- none');
  assert.deepEqual(questions, ['Which region?', 'Keep the old key?']);
  assert.deepEqual(openQuestions('no heading\n- not a question'), []);
});

test('only runs that are newly waiting are announced', () => {
  const me = { id: 'u-lead', canDecide: true };
  const previous = new Set(['old']);
  const added = newlyWaiting(previous, [run({ id: 'old', status: 'awaiting_approval' }), run({ id: 'new', status: 'awaiting_approval' }), run({ id: 'busy' })], me);
  assert.deepEqual(added.map((r) => r.id), ['new']);
});
