import { briefLines, driftFlag, openQuestions, prBadge, statusLabel } from './queue';
import type { Run } from './types';

/** The plan/run panel's markup, kept free of the VS Code API so it can be tested for escaping. */

export interface PlanPanelInput {
  run: Run;
  plan: string | null;
  planSealed: boolean;
  canDecide: boolean;
  /** The webview's own source, for the content security policy. */
  cspSource: string;
  /** A fresh nonce for this render; the only script the panel may run. */
  nonce: string;
  error?: string;
  notice?: string;
  /** The plan and brief are being read from the hub. */
  loading?: boolean;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badge(text: string, tone: string): string {
  return `<span class="badge ${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function planCheckHtml(run: Run): string {
  const check = run.planCheck;
  if (!check) return '';
  const conflicts = check.conflicts ?? [];
  const concerns = check.concerns ?? [];
  const parts: string[] = [];
  parts.push(`<div class="card ${check.consistent ? 'ok' : 'warn'}">`);
  parts.push(`<div class="row"><strong>${check.consistent ? 'Fits your decisions' : 'Conflicts with a decision'}</strong>${badge(check.consistent ? 'Fits' : 'Conflict', check.consistent ? 'ok' : 'warn')}</div>`);
  if (check.summary) parts.push(`<p>${escapeHtml(check.summary)}</p>`);
  for (const conflict of conflicts) {
    parts.push(`<p class="warn-text"><strong>${escapeHtml(conflict.adr)}</strong>${conflict.path ? ` (${escapeHtml(conflict.path)})` : ''}: ${escapeHtml(conflict.reason)}</p>`);
  }
  if (concerns.length) parts.push(`<p class="muted">Worth a look: ${escapeHtml(concerns.join(' \u00b7 '))}</p>`);
  parts.push('<p class="muted">Written by a model from the plan and your decision records. It can be wrong.</p>');
  if (check.second) {
    const second = check.second;
    parts.push('<div class="second">');
    parts.push(`<div class="row"><strong>Second opinion</strong><span class="muted">${escapeHtml(second.provider || '')}${second.model ? `, ${escapeHtml(second.model)}` : ''}</span>${second.error ? badge('Could not ask', 'off') : badge(second.consistent ? 'Agrees' : 'Disagrees', second.consistent ? 'ok' : 'warn')}</div>`);
    if (second.error) parts.push(`<p class="muted">${escapeHtml(second.error)}</p>`);
    if (second.summary) parts.push(`<p>${escapeHtml(second.summary)}</p>`);
    for (const conflict of second.conflicts ?? []) parts.push(`<p class="warn-text"><strong>${escapeHtml(conflict.adr)}</strong>: ${escapeHtml(conflict.reason)}</p>`);
    if ((second.concerns ?? []).length) parts.push(`<p class="muted">Worth a look: ${escapeHtml((second.concerns ?? []).join(' \u00b7 '))}</p>`);
    parts.push('</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

function reviewHtml(run: Run): string {
  const review = run.review;
  if (!review) return '';
  const parts = ['<div class="card"><div class="row"><strong>AI check on the ticket</strong>'];
  if (review.ready !== undefined) parts.push(badge(review.ready ? 'Looks ready' : 'Needs work', review.ready ? 'ok' : 'warn'));
  if (review.size) parts.push(badge(review.size, 'off'));
  parts.push('</div>');
  if (review.summary) parts.push(`<p>${escapeHtml(review.summary)}</p>`);
  for (const conflict of review.conflicts ?? []) parts.push(`<p class="warn-text"><strong>${escapeHtml(conflict.adr)}</strong>: ${escapeHtml(conflict.reason)}</p>`);
  if ((review.missing ?? []).length) parts.push(`<p class="muted">Would have to ask: ${escapeHtml((review.missing ?? []).join(' \u00b7 '))}</p>`);
  parts.push('<p class="muted">Advice from a model, never a gate. It can be wrong.</p></div>');
  return parts.join('');
}

function questionsHtml(plan: string): string {
  const questions = openQuestions(plan);
  if (!questions.length) return '';
  return [
    '<div class="card warn"><strong>The agent has open questions</strong>',
    `<ul>${questions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}</ul>`,
    '<p class="muted">Answer them here. Typing in the terminal does not count and does not unlock the working copy.</p></div>',
  ].join('');
}

function briefHtml(run: Run): string {
  const lines = briefLines(run.brief);
  if (!lines.length) return '';
  return `<div class="card"><strong>Review brief</strong><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>${run.brief?.commented ? '<p class="muted">Posted on the pull request.</p>' : ''}</div>`;
}

/** The whole panel for one run: facts, the review brief, the plan and the decision. */
export function renderPlanPanel(input: PlanPanelInput): string {
  const { run, plan, planSealed, canDecide, cspSource, nonce } = input;
  const pr = prBadge(run);
  const drift = driftFlag(run.brief);
  const body: string[] = [];

  body.push('<header>');
  body.push(`<h1>${escapeHtml(run.ticketKey)} ${escapeHtml(run.ticketTitle)}</h1>`);
  body.push('<div class="row">');
  body.push(badge(statusLabel(run), run.status === 'awaiting_approval' || run.planStatus === 'ready' ? 'warn' : 'off'));
  if (pr) body.push(badge(pr.text, pr.tone));
  if (drift) body.push(badge(drift.text, drift.tone));
  if (run.branch) body.push(badge(run.branch, 'off'));
  body.push('</div>');
  body.push(`<p class="muted">Asked by ${escapeHtml(run.requestedByName)} \u00b7 ${escapeHtml(run.machineName)} \u00b7 ${escapeHtml(run.agent)}${run.kind ? ` \u00b7 ${escapeHtml(run.kind)}` : ''}</p>`);
  if (run.prUrl) body.push(`<p><button class="link" data-action="open-pr">${escapeHtml(run.prUrl)}</button></p>`);
  body.push('</header>');

  if (input.error) body.push(`<div class="notice bad" role="alert">${escapeHtml(input.error)}</div>`);
  if (input.notice) body.push(`<div class="notice ok">${escapeHtml(input.notice)}</div>`);

  if (input.loading) {
    body.push('<div class="notice">Reading the plan and the review brief\u2026</div>');
  } else if (run.status === 'awaiting_approval') {
    body.push('<div class="card"><strong>This run is waiting for approval</strong>');
    body.push(`<p class="muted">Approving starts ${escapeHtml(run.agent)} on ${escapeHtml(run.machineName)}.${run.notes ? ` Notes for it: ${escapeHtml(run.notes)}` : ''}</p>`);
    body.push(canDecide
      ? '<div class="actions"><button data-action="approve-run" class="primary">Approve run</button><button data-action="decline-run">Decline run</button></div>'
      : '<p class="muted">Only an owner or admin of the team can approve this run. You can still read it here.</p>');
    body.push('</div>');
    body.push(reviewHtml(run));
  } else if (planSealed || run.planEncrypted) {
    if (run.planStatus === 'approved') {
      body.push('<div class="notice ok"><strong>This plan was approved in a browser</strong><p>The machine encrypts end to end, so the plan and its approval stay with your team key. Open Patchkin to read it.</p><button data-action="open-browser">Open in Patchkin</button></div>');
    } else {
      body.push('<div class="notice warn"><strong>This plan is sealed for your team</strong><p>The machine encrypts end to end, so only a browser holding the team key can read it and sign the answer. Approve it in Patchkin.</p><button data-action="open-browser" class="primary">Open in Patchkin</button></div>');
    }
  } else if (plan !== null) {
    const planReady = run.planStatus === 'ready';
    body.push(planCheckHtml(run));
    body.push(questionsHtml(plan));
    body.push(`<div class="card"><strong>Plan</strong><pre>${escapeHtml(plan.trim() || '(The plan is empty.)')}</pre></div>`);
    if (!planReady) {
      body.push(run.planStatus === 'approved'
        ? '<div class="notice ok">This plan is approved. The agent is carrying it out.</div>'
        : '<div class="notice warn">This plan is not waiting for an answer now. The agent may be revising it.</div>');
    } else if (canDecide) {
      body.push('<div class="card"><label for="note">Answers or notes for the agent (optional, sent with the approval)</label>');
      body.push('<textarea id="note" maxlength="700" rows="2" placeholder="Answers to the open questions, or a short note."></textarea>');
      body.push('<label for="feedback" class="second-label">If you send it back: what should change?</label>');
      body.push('<textarea id="feedback" maxlength="1000" rows="2" placeholder="At least 3 characters. Sent to the agent as one line."></textarea>');
      body.push('<div class="actions"><button data-action="approve-plan" class="primary">Approve the plan</button><button data-action="revise-plan">Send back with these changes</button></div></div>');
    } else {
      body.push('<p class="muted">Only an owner or team admin can answer this plan, unless the project lets the person who asked decide.</p>');
    }
  } else {
    body.push('<div class="card"><strong>No plan is waiting for this run</strong><p class="muted">The agent has not written a plan, or this run is not plan-first.</p><div class="actions"><button data-action="refresh">Refresh</button><button data-action="open-browser">Open in Patchkin</button></div></div>');
  }

  body.push(briefHtml(run));
  if (run.error) body.push(`<div class="notice bad">${escapeHtml(run.error)}</div>`);
  body.push('<footer><button data-action="refresh">Refresh</button><button data-action="open-browser">Open in Patchkin</button></footer>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(cspSource)} 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';">
<title>Patchkin: ${escapeHtml(run.ticketKey)}</title>
<style>${PANEL_CSS}</style>
</head>
<body>
${body.join('\n')}
<script nonce="${escapeHtml(nonce)}">${PANEL_SCRIPT}</script>
</body>
</html>`;
}

const PANEL_CSS = `
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 20px 28px; line-height: 1.5; }
h1 { font-size: 1.25em; margin: 0 0 8px; font-weight: 600; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
.badge { display: inline-block; border: 1px solid var(--vscode-panel-border); border-radius: 999px; padding: 1px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.badge.ok { border-color: var(--vscode-testing-iconPassed, #3fb950); color: var(--vscode-testing-iconPassed, #3fb950); }
.badge.warn { border-color: var(--vscode-editorWarning-foreground, #d29922); color: var(--vscode-editorWarning-foreground, #d29922); }
.badge.bad { border-color: var(--vscode-editorError-foreground, #f85149); color: var(--vscode-editorError-foreground, #f85149); }
.badge.off { color: var(--vscode-descriptionForeground); }
.muted { color: var(--vscode-descriptionForeground); margin: 4px 0; }
.warn-text { color: var(--vscode-editorWarning-foreground, #d29922); margin: 4px 0; }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px 14px; margin: 12px 0; }
.card.ok { border-left: 3px solid var(--vscode-testing-iconPassed, #3fb950); }
.card.warn { border-left: 3px solid var(--vscode-editorWarning-foreground, #d29922); }
.notice { border-radius: 6px; padding: 12px 14px; margin: 12px 0; border: 1px solid var(--vscode-panel-border); }
.notice.bad { border-color: var(--vscode-editorError-foreground, #f85149); }
.notice.ok { border-left: 3px solid var(--vscode-testing-iconPassed, #3fb950); }
.notice.warn { border-left: 3px solid var(--vscode-editorWarning-foreground, #d29922); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px 12px; max-height: 48vh; overflow: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
label { display: block; margin-top: 10px; font-weight: 600; }
.second-label { margin-top: 14px; }
textarea { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 6px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; font-family: inherit; font-size: inherit; resize: vertical; }
textarea[aria-invalid="true"] { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground)); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; padding: 6px 12px; font-family: inherit; font-size: inherit; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible, textarea:focus-visible, a:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
button.link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); text-decoration: underline; text-align: left; }
button.link:hover:not(:disabled) { background: none; color: var(--vscode-textLink-activeForeground); }
ul { margin: 6px 0 0; padding-left: 20px; }
li { margin: 3px 0; }
a { color: var(--vscode-textLink-foreground); }
footer { margin-top: 20px; display: flex; gap: 8px; border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
`;

const PANEL_SCRIPT = `
const vscode = acquireVsCodeApi();
const send = (message) => vscode.postMessage(message);
document.querySelectorAll('button[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.getAttribute('data-action');
    if (action === 'revise-plan') {
      const field = document.getElementById('feedback');
      const feedback = field ? field.value.trim() : '';
      if (feedback.length < 3) {
        if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
        return;
      }
      send({ type: action, feedback });
    } else if (action === 'approve-plan') {
      const field = document.getElementById('note');
      send({ type: action, note: field ? field.value.trim() : '' });
    } else {
      send({ type: action });
    }
    document.querySelectorAll('button[data-action]').forEach((other) => { other.disabled = true; });
  });
});
`;


