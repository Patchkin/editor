import assert from 'node:assert/strict';
import test from 'node:test';
import { HubClient, HubError } from '../src/hub.mjs';

function fakeFetch(answer) {
  const seen = [];
  const doFetch = async (url, init) => {
    seen.push({ url: String(url), init });
    const result = await answer({ url: String(url), init });
    return new Response(result.body === undefined ? '' : JSON.stringify(result.body), { status: result.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { seen, doFetch };
}

const client = (fetchImpl, token = 'tok-1') => new HubClient({ hubUrl: 'https://blue.patchkin.io', token, fetch: fetchImpl });

test('requests carry the token, the query and JSON only when there is a body', async () => {
  const fake = fakeFetch(() => ({ body: { canDecide: true, runs: [] } }));
  await client(fake.doFetch).runs('team 1', { status: 'needsMe', limit: 25 });
  const url = new URL(fake.seen[0].url);
  assert.equal(url.pathname, '/api/teams/team%201/runs');
  assert.equal(url.searchParams.get('status'), 'needsMe');
  assert.equal(url.searchParams.get('limit'), '25');
  assert.equal(fake.seen[0].init.headers.Authorization, 'Bearer tok-1');
  assert.equal(fake.seen[0].init.body, undefined);
  assert.equal(fake.seen[0].init.method, 'GET');
});

test('sign in never sends the saved token and reports two-factor sign-in', async () => {
  const fake = fakeFetch(() => ({ status: 401, body: { error: 'Enter the 6-digit code', mfaRequired: true } }));
  const result = await client(fake.doFetch).signIn({ email: 'dana@acme.test', password: 'secret' });
  assert.equal(result.ok, false);
  assert.equal(result.mfaRequired, true);
  assert.equal(fake.seen[0].init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(fake.seen[0].init.body), { email: 'dana@acme.test', password: 'secret' });
});

test('plan decisions send only the fields the hub reads', async () => {
  const fake = fakeFetch(() => ({ body: { run: { id: 'r1' } } }));
  const hub = client(fake.doFetch);
  await hub.decidePlan('t1', 'r1', 'approve', { note: 'Keep it small.' });
  assert.equal(fake.seen[0].url, 'https://blue.patchkin.io/api/teams/t1/runs/r1/plan/approve');
  assert.deepEqual(JSON.parse(fake.seen[0].init.body), { note: 'Keep it small.' });
  await hub.decidePlan('t1', 'r1', 'revise', { feedback: 'Use Valkey.' });
  assert.deepEqual(JSON.parse(fake.seen[1].init.body), { feedback: 'Use Valkey.' });
  await hub.decidePlan('t1', 'r1', 'approve', { acknowledge: true });
  assert.deepEqual(JSON.parse(fake.seen[2].init.body), { acknowledge: true });
});

test('a hub error keeps the status and code, and a network failure never mentions the token', async () => {
  const conflict = fakeFetch(() => ({ status: 409, body: { error: 'The plan conflicts with ADR 0004.', code: 'adr_conflict' } }));
  await assert.rejects(() => client(conflict.doFetch).decidePlan('t1', 'r1', 'approve'), (error) => {
    assert.ok(error instanceof HubError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'adr_conflict');
    return true;
  });

  const down = new HubClient({ hubUrl: 'https://blue.patchkin.io', token: 'secret-token', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => down.me(), (error) => {
    assert.equal(error.status, 0);
    assert.match(error.message, /Could not reach Patchkin/);
    assert.ok(!error.message.includes('secret-token'));
    return true;
  });
});
