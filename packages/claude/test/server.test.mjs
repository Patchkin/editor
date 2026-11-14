import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { createHandler, serve } from '../src/server.mjs';

const RUN = { id: 'r1', ticketKey: '#324', ticketTitle: 'Editor plugins', status: 'running', planFirst: true, planStatus: 'ready', requestedBy: 'u1', machineName: 'dana-mac', agent: 'claude' };

const ctx = {
  teamId: 't1',
  client: {
    me: async () => ({ user: { id: 'u1', name: 'Dana' }, organization: { name: 'Acme' }, teams: [{ id: 't1', name: 'Team' }] }),
    runs: async () => ({ canDecide: true, runs: [RUN] }),
  },
};

test('initialize and tools/list answer in the MCP shape', async () => {
  const handle = createHandler(ctx);
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'patchkin');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.ok(!JSON.stringify(init).includes('tok-'), 'no credential in the handshake');

  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.ok(list.result.tools.some((tool) => tool.name === 'patchkin_queue'));
  assert.ok(list.result.tools.every((tool) => tool.inputSchema.type === 'object'));
});

test('notifications get no answer; unknown methods, unknown tools and tool failures are reported', async () => {
  const handle = createHandler(ctx);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  const unknown = await handle({ jsonrpc: '2.0', id: 3, method: 'nope' });
  assert.equal(unknown.error.code, -32601);

  const unknownTool = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } });
  assert.equal(unknownTool.error.code, -32602);

  const failed = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'patchkin_run', arguments: {} } });
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /run id/);

  const invalid = await handle([1, 2, 3]);
  assert.equal(invalid.error.code, -32600);
});

test('the stdio transport reads newline-delimited JSON and writes one answer per request', async () => {
  const input = new PassThrough();
  const chunks = [];
  const output = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk.toString()); done(); } });
  const finished = serve({ input, output, ctx });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
  input.write('not json\n');
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'patchkin_queue', arguments: {} } })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  input.end();
  await finished;
  const answers = chunks.join('').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(answers.length, 3);
  assert.deepEqual(answers[0], { jsonrpc: '2.0', id: 1, result: {} });
  assert.equal(answers[1].error.code, -32700);
  assert.match(answers[2].result.content[0].text, /#324 Editor plugins/);
});

test('a spawned server talks to a hub over HTTP and never prints the token', async () => {
  const hub = http.createServer((req, res) => {
    const send = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/api/me') return send({ user: { id: 'u1', name: 'Dana' }, organization: { name: 'Acme' }, teams: [{ id: 't1', name: 'Team' }] });
    if (req.url?.startsWith('/api/teams/t1/runs')) return send({ canDecide: true, runs: [RUN] });
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise((resolve) => hub.listen(0, '127.0.0.1', resolve));
  const port = hub.address().port;
  const server = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, PATCHKIN_HUB_URL: `http://127.0.0.1:${port}`, PATCHKIN_TOKEN: 'tok-secret', PATCHKIN_TEAM_ID: 't1', PATCHKIN_CONFIG: '/nonexistent/patchkin/config.json' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'patchkin_queue', arguments: {} } })}\n`);
    const deadline = Date.now() + 5000;
    while (stdout.trim().split('\n').length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const answers = stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(answers.length, 2);
    assert.match(answers[1].result.content[0].text, /#324 Editor plugins/);
    assert.ok(!stdout.includes('tok-secret') && !stderr.includes('tok-secret'), 'the token is never printed');
  } finally {
    child.stdin.end();
    child.kill();
    await new Promise((resolve) => hub.close(resolve));
  }
});
