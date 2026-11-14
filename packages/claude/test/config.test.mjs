import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configPath, configProblem, DEFAULT_HUB_URL, loadConfig, normalizeHubUrl, saveConfig } from '../src/config.mjs';

test('the hub address is an origin, https away from this machine, and never carries credentials', () => {
  assert.equal(normalizeHubUrl(''), DEFAULT_HUB_URL);
  assert.equal(normalizeHubUrl('https://blue.patchkin.io/'), 'https://blue.patchkin.io');
  assert.equal(normalizeHubUrl('http://localhost:4000'), 'http://localhost:4000');
  assert.throws(() => normalizeHubUrl('http://patchkin.example'), /https/);
  assert.throws(() => normalizeHubUrl('https://user:secret@patchkin.example'), /username or password/);
  assert.throws(() => normalizeHubUrl('not a url'), /hub address/);
});

test('environment wins over the saved file, which wins over the defaults', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchkin-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { PATCHKIN_CONFIG: path.join(dir, 'config.json') };
  assert.equal(configPath(env), env.PATCHKIN_CONFIG);

  const empty = loadConfig(env);
  assert.deepEqual([empty.hubUrl, empty.token, empty.teamId, empty.source, empty.problem], [DEFAULT_HUB_URL, '', '', 'none', '']);
  assert.match(configProblem(empty), /patchkin-mcp-login/);

  const file = saveConfig({ hubUrl: 'https://blue.patchkin.io', token: 'saved-token', teamId: 't1', email: 'dana@acme.test' }, env);
  assert.equal(file, env.PATCHKIN_CONFIG);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only the owner can read the token');
  const saved = loadConfig(env);
  assert.deepEqual([saved.hubUrl, saved.token, saved.teamId, saved.email, saved.source], ['https://blue.patchkin.io', 'saved-token', 't1', 'dana@acme.test', 'file']);

  const fromEnv = loadConfig({ ...env, PATCHKIN_TOKEN: 'env-token', PATCHKIN_TEAM_ID: 't2', PATCHKIN_HUB_URL: 'https://blue.patchkin.io' });
  assert.deepEqual([fromEnv.hubUrl, fromEnv.token, fromEnv.teamId, fromEnv.source], ['https://blue.patchkin.io', 'env-token', 't2', 'env']);
  assert.equal(configProblem(fromEnv), '');
});

test('a token file that other users can read is reported, not silently trusted', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchkin-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { PATCHKIN_CONFIG: path.join(dir, 'config.json') };
  fs.writeFileSync(env.PATCHKIN_CONFIG, JSON.stringify({ token: 'x', hubUrl: DEFAULT_HUB_URL }), { mode: 0o644 });
  fs.chmodSync(env.PATCHKIN_CONFIG, 0o644);
  assert.match(loadConfig(env).problem, /chmod 600/);
});

test('a broken config file is reported without leaking what was in it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchkin-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { PATCHKIN_CONFIG: path.join(dir, 'config.json') };
  fs.writeFileSync(env.PATCHKIN_CONFIG, '{ not json');
  const config = loadConfig(env);
  assert.match(config.problem, /Could not read/);
  assert.doesNotMatch(config.problem, /not json/);
});
