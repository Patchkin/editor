/** How tool results read. Pure, so the tests can check the words without a hub. */

export const RUN_CHIPS = ['all', 'needsMe', 'running', 'waiting', 'prOpen', 'checksFailing', 'conflicts', 'readyToMerge', 'merged', 'failed'];

export const RUN_AGENTS = ['claude', 'codex', 'aider', 'opencode', 'cursor-agent', 'gemini', 'copilot', 'amp', 'kiro-cli', 'goose', 'cline'];

const STATUS = {
  awaiting_approval: 'waiting for approval',
  running: 'running',
  finished: 'finished',
  failed: 'failed',
  declined: 'declined',
  cancelled: 'cancelled',
  expired: 'expired',
};

export function statusLabel(run) {
  if (run.status === 'running' && run.planFirst && run.planStatus === 'ready') return 'plan ready for you';
  return STATUS[run.status] || String(run.status || '').replace(/_/g, ' ');
}

export function prBadge(run) {
  if (!run.prUrl) return '';
  if (run.prState === 'merged') return 'merged';
  if (run.prState === 'closed') return 'closed';
  if (run.prMergeable === 'conflicting') return 'conflicts';
  const checks = run.prDetails?.checks?.state;
  if (checks === 'failing') return 'checks failing';
  if (run.prMergeable === 'clean' && ['passing', 'none', 'running', 'unknown'].includes(checks)) return 'ready to merge';
  if (checks === 'running') return 'checks running';
  return 'open';
}

export function runLine(run) {
  const facts = [statusLabel(run), run.machineName, run.agent].filter(Boolean);
  const pr = prBadge(run);
  if (pr) facts.push(`PR ${pr}`);
  return `- ${run.ticketKey} ${run.ticketTitle} \u2014 ${facts.join(' \u00b7 ')} (run ${run.id})`;
}

export function runSummary(run) {
  const lines = [
    `${run.ticketKey} ${run.ticketTitle}`,
    `- status: ${statusLabel(run)}${run.planFirst ? ` (plan-first${run.planStatus ? `, plan ${run.planStatus}` : ''})` : ''}`,
    `- machine: ${run.machineName}`,
    `- agent: ${run.agent}`,
    `- asked by: ${run.requestedByName}`,
    `- run id: ${run.id}`,
  ];
  if (run.branch) lines.push(`- branch: ${run.branch}`);
  if (run.prUrl) {
    const bits = [run.prState, run.prMergeable, run.prDetails?.checks?.state].filter(Boolean);
    lines.push(`- pull request: ${run.prUrl}${bits.length ? ` (${bits.join(', ')})` : ''}`);
  }
  if (run.decidedByName) lines.push(`- decided by: ${run.decidedByName}`);
  if (run.error) lines.push(`- error: ${run.error}`);
  return lines.join('\n');
}

export function planCheckText(check) {
  if (!check) return '';
  const lines = [`- plan check: ${check.consistent ? 'fits the accepted decisions' : 'conflicts with an accepted decision'}`];
  if (check.summary) lines.push(`  ${check.summary}`);
  for (const conflict of check.conflicts || []) lines.push(`  conflict: ${conflict.adr}${conflict.path ? ` (${conflict.path})` : ''}: ${conflict.reason}`);
  if ((check.concerns || []).length) lines.push(`  worth a look: ${check.concerns.join('; ')}`);
  if (check.second) lines.push(`  second opinion: ${check.second.error ? `could not ask (${check.second.error})` : check.second.consistent ? 'agrees' : 'disagrees'}${check.second.provider ? ` (${check.second.provider})` : ''}`);
  return lines.join('\n');
}

