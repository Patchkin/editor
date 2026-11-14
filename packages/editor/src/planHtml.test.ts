import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPlanPanel } from './planHtml';
import type { Run } from './types';

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1', ticketId: 't1', projectId: 'p1', ticketKey: '#324', ticketTitle: 'Editor plugins <script>alert(1)</script>',
  requestedBy: 'u1', requestedByName: 'Dana <b>', machineId: 'm1', machineName: 'dana-mac', agent: 'claude', cwd: '', notes: '',
  status: 'running', decidedByName: null, decidedAt: null, sessionId: 's1', branch: 'b', prUrl: null, prState: '', prMergeable: '',
  prDetails: null, ticketState: 'open', error: null, createdAt: '', updatedAt: '', kind: '', attempt: 0,
  planFirst: true, planStatus: 'ready', planLock: '', planEncrypted: false, planCheck: null, planError: null,
  reviewStatus: 'off', review: null, brief: null, ...over,
});

const base = { plan: '# Plan\nChange `a.ts`.', planSealed: false, canDecide: true, cspSource: 'vscode-webview://abc', nonce: 'nonce-123' };

test('plan and ticket text are escaped, and the only script is the one with the nonce', () => {
  const html = renderPlanPanel({ ...base, run: run(), plan: 'Before </pre><script>alert(1)</script> after' });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'no plan text can become a script');
  assert.ok(html.includes('&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Editor plugins &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes("script-src 'nonce-nonce-123'"));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.ok(html.includes('Dana &lt;b&gt;'));
});

test('an owner or admin gets the approve and send-back controls and the open questions', () => {
  const html = renderPlanPanel({ ...base, run: run({ planCheck: { consistent: true, summary: 'Fine', conflicts: [], concerns: ['No tests'] } }), plan: '# Plan\n\n## Open questions\n- Which region?' });
  assert.ok(html.includes('data-action="approve-plan"'));
  assert.ok(html.includes('data-action="revise-plan"'));
  assert.ok(html.includes('Which region?'));
  assert.ok(html.includes('Fits your decisions'));
  assert.ok(html.includes('id="note"'));
  assert.ok(html.includes('id="feedback"'));
});

test('someone who cannot decide sees why, and no decision buttons', () => {
  const html = renderPlanPanel({ ...base, canDecide: false, run: run(), plan: '# Plan' });
  assert.ok(!html.includes('data-action="approve-plan"'));
  assert.ok(html.includes('Only an owner or team admin can answer this plan'));
});

test('an approved plan says so and offers no second approval', () => {
  const html = renderPlanPanel({ ...base, run: run({ planStatus: 'approved' }), plan: '# Plan\nDone.' });
  assert.ok(html.includes('This plan is approved. The agent is carrying it out.'));
  assert.ok(!html.includes('data-action="approve-plan"'));
  assert.ok(!html.includes('data-action="revise-plan"'));
});

test('an encrypted plan is not shown, and the browser is offered instead', () => {
  const html = renderPlanPanel({ ...base, run: run({ planEncrypted: true }), plan: null, planSealed: true });
  assert.ok(html.includes('sealed for your team'));
  assert.ok(html.includes('data-action="open-browser"'));
  assert.ok(!html.includes('data-action="approve-plan"'));
});

test('a run waiting for approval offers approve and decline, with the AI review when there is one', () => {
  const html = renderPlanPanel({
    ...base,
    run: run({ status: 'awaiting_approval', planStatus: 'waiting', review: { ready: true, size: 'small', summary: 'A small change', missing: ['Which tracker?'] } }),
    plan: null,
  });
  assert.ok(html.includes('data-action="approve-run"'));
  assert.ok(html.includes('data-action="decline-run"'));
  assert.ok(html.includes('A small change'));
  assert.ok(html.includes('Would have to ask: Which tracker?'));
  assert.ok(!html.includes('data-action="approve-plan"'));
});

test('errors are escaped and the brief is shown', () => {
  const html = renderPlanPanel({
    ...base,
    run: run({ brief: { at: '', plan: { state: 'approved', files: [] }, lines: { files: 2, add: 3, del: 1, known: true }, areas: [], drift: { checked: true, unplanned: [], untouched: [] }, tests: { changed: [] }, checks: { state: 'passing', failing: [] }, conflicts: [], lookHere: [] } }),
    plan: '# Plan',
    error: 'The hub said <no>',
  });
  assert.ok(html.includes('The hub said &lt;no&gt;'));
  assert.ok(html.includes('Matches the plan'));
  assert.ok(html.includes('2 files, +3 \u22121 lines'));
});
