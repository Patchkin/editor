/**
 * Where the MCP server finds the hub and the person's token.
 *
 * `PATCHKIN_TOKEN` wins, then PATCHKIN_HUB_URL / PATCHKIN_TEAM_ID, then the file that `patchkin-mcp-login` writes
 * (`~/.patchkin/config.json`, or PATCHKIN_CONFIG). The file is written with mode 0600; a looser mode is reported,
 * never silently accepted as fine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_HUB_URL = 'https://blue.patchkin.io';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** The hub address as an origin: https away from this machine, no credentials, no path. */
export function normalizeHubUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return DEFAULT_HUB_URL;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Enter the hub address, for example https://blue.patchkin.io');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The hub address must start with https://');
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) throw new Error('Use https:// for a hub that is not on this machine');
  if (url.username || url.password) throw new Error('Do not put a username or password in the hub address');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Use the address of the hub itself, without a path');
  return url.origin;
}

export function configPath(env = process.env) {
  return env.PATCHKIN_CONFIG || path.join(os.homedir(), '.patchkin', 'config.json');
}

function permissionProblem(file) {
  if (process.platform === 'win32') return '';
  try {
    const mode = fs.statSync(file).mode & 0o777;
    if ((mode & 0o077) !== 0) return `${file} can be read by other users on this machine; run chmod 600 on it`;
  } catch {
    // The file was there when it was read; a stat failure changes nothing.
  }
  return '';
}

/** The settings in effect: environment first, then the saved file. `problem` is a warning to show a person, never a secret. */
export function loadConfig(env = process.env) {
  const file = configPath(env);
  let saved = {};
  let problem = '';
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') problem = `Could not read ${file}: ${error.message}`;
  }
  const token = String(env.PATCHKIN_TOKEN || saved.token || '').trim();
  return {
    hubUrl: normalizeHubUrl(env.PATCHKIN_HUB_URL || saved.hubUrl || DEFAULT_HUB_URL),
    token,
    teamId: String(env.PATCHKIN_TEAM_ID || saved.teamId || '').trim(),
    email: String(saved.email || '').trim(),
    file,
    source: env.PATCHKIN_TOKEN ? 'env' : token ? 'file' : 'none',
    problem: problem || (!env.PATCHKIN_TOKEN ? permissionProblem(file) : ''),
  };
}

/** Save a signed-in session. The token is the only secret; email and team id are only there to make the next login shorter. */
export function saveConfig({ hubUrl, token, teamId = '', email = '' }, env = process.env) {
  const file = configPath(env);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* a shared home may not allow it */ }
  const body = { hubUrl: normalizeHubUrl(hubUrl), token, teamId, email, savedAt: new Date().toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows has no POSIX mode */ }
  return file;
}

export function configProblem(config) {
  if (!config.token) {
    return `No Patchkin token. Run patchkin-mcp-login, or set PATCHKIN_TOKEN.${config.problem ? ` ${config.problem}` : ''}`;
  }
  return config.problem || '';
}
