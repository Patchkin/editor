#!/usr/bin/env node
/**
 * Sign in once and save a token for the MCP server. It asks for the hub, email, password and (if the account uses it)
 * a 6-digit code, then writes ~/.patchkin/config.json with mode 0600. The password is never written anywhere.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HUB_URL, loadConfig, normalizeHubUrl, saveConfig } from './config.mjs';
import { HubClient } from './hub.mjs';

/** Ask for a value without showing it. Falls back to a normal prompt when there is no terminal (a pipe). */
export function askHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input });
      output.write(question);
      rl.once('line', (line) => { rl.close(); resolve(line); });
    });
  }
  return new Promise((resolve, reject) => {
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const finish = (fn) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      fn();
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') return finish(() => reject(new Error('Cancelled')));
        if (char === '\r' || char === '\n') return finish(() => { output.write('\n'); resolve(value); });
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        value += char;
      }
    };
    input.on('data', onData);
  });
}

export async function login({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  let saved;
  try { saved = loadConfig(env); } catch { saved = { hubUrl: DEFAULT_HUB_URL, email: '', teamId: '' }; }
  const rl = readline.createInterface({ input, output });
  const ask = (question) => rl.question(question);
  const secret = async (question) => {
    if (!input.isTTY) return ask(question);
    rl.pause();
    try { return await askHidden(question, { input, output }); } finally { rl.resume(); }
  };
  try {
    const enteredHub = (await ask(`Patchkin hub [${saved.hubUrl || DEFAULT_HUB_URL}]: `)).trim();
    const hubUrl = normalizeHubUrl(enteredHub || saved.hubUrl || DEFAULT_HUB_URL);
    const enteredEmail = (await ask(`Email${saved.email ? ` [${saved.email}]` : ''}: `)).trim();
    const email = enteredEmail || saved.email;
    if (!email) throw new Error('An email address is required');
    const password = await secret('Password: ');
    if (!password) throw new Error('A password is required');

    const client = new HubClient({ hubUrl });
    let result = await client.signIn({ email, password });
    for (let attempt = 0; !result.ok && result.mfaRequired && attempt < 3; attempt++) {
      const code = (await secret('6-digit code from your authenticator app: ')).trim();
      if (!code) throw new Error('The authenticator code is required');
      result = await client.signIn({ email, password, code });
    }
    if (!result.ok) throw new Error(result.error);

    const authed = new HubClient({ hubUrl, token: result.token });
    const me = await authed.me();
    const teams = me.teams || [];
    if (!teams.length) throw new Error('This account is not in a Patchkin team yet');
    let teamId = teams.find((team) => team.id === saved.teamId)?.id || (teams.length === 1 ? teams[0].id : '');
    if (!teamId) {
      output.write('Teams:\n');
      teams.forEach((team, index) => output.write(`  ${index + 1}. ${team.name} (${team.id})\n`));
      const choice = (await ask('Team [1]: ')).trim() || '1';
      teamId = teams[Number(choice) - 1]?.id || teams[0].id;
    }

    const file = saveConfig({ hubUrl, token: result.token, teamId, email }, env);
    output.write(`Signed in as ${me.user?.name || email}${me.organization?.name ? ` in ${me.organization.name}` : ''}.\n`);
    output.write(`Saved to ${file}; only you can read it.\n`);
    output.write('Claude Code finds it automatically (PATCHKIN_TOKEN overrides it). The token lasts 7 days, so run this again when it expires.\n');
  } finally {
    rl.close();
  }
}

function invokedDirectly() {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  login().catch((error) => {
    process.stderr.write(`patchkin-mcp-login: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
