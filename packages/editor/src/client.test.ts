import assert from 'node:assert/strict';
import test from 'node:test';
import { HubClient, HubError, pairInstallCommand } from './client';

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(handler: (seen: Seen) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>) {
  const seen: Seen[] = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = { url: String(input), init: init ?? {} };
    seen.push(request);
    const answer = await handler(request);
    const status = answer.status ?? 200;
    const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { seen, doFetch };
}

const client = (fetchImpl: typeof fetch, token = 'tok-1') => new HubClient({ hubUrl: 'https://blue.patchkin.io', token, fetch: fetchImpl });

test('sign in posts the credentials without a token and reports two-factor sign-in separately', async () => {
  const ok = fakeFetch(() => ({ body: { token: 'new-token', user: { id: 'u1', name: 'Dana', email: 'dana@acme.test' }, organization: { id: 'o1', name: 'Acme' }, teams: [{ id: 't1', name: 'Team' }] } }));
  const signed = await client(ok.doFetch).signIn({ email: 'dana@acme.test', password: 'secret' });
  assert.ok(signed.ok);
  assert.equal(signed.token, 'new-token');
  assert.equal(signed.teams[0].id, 't1');
  assert.equal(ok.seen[0].url, 'https://blue.patchkin.io/api/auth/login');
  assert.equal(ok.seen[0].init.method, 'POST');
  assert.equal((ok.seen[0].init.headers as Record<string, string>).Authorization, undefined, 'never send an old token to sign in');
  assert.deepEqual(JSON.parse(String(ok.seen[0].init.body)), { email: 'dana@acme.test', password: 'secret' });

  const mfa = fakeFetch(() => ({ status: 401, body: { error: 'Enter the 6-digit code', mfaRequired: true } }));
  const asked = await client(mfa.doFetch).signIn({ email: 'dana@acme.test', password: 'secret' });
  assert.equal(asked.ok, false);
  assert.equal(asked.ok ? undefined : asked.mfaRequired, true);
  assert.match(asked.ok ? '' : asked.error, /6-digit/);
});

test('run requests carry the token and the filter the hub understands', async () => {
  const fake = fakeFetch(() => ({ body: { canDecide: true, runs: [], nextCursor: null } }));
  const page = await client(fake.doFetch, 'tok-2').runs('team 1', { status: 'needsMe', limit: 50 });
  assert.deepEqual(page, { canDecide: true, runs: [], nextCursor: null });
  const url = new URL(fake.seen[0].url);
  assert.equal(url.pathname, '/api/teams/team%201/runs');
  assert.equal(url.searchParams.get('status'), 'needsMe');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.equal((fake.seen[0].init.headers as Record<string, string>).Authorization, 'Bearer tok-2');
});

test('approving and sending a plan back send exactly the fields the hub reads', async () => {
  const fake = fakeFetch(() => ({ body: { run: { id: 'r1' } } }));
  const hub = client(fake.doFetch);
  await hub.decidePlan('t1', 'r1', 'approve', { note: 'Keep it small.' });
  assert.equal(fake.seen[0].url, 'https://blue.patchkin.io/api/teams/t1/runs/r1/plan/approve');
  assert.deepEqual(JSON.parse(String(fake.seen[0].init.body)), { note: 'Keep it small.' });

  await hub.decidePlan('t1', 'r1', 'revise', { feedback: 'Use Valkey.' });
  assert.deepEqual(JSON.parse(String(fake.seen[1].init.body)), { feedback: 'Use Valkey.' });

  await hub.decidePlan('t1', 'r1', 'approve', { note: 'Yes', acknowledge: true });
  assert.deepEqual(JSON.parse(String(fake.seen[2].init.body)), { note: 'Yes', acknowledge: true });

  await hub.decideRun('t1', 'r1', 'decline');
  assert.equal(fake.seen[3].url, 'https://blue.patchkin.io/api/teams/t1/runs/r1/decline');
  assert.deepEqual(JSON.parse(String(fake.seen[3].init.body)), {});
});

test('a hub error keeps the status and the code the panel needs for an ADR conflict', async () => {
  const fake = fakeFetch(() => ({ status: 409, body: { error: 'The plan conflicts with: ADR 0004. Confirm to approve it anyway.', code: 'adr_conflict' } }));
  await assert.rejects(
    () => client(fake.doFetch).decidePlan('t1', 'r1', 'approve'),
    (error: unknown) => {
      assert.ok(error instanceof HubError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'adr_conflict');
      assert.match(error.message, /ADR 0004/);
      return true;
    },
  );
});

test('a hub that cannot be reached says so without a token in the message', async () => {
  const doFetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  await assert.rejects(
    () => client(doFetch, 'secret-token').me(),
    (error: unknown) => {
      assert.ok(error instanceof HubError);
      assert.equal(error.status, 0);
      assert.match(error.message, /Could not reach Patchkin at https:\/\/blue\.patchkin\.io/);
      assert.ok(!error.message.includes('secret-token'));
      return true;
    },
  );
});

test('pairing uses the same install command as the web board, with a safe code', () => {
  assert.equal(
    pairInstallCommand('https://blue.patchkin.io', '842192', 'linux'),
    'curl -fsSL https://blue.patchkin.io/api/install.sh | sh -s -- --code 842192',
  );
  assert.equal(
    pairInstallCommand('https://blue.patchkin.io', '842192', 'win32'),
    '& ([scriptblock]::Create((irm https://blue.patchkin.io/api/install.ps1))) -Code 842192',
  );
  assert.match(pairInstallCommand('http://localhost:4000', 'a-b_c', 'darwin'), /--code a-b_c$/);
  assert.ok(!pairInstallCommand('https://blue.patchkin.io', '12; rm -rf /', 'linux').includes(';'), 'the code cannot add a second command');
  assert.throws(() => pairInstallCommand('https://blue.patchkin.io', '???', 'linux'), /pairing code/);
});
