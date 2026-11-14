import assert from 'node:assert/strict';
import test from 'node:test';
import { HubError } from '../src/hub.mjs';
import { TOOLS, callTool } from '../src/tools.mjs';

const RUN = {
  id: 'r1', ticketId: 'tk1', projectId: 'p1', ticketKey: '#324', ticketTitle: 'Editor plugins', requestedBy: 'u1', requestedByName: 'Dana',
  machineId: 'm1', machineName: 'dana-mac', agent: 'claude', status: 'running', planFirst: true, planStatus: 'ready', planEncrypted: false,
  planCheck: { consistent: false, summary: 'Moves sessions to Redis', conflicts: [{ adr: 'ADR 0004', reason: 'The team chose Valkey' }], concerns: ['No tests'] },
  planError: null, branch: 'patchkin/task-324', prUrl: null, prState: '', prMergeable: '', prDetails: null, error: null, decidedByName: null,
  brief: { plan: { state: 'approved', files: ['packages/editor/src/extension.ts'] }, lines: { files: 2, add: 30, del: 4, known: true }, areas: [], drift: { checked: true, unplanned: [], untouched: [] }, tests: { changed: [] }, checks: { state: 'passing', failing: [] }, conflicts: [], lookHere: ['check the CSP'] },
};

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    me: async () => ({ user: { id: 'u1', name: 'Dana', email: 'dana@acme.test' }, organization: { id: 'o1', name: 'Acme' }, teams: [{ id: 't1', name: 'Team' }] }),
    runs: async (team, query) => { calls.push(['runs', team, query]); return { canDecide: true, runs: [RUN] }; },
    run: async (team, id) => { calls.push(['run', team, id]); return { run: RUN, plan: '# Plan\n\n## Open questions\n- Which region?', planSealed: null, aiCalls: [] }; },
    decidePlan: async (team, id, action, input) => { calls.push(['decidePlan', team, id, action, input]); return { run: { ...RUN, planStatus: 'approved' } }; },
    projects: async (team) => { calls.push(['projects', team]); return [{ id: 'p1', name: 'App', repo: 'acme/app', openTickets: 2, planFirst: true, approval: 'required' }]; },
    tickets: async (team, project, query) => { calls.push(['tickets', team, project, query]); return { tickets: [{ id: 'tk1', key: '#324', title: 'Editor plugins', labels: ['feature'], body: 'Build the editor plugins.', state: 'open', url: 'https://tracker/324/new', updatedAt: '2026-01-01T00:00:00.000Z' }], total: 1 }; },
    machines: async (team) => { calls.push(['machines', team]); return [{ id: 'm1', name: 'dana-mac', status: 'online', platform: 'darwin', canUse: true, installedAgents: ['claude', 'bash'] }]; },
    createRun: async (team, project, ticket, body) => { calls.push(['createRun', team, project, ticket, body]); return { run: { ...RUN, status: 'running', planStatus: 'waiting' } }; },
    standards: async () => ({
      standards: [
        { name: 'tests', kind: 'rule', title: 'Every change needs a test', version: 3, tools: ['claude'], enabled: true },
        { name: 'team-context-t1', kind: 'rule', title: 'Team: team context', version: 1, tools: ['claude'], enabled: true, source: 'context' },
        { name: 'off', kind: 'skill', title: 'Withdrawn', version: 1, tools: ['claude'], enabled: false },
        { name: 'other-team', kind: 'rule', title: 'Another team only', version: 1, tools: ['claude'], enabled: true, teamIds: ['t2'] },
      ],
    }),
    ...overrides,
  };
  return client;
}

const ctx = (client) => ({ client, teamId: 't1' });

