#!/usr/bin/env node
/**
 * Package the extension from a copy outside the git checkout.
 *
 * `vsce` run inside a workspace subdirectory lists the whole repository (git ls-files from the repo root), which puts
 * the daemon, the hub and the web app into the VSIX. A copy in a temporary directory has no repository around it, so the
 * `files` whitelist in package.json is what is packaged; build first (`npm run build`).
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'patchkin.vsix'));
const stage = mkdtempSync(path.join(tmpdir(), 'patchkin-extension-'));
try {
  for (const item of ['package.json', 'README.md', 'dist', 'media']) {
    cpSync(path.join(root, item), path.join(stage, item), { recursive: true });
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, ['--yes', '@vscode/vsce@3.6.0', 'package', '--out', output], {
    cwd: stage,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(stage, { recursive: true, force: true });
}