export function briefLines(brief) {
  if (!brief) return [];
  const state = brief.plan?.state ?? 'none';
  const plan = {
    approved: 'the plan was approved before the change',
    'not approved': 'the plan was not approved before the change',
    sealed: 'the plan is sealed on an encrypted machine and cannot be read here',
    none: 'this run has no plan',
  }[state] || `plan state: ${state}`;
  const out = [plan];
  out.push(brief.lines?.known ? `${brief.lines.files} file(s), +${brief.lines.add ?? 0} \u2212${brief.lines.del ?? 0} lines` : `${brief.lines?.files ?? 0} file(s)`);
  const drift = brief.drift || {};
  if (!drift.checked) out.push('drift was not checked');
  else if ((drift.unplanned || []).length) out.push(`${drift.unplanned.length} file(s) outside the plan: ${drift.unplanned.slice(0, 5).join(', ')}`);
  else out.push('matches the plan');
  if ((brief.tests?.changed || []).length) out.push(`tests changed: ${brief.tests.changed.slice(0, 3).join(', ')}`);
  if (brief.checks?.state === 'failing' && (brief.checks.failing || []).length) out.push(`checks failing: ${brief.checks.failing.slice(0, 3).join(', ')}`);
  for (const item of (brief.lookHere || []).slice(0, 3)) out.push(item);
  return out;
}

/** The questions an agent listed under an "Open question(s)" heading, one per bullet or numbered line. */
export function openQuestions(plan) {
  const lines = String(plan ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s{0,3}#{1,6}\s*open questions?\b/i.test(line));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) break;
    const match = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
    if (match) out.push(match[1].replace(/\*\*/g, '').trim());
    if (out.length >= 10) break;
  }
  return out;
}

export function runDetails(detail) {
  const run = detail.run;
  const parts = [runSummary(run)];
  const check = planCheckText(run.planCheck);
  if (check) parts.push('', check);
  const brief = briefLines(run.brief);
  if (brief.length) parts.push('', 'Review brief:', ...brief.map((line) => `- ${line}`));
  if (detail.planSealed || run.planEncrypted) {
    parts.push('', 'The plan is sealed for the team: only a browser holding the team key can read and approve it. Use the Patchkin web board.');
  } else if (detail.plan) {
    const questions = openQuestions(detail.plan);
    if (questions.length) parts.push('', 'Open questions from the agent:', ...questions.map((q) => `- ${q}`));
    parts.push('', 'Plan (verbatim):', detail.plan.trim());
  } else {
    parts.push('', run.status === 'awaiting_approval' ? 'The run is waiting for approval; there is no plan yet.' : 'No plan is attached to this run.');
  }
  return parts.join('\n');
}

export function rulesText(body, kinds) {
  const wanted = new Set(kinds && kinds.length ? kinds : ['rule', 'command', 'skill']);
  const standards = (body.standards || []).filter((standard) => standard.enabled !== false && wanted.has(standard.kind));
  if (!standards.length) return 'No team rules, commands or skills are set for this team yet.';
  const lines = [
    'These are the standards Patchkin keeps in sync with the web board. The daemon on each paired machine writes them where the tools read them (Claude Code: the marked block in ~/.claude/CLAUDE.md, ~/.claude/commands/<name>.md and ~/.claude/skills/<name>/SKILL.md).',
    '',
  ];
  for (const standard of standards) {
    const tools = (standard.tools || []).join(', ') || 'all tools';
    lines.push(`- ${standard.name} (${standard.kind}, version ${standard.version}, ${tools})${standard.source === 'context' ? ' [generated from the Context bank]' : ''}: ${standard.title}`);
  }
  return lines.join('\n');
}

export function queueText(body) {
  const runs = body.runs || [];
  if (!runs.length) return 'Nothing is waiting for you in Patchkin.';
  const head = body.canDecide
    ? `${runs.length} run(s) need you (you can approve runs and answer plans):`
    : `${runs.length} run(s) of yours need you:`;
  return [head, ...runs.map(runLine), '', 'Use patchkin_run with a run id to read a plan, or patchkin_decide_plan to answer one.'].join('\n');
}

export function runsText(body) {
  const runs = body.runs || [];
  if (!runs.length) return 'No runs match.';
  return [`${runs.length} run(s):`, ...runs.map(runLine)].join('\n');
}