test('the queue asks the hub for needsMe and names each run with its id', async () => {
  const client = fakeClient();
  const text = await callTool('patchkin_queue', {}, ctx(client));
  assert.deepEqual(client.calls[0], ['runs', 't1', { status: 'needsMe', limit: 25 }]);
  assert.match(text, /#324 Editor plugins/);
  assert.match(text, /plan ready for you/);
  assert.match(text, /run r1/);
  assert.match(text, /you can approve runs and answer plans/);
});

test('a run shows the plan, its open questions, the AI check and the review brief', async () => {
  const text = await callTool('patchkin_run', { run: 'r1' }, ctx(fakeClient()));
  assert.match(text, /#324 Editor plugins/);
  assert.match(text, /conflicts with an accepted decision/);
  assert.match(text, /ADR 0004/);
  assert.match(text, /Which region\?/);
  assert.match(text, /Review brief:/);
  assert.match(text, /matches the plan/);
  assert.match(text, /check the CSP/);
  assert.match(text, /Plan \(verbatim\):/);
});

test('approving and sending a plan back reach the hub endpoints and the activity log name', async () => {
  const approving = fakeClient();
  const approved = await callTool('patchkin_decide_plan', { run: 'r1', action: 'approve', note: 'Keep it small.' }, ctx(approving));
  assert.deepEqual(approving.calls[0], ['decidePlan', 't1', 'r1', 'approve', { note: 'Keep it small.', feedback: '', acknowledge: false }]);
  assert.match(approved, /ticket_run\.plan_approved/);

  const revising = fakeClient();
  await callTool('patchkin_decide_plan', { run: 'r1', action: 'revise', feedback: 'Use Valkey.' }, ctx(revising));
  assert.deepEqual(revising.calls[0], ['decidePlan', 't1', 'r1', 'revise', { note: '', feedback: 'Use Valkey.', acknowledge: false }]);

  await assert.rejects(() => callTool('patchkin_decide_plan', { run: 'r1', action: 'revise', feedback: 'ab' }, ctx(fakeClient())), /at least 3/);
});

test('a plan that conflicts with a decision needs the person to say so first', async () => {
  const conflict = fakeClient({ decidePlan: async () => { throw new HubError('The plan conflicts with: ADR 0004.', 409, 'adr_conflict'); } });
  await assert.rejects(
    () => callTool('patchkin_decide_plan', { run: 'r1', action: 'approve' }, ctx(conflict)),
    /acknowledge: true only if they say yes/,
  );
});

test('starting a run resolves names, defaults to the installed agent and sends the hub its ids', async () => {
  const client = fakeClient();
  const text = await callTool('patchkin_start_run', { project: 'App', ticket: '#324', machine: 'dana-mac', notes: 'Keep it small' }, ctx(client));
  assert.deepEqual(client.calls.at(-1), ['createRun', 't1', 'p1', 'tk1', { machineId: 'm1', agent: 'claude', notes: 'Keep it small' }]);
  assert.match(text, /#324 Editor plugins/);
  assert.match(text, /comes back for a person to answer/);
});

test('tickets without a repository list the repositories, and with one list open tickets', async () => {
  const listing = await callTool('patchkin_tickets', {}, ctx(fakeClient()));
  assert.match(listing, /Which repository/);
  assert.match(listing, /App \(p1\)/);

  const client = fakeClient();
  const tickets = await callTool('patchkin_tickets', { project: 'acme/app', q: 'editor' }, ctx(client));
  assert.deepEqual(client.calls.at(-1), ['tickets', 't1', 'p1', { q: 'editor', state: 'open', limit: 50 }]);
  assert.match(tickets, /#324 Editor plugins \[feature\]/);
});

test('a ticket is read in full, description and all, before work is planned', async () => {
  const client = fakeClient();
  const text = await callTool('patchkin_ticket', { project: 'App', ticket: '#324' }, ctx(client));
  assert.match(text, /#324 Editor plugins/);
  assert.match(text, /Build the editor plugins\./);
  assert.match(text, /https:\/\/tracker\/324\/new/);
  assert.match(text, /repository: App \(acme\/app\)/);
  assert.deepEqual(client.calls.at(-1), ['tickets', 't1', 'p1', { q: '#324', limit: 100 }]);
});

test('team rules show the Context bank standard and leave out withdrawn ones', async () => {
  const text = await callTool('patchkin_team_rules', {}, ctx(fakeClient()));
  assert.match(text, /Every change needs a test/);
  assert.match(text, /Context bank/);
  assert.match(text, /~\/\.claude\/CLAUDE\.md/);
  assert.doesNotMatch(text, /Withdrawn/);
  assert.doesNotMatch(text, /Another team only/);
});

test('a missing token says how to get one, and an unknown tool is refused', async () => {
  await assert.rejects(() => callTool('patchkin_queue', {}, { client: fakeClient(), problem: 'No Patchkin token. Run patchkin-mcp-login.' }), /patchkin-mcp-login/);
  await assert.rejects(() => callTool('patchkin_nope', {}, ctx(fakeClient())), /Unknown tool/);
  assert.ok(TOOLS.some((tool) => tool.name === 'patchkin_queue'));
  assert.equal(new Set(TOOLS.map((tool) => tool.name)).size, TOOLS.length, 'tool names are unique');
});

