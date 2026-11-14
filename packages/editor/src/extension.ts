import * as vscode from 'vscode';
import { SessionStore } from './auth';
import type { Session } from './auth';
import { HubClient, HubError } from './client';
import { pollSeconds, webUrlFor } from './config';
import { pairMachine } from './pairing';
import { RunPanel } from './panel';
import { attentionReason, canAnswer, hasAttention, needsYou, newlyWaiting } from './queue';
import { RunsTreeProvider } from './tree';
import type { RunTreeNode } from './tree';
import { RUN_AGENTS } from './types';
import type { Machine, Project, Run, Ticket } from './types';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

type QuickProject = vscode.QuickPickItem & { project: Project };
type QuickTicket = vscode.QuickPickItem & { ticket: Ticket };
type QuickMachine = vscode.QuickPickItem & { machine: Machine };

export function activate(context: vscode.ExtensionContext): void {
  const store = new SessionStore(context);
  let session: Session | undefined;
  let client: HubClient | undefined;
  let lastRuns: Run[] = [];
  let canDecide = false;
  let selfApproval: ReadonlySet<string> = new Set<string>();
  let seenWaiting: Set<string> | undefined;
  let seenAttention: Set<string> | undefined;
  let poller: NodeJS.Timeout | undefined;
  let refreshGeneration = 0;

  const waiting = new RunsTreeProvider('waiting');
  const allRuns = new RunsTreeProvider('runs');
  const waitingView = vscode.window.createTreeView('patchkin.waiting', { treeDataProvider: waiting, showCollapseAll: false });
  const runsView = vscode.window.createTreeView('patchkin.runs', { treeDataProvider: allRuns, showCollapseAll: true });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'patchkin.focusWaiting';

  const viewer = () => ({ id: session?.user.id ?? '', canDecide, selfApproval });
  const updateTrees = () => {
    waiting.update(lastRuns, viewer(), !!session);
    allRuns.update(lastRuns, viewer(), !!session);
  };
  const showError = (error: unknown) => void vscode.window.showErrorMessage(`Patchkin: ${messageOf(error)}`);

  async function openWeb(hubUrl?: string): Promise<void> {
    try { await vscode.env.openExternal(vscode.Uri.parse(webUrlFor(hubUrl || session?.hubUrl || store.hubUrl))); } catch (error) { showError(error); }
  }

  async function openRun(run: Run): Promise<void> {
    if (!session || !client) return;
    RunPanel.show({ client, session, canDecide: canAnswer(run, viewer()), onChanged: () => void refresh(false) }, run);
  }

  function resolveRun(arg: unknown): Run | undefined {
    if (!arg) return undefined;
    if (typeof arg === 'string') return lastRuns.find((run) => run.id === arg);
    if (typeof arg === 'object') {
      const node = arg as Partial<RunTreeNode> & Partial<Run>;
      if ('run' in node && node.run) return node.run;
      if ('id' in node && typeof node.id === 'string') return lastRuns.find((run) => run.id === node.id);
    }
    return undefined;
  }

  async function refresh(announce: boolean): Promise<void> {
    const generation = ++refreshGeneration;
    if (!session || !client) {
      lastRuns = [];
      updateTrees();
      status.text = '$(account) Patchkin';
      status.command = 'patchkin.signIn';
      status.tooltip = 'Sign in to Patchkin';
      status.show();
      return;
    }
    try {
      const hub = client;
      const [page, projects] = await Promise.all([
        hub.runs(session.team.id, { limit: 100 }),
        hub.projects(session.team.id).catch(() => []),
      ]);
      if (generation !== refreshGeneration) return;
      const runsNow = page.runs ?? [];
      canDecide = page.canDecide;
      selfApproval = new Set(projects.filter((project) => project.approval === 'self').map((project) => project.id));
      lastRuns = runsNow;
      const me = viewer();
      const waitingNow = runsNow.filter((run) => needsYou(run, me));
      const attentionNow = runsNow.filter((run) => hasAttention(run) && (me.canDecide || run.requestedBy === me.id));
      updateTrees();
      const count = waitingNow.length;
      status.command = 'patchkin.focusWaiting';
      status.text = count ? `$(bell) ${count} waiting` : '$(check) Patchkin';
      status.tooltip = `Patchkin: ${session.team.name}${count ? ` \u00b7 ${count} waiting for you` : ' \u00b7 nothing waiting'}`;
      status.show();
      if (seenWaiting && announce) {
        const notify = vscode.workspace.getConfiguration('patchkin').get<boolean>('notifications') !== false;
        if (notify) {
          await announceNew(newlyWaiting(seenWaiting, runsNow, me));
          await announceAttention(attentionNow.filter((run) => !seenAttention?.has(run.id)));
        }
      }
      if (generation !== refreshGeneration) return;
      seenWaiting = new Set(waitingNow.map((run) => run.id));
      seenAttention = new Set(attentionNow.map((run) => run.id));
    } catch (error) {
      if (generation !== refreshGeneration) return;
      if (error instanceof HubError && error.status === 401) {
        await signOut(true);
        void vscode.window.showWarningMessage('Patchkin: your session has ended. Sign in again to keep the queue up to date.', 'Sign in')
          .then((choice) => { if (choice === 'Sign in') void signIn(); });
        return;
      }
      status.text = '$(warning) Patchkin';
      status.tooltip = messageOf(error);
      status.command = 'patchkin.refresh';
      status.show();
    }
  }

  async function announceNew(added: Run[]): Promise<void> {
    if (!added.length || !session) return;
    const first = added[0];
    const isPlan = first.status === 'running';
    const text = added.length === 1
      ? `Patchkin: ${first.ticketKey} ${isPlan ? 'has a plan waiting for you' : 'is waiting for approval'}`
      : `Patchkin: ${added.length} runs are waiting for you`;
    const action = isPlan ? 'Read the plan' : 'Open the run';
    const choice = await vscode.window.showInformationMessage(text, action, 'Open in Patchkin');
    if (choice === 'Open in Patchkin') await openWeb(session.hubUrl);
    else if (choice === action) await openRun(first);
  }

  /** A run that failed, broke its pull request or has failing checks, told once when it starts needing attention. */
  async function announceAttention(added: Run[]): Promise<void> {
    if (!added.length) return;
    const first = added[0];
    const text = added.length === 1
      ? `Patchkin: ${first.ticketKey} ${attentionReason(first)}`
      : `Patchkin: ${added.length} runs need attention`;
    const choice = await vscode.window.showInformationMessage(text, 'Open the run', ...(first.prUrl ? ['Open pull request'] : []));
    if (choice === 'Open the run') await openRun(first);
    else if (choice === 'Open pull request' && first.prUrl) {
      try {
        const url = vscode.Uri.parse(first.prUrl);
        if (url.scheme === 'https' || url.scheme === 'http') await vscode.env.openExternal(url);
      } catch (error) {
        showError(error);
      }
    }
  }

  async function signIn(): Promise<void> {
    try {
      const next = await store.signIn();
      if (!next) return;
      session = next;
      client = new HubClient({ hubUrl: next.hubUrl, token: next.token });
      seenWaiting = undefined;
      seenAttention = undefined;
      await refresh(false);
      void vscode.window.showInformationMessage(`Patchkin: signed in to ${next.team.name}.`);
    } catch (error) {
      showError(error);
    }
  }

  async function signOut(quiet = false): Promise<void> {
    await store.signOut();
    session = undefined;
    client = undefined;
    lastRuns = [];
    canDecide = false;
    selfApproval = new Set<string>();
    seenWaiting = undefined;
    seenAttention = undefined;
    updateTrees();
    status.text = '$(account) Patchkin';
    status.command = 'patchkin.signIn';
    status.tooltip = 'Sign in to Patchkin';
    status.show();
    if (!quiet) void vscode.window.showInformationMessage('Patchkin: signed out.');
  }

  async function requireSession(): Promise<{ session: Session; client: HubClient } | undefined> {
    if (session && client) return { session, client };
    const choice = await vscode.window.showInformationMessage('Patchkin: sign in first.', 'Sign in');
    if (choice === 'Sign in') await signIn();
    return session && client ? { session, client } : undefined;
  }

  async function selectTeam(): Promise<void> {
    if (!session) {
      await requireSession();
      return;
    }
    const next = await store.selectTeam(session);
    if (!next) return;
    session = next;
    client = new HubClient({ hubUrl: next.hubUrl, token: next.token });
    lastRuns = [];
    seenWaiting = undefined;
    seenAttention = undefined;
    await refresh(false);
  }


  async function startRun(): Promise<void> {
    const ready = await requireSession();
    if (!ready) return;
    try {
      const projects = await ready.client.projects(ready.session.team.id);
      if (!projects.length) {
        void vscode.window.showInformationMessage('Patchkin: this team has no repositories yet. Add one on the web board first.');
        return;
      }
      const projectPick = await vscode.window.showQuickPick<QuickProject>(
        projects.map((project) => ({ label: project.name, description: project.repo, detail: `${project.openTickets} open ticket${project.openTickets === 1 ? '' : 's'}`, project })),
        { title: 'Patchkin: start a run from a ticket', placeHolder: 'Choose a repository', matchOnDescription: true, ignoreFocusOut: true },
      );
      if (!projectPick) return;

      const tickets = await ready.client.tickets(ready.session.team.id, projectPick.project.id, { limit: 100 });
      if (!tickets.length) {
        void vscode.window.showInformationMessage(`Patchkin: ${projectPick.project.name} has no open tickets.`);
        return;
      }
      const ticketPick = await vscode.window.showQuickPick<QuickTicket>(
        tickets.map((ticket) => ({ label: `${ticket.key} ${ticket.title}`, description: (ticket.labels ?? []).join(' '), detail: String(ticket.body ?? '').replace(/\s+/g, ' ').slice(0, 160), ticket })),
        { title: 'Patchkin: choose a ticket', matchOnDescription: true, matchOnDetail: true, ignoreFocusOut: true },
      );
      if (!ticketPick) return;

      const machines = (await ready.client.machines(ready.session.team.id)).filter((machine) => machine.canUse !== false);
      if (!machines.length) {
        void vscode.window.showErrorMessage('Patchkin: no machine of this team is available to you. Pair one with "Patchkin: Pair this machine".');
        return;
      }
      const machinePick = await vscode.window.showQuickPick<QuickMachine>(
        machines.map((machine) => {
          const installed = (machine.installedAgents ?? []).filter((agent) => (RUN_AGENTS as readonly string[]).includes(agent));
          return {
            label: machine.name,
            description: [machine.status, machine.platform, machine.e2e ? 'encrypted' : ''].filter(Boolean).join(' \u00b7 '),
            detail: `${installed.length} coding agent${installed.length === 1 ? '' : 's'} installed`,
            machine,
          };
        }),
        { title: 'Patchkin: run on which machine?', matchOnDescription: true, ignoreFocusOut: true },
      );
      if (!machinePick) return;

      const agents = (machinePick.machine.installedAgents ?? []).filter((agent) => (RUN_AGENTS as readonly string[]).includes(agent));
      if (!agents.length) {
        void vscode.window.showErrorMessage(`Patchkin: no coding agent is installed on ${machinePick.machine.name}. Install Claude Code, Codex or another agent there first.`);
        return;
      }
      const agent = agents.length === 1 ? agents[0] : await vscode.window.showQuickPick(agents, { title: 'Patchkin: which agent?', ignoreFocusOut: true });
      if (!agent) return;

      const notes = await vscode.window.showInputBox({ title: 'Patchkin: notes for the agent', prompt: 'Optional. What should it know?', ignoreFocusOut: true });
      if (notes === undefined) return;

      const created = await ready.client.createRun(ready.session.team.id, projectPick.project.id, ticketPick.ticket.id, {
        machineId: machinePick.machine.id,
        agent,
        notes: notes.trim(),
      });
      await refresh(false);
      const message = created.run.status === 'awaiting_approval'
        ? `${created.run.ticketKey} was requested. ${machinePick.machine.e2e ? 'Approve it in Patchkin with your team key.' : 'An owner or admin has to approve it.'}`
        : `${created.run.ticketKey} is running on ${machinePick.machine.name}.`;
      const choice = await vscode.window.showInformationMessage(`Patchkin: ${message}`, 'Open the run');
      if (choice === 'Open the run') await openRun(created.run);
    } catch (error) {
      showError(error);
    }
  }



  async function decideFromTree(arg: unknown, action: 'approve' | 'decline'): Promise<void> {
    const ready = await requireSession();
    if (!ready) return;
    const run = resolveRun(arg);
    if (!run) return;
    try {
      if (action === 'decline') {
        const choice = await vscode.window.showWarningMessage(`Decline the run for ${run.ticketKey}? The agent will not start.`, { modal: true }, 'Decline');
        if (choice !== 'Decline') return;
      }
      await ready.client.decideRun(ready.session.team.id, run.id, action);
      void vscode.window.showInformationMessage(`Patchkin: ${run.ticketKey} ${action === 'approve' ? 'approved' : 'declined'}.`);
      await refresh(false);
    } catch (error) {
      showError(error);
    }
  }

  async function pairThisMachine(): Promise<void> {
    const ready = await requireSession();
    if (!ready) return;
    try {
      await pairMachine(ready.client, ready.session);
    } catch (error) {
      showError(error);
    }
  }

  function schedulePoll(): void {
    if (poller) clearInterval(poller);
    const seconds = pollSeconds(vscode.workspace.getConfiguration('patchkin').get<number>('pollSeconds'));
    poller = setInterval(() => {
      if (session) void refresh(true);
    }, seconds * 1000);
  }

  const commands: Array<[string, (...args: unknown[]) => unknown]> = [
    ['patchkin.signIn', () => signIn()],
    ['patchkin.signOut', () => signOut()],
    ['patchkin.selectTeam', () => selectTeam()],
    ['patchkin.pairMachine', () => pairThisMachine()],
    ['patchkin.refresh', () => refresh(false)],
    ['patchkin.startRun', () => startRun()],
    ['patchkin.openRun', (arg) => { const run = resolveRun(arg); if (run) return openRun(run); }],
    ['patchkin.readPlan', (arg) => { const run = resolveRun(arg); if (run) return openRun(run); }],
    ['patchkin.approveRun', (arg) => decideFromTree(arg, 'approve')],
    ['patchkin.declineRun', (arg) => decideFromTree(arg, 'decline')],
    ['patchkin.openInPatchkin', () => openWeb()],
    ['patchkin.focusWaiting', () => vscode.commands.executeCommand('patchkin.waiting.focus')],
  ];
  for (const [id, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, (...args: unknown[]) => handler(...args)));
  }

  context.subscriptions.push(
    waitingView,
    runsView,
    status,
    { dispose: () => { if (poller) clearInterval(poller); } },
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('patchkin.pollSeconds')) schedulePoll();
    }),
  );

  updateTrees();
  status.text = '$(account) Patchkin';
  status.tooltip = 'Sign in to Patchkin';
  status.show();
  void (async () => {
    try {
      session = await store.restore();
    } catch (error) {
      void vscode.window.showWarningMessage(`Patchkin: could not reach the hub. ${messageOf(error)}`);
    }
    if (session) client = new HubClient({ hubUrl: session.hubUrl, token: session.token });
    updateTrees();
    if (session) await refresh(false);
    schedulePoll();
  })();
}
