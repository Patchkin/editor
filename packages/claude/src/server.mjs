#!/usr/bin/env node
/**
 * Patchkin's MCP server for Claude Code: newline-delimited JSON-RPC over stdio.
 *
 * Nothing is printed on stdout except protocol messages. Diagnostics go to stderr, and never include the token.
 * The token comes from PATCHKIN_TOKEN or the file `patchkin-mcp-login` writes; see config.mjs.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { configProblem, loadConfig } from './config.mjs';
import { HubClient } from './hub.mjs';
import { TOOLS, callTool } from './tools.mjs';

const VERSION = '0.1.0';
const INSTRUCTIONS = [
  'Patchkin is the team board for coding agents. Use patchkin_queue first to see what is waiting for a person.',
  'Read a plan with patchkin_run; answer it with patchkin_decide_plan (approve or revise). A plan on an end-to-end encrypted machine can only be read and approved in a browser.',
  'Pull tickets with patchkin_tickets and start a plan-first run with patchkin_start_run. The hub still applies the team\'s approval rule.',
  'Team rules and the Context bank are kept in sync by the daemon on each machine; patchkin_team_rules shows what is set.',
].join(' ');

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** The JSON-RPC dispatch, separate from the transport so it can be tested without a process. */
export function createHandler(ctx) {
  return async (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return fail(null, -32600, 'Invalid Request');
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    if (!hasId) return null; // notifications/initialized and other notifications get no answer
    const { id, method, params } = message;
    try {
      switch (method) {
        case 'initialize':
          return reply(id, {
            protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'patchkin', version: VERSION },
            instructions: INSTRUCTIONS,
          });
        case 'ping':
          return reply(id, {});
        case 'tools/list':
          return reply(id, { tools: TOOLS });
        case 'tools/call': {
          const name = params?.name;
          if (!TOOLS.some((tool) => tool.name === name)) return fail(id, -32602, `Unknown tool: ${name}`);
          try {
            const text = await callTool(name, params?.arguments ?? {}, ctx);
            return reply(id, { content: [{ type: 'text', text: String(text) }] });
          } catch (error) {
            return reply(id, { content: [{ type: 'text', text: error?.message || 'The tool failed' }], isError: true });
          }
        }
        default:
          return fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      return fail(id, -32603, error?.message || 'Internal error');
    }
  };
}

/** Serve MCP on stdin/stdout until the input closes. */
export function serve({ input = process.stdin, output = process.stdout, ctx } = {}) {
  const handler = createHandler(ctx);
  const write = (message) => {
    if (message) output.write(`${JSON.stringify(message)}\n`);
  };
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        write(fail(null, -32700, 'Parse error'));
        return;
      }
      write(await handler(message));
    });
  });
  return new Promise((resolve) => {
    rl.on('close', () => resolve());
  });
}

async function main() {
  const config = loadConfig();
  const problem = config.token ? '' : configProblem(config);
  if (problem) process.stderr.write(`patchkin-mcp: ${problem}\n`);
  if (config.problem && config.token) process.stderr.write(`patchkin-mcp: ${config.problem}\n`);
  const ctx = {
    client: new HubClient({ hubUrl: config.hubUrl, token: config.token }),
    teamId: config.teamId,
    problem,
  };
  process.stderr.write(`patchkin-mcp ${VERSION} ready (${config.hubUrl}, token from ${config.source})\n`);
  await serve({ ctx });
}

function invokedDirectly() {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((error) => {
    process.stderr.write(`patchkin-mcp: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
