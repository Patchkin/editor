import * as vscode from 'vscode';
import { briefHeadline, driftFlag, groupRuns, hasAttention, needsYou, prBadge, statusLabel } from './queue';
import type { Badge, RunGroup, Viewer } from './queue';
import type { Run } from './types';

export type RunTreeNode =
  | { kind: 'run'; run: Run }
  | { kind: 'group'; group: RunGroup }
  | { kind: 'empty'; label: string; command?: string };

function iconFor(run: Run): vscode.ThemeIcon {
  if (run.status === 'awaiting_approval' || (run.status === 'running' && run.planFirst && run.planStatus === 'ready')) return new vscode.ThemeIcon('bell', new vscode.ThemeColor('charts.yellow'));
  if (run.status === 'running') return new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.blue'));
  if (hasAttention(run)) return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
  if (run.prState === 'merged') return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.green'));
  if (run.prUrl && run.prState === 'open') return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.blue'));
  if (run.status === 'finished') return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
  return new vscode.ThemeIcon('circle-outline');
}

function contextValue(run: Run): string {
  if (run.status === 'awaiting_approval') return 'run:awaiting';
  if (run.status === 'running' && run.planFirst && run.planStatus === 'ready') return 'run:plan';
  return 'run:other';
}

function tooltip(run: Run): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown('**');
  md.appendText(run.ticketKey);
  md.appendMarkdown('** ');
  md.appendText(run.ticketTitle);
  md.appendMarkdown('\n\n');
  const facts = [
    statusLabel(run),
    `${run.machineName} \u00b7 ${run.agent}`,
    run.branch ? `Branch ${run.branch}` : '',
    run.prUrl || '',
    run.planError ? `Plan check: ${run.planError}` : '',
    run.error ? `Error: ${run.error}` : '',
  ].filter(Boolean);
  for (const fact of facts) {
    md.appendMarkdown('- ');
    md.appendText(fact);
    md.appendMarkdown('\n');
  }
  const pr = prBadge(run);
  const drift = driftFlag(run.brief);
  const headline = briefHeadline(run.brief);
  for (const badge of [pr, drift, headline].filter(Boolean) as Badge[]) {
    md.appendMarkdown('\n**');
    md.appendText(badge.text);
    md.appendMarkdown('**');
  }
  if (run.notes) {
    md.appendMarkdown('\n\nNotes: ');
    md.appendText(run.notes);
  }
  return md;
}

/** One provider per view: the flat "Waiting for you" queue, or every run grouped by where it stands. */
export class RunsTreeProvider implements vscode.TreeDataProvider<RunTreeNode> {
  private readonly emitter = new vscode.EventEmitter<RunTreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private runs: Run[] = [];
  private me: Viewer = { id: '', canDecide: false };
  private signedIn = false;

  constructor(private readonly mode: 'waiting' | 'runs') {}

  update(runs: Run[], me: Viewer, signedIn: boolean): void {
    this.runs = runs;
    this.me = me;
    this.signedIn = signedIn;
    this.emitter.fire(undefined);
  }

  findRun(id: string): Run | undefined {
    return this.runs.find((run) => run.id === id);
  }

  getChildren(element?: RunTreeNode): RunTreeNode[] {
    if (!element) {
      if (!this.signedIn) return [{ kind: 'empty', label: 'Sign in to Patchkin', command: 'patchkin.signIn' }];
      if (this.mode === 'waiting') {
        const waiting = this.runs.filter((run) => needsYou(run, this.me)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return waiting.length ? waiting.map((run) => ({ kind: 'run', run })) : [{ kind: 'empty', label: 'Nothing is waiting for you', command: 'patchkin.refresh' }];
      }
      const groups = groupRuns(this.runs);
      return groups.length ? groups.map((group) => ({ kind: 'group', group })) : [{ kind: 'empty', label: 'No runs yet', command: 'patchkin.refresh' }];
    }
    if (element.kind === 'group') return element.group.runs.map((run) => ({ kind: 'run', run }));
    return [];
  }

  getTreeItem(node: RunTreeNode): vscode.TreeItem {
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      item.contextValue = 'empty';
      if (node.command) item.command = { command: node.command, title: node.label };
      return item;
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(`${node.group.label} (${node.group.runs.length})`, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${this.mode}:${node.group.key}`;
      item.contextValue = 'group';
      item.iconPath = new vscode.ThemeIcon(node.group.key === 'attention' ? 'warning' : node.group.key === 'plan' || node.group.key === 'approval' ? 'bell' : 'list-unordered');
      return item;
    }
    const run = node.run;
    const item = new vscode.TreeItem(`${run.ticketKey} ${run.ticketTitle}`, vscode.TreeItemCollapsibleState.None);
    const pr = prBadge(run);
    item.id = `run:${this.mode}:${run.id}`;
    item.description = [statusLabel(run), pr?.text].filter(Boolean).join(' \u00b7 ');
    item.tooltip = tooltip(run);
    item.iconPath = iconFor(run);
    item.contextValue = contextValue(run);
    item.command = { command: 'patchkin.readPlan', title: 'Read the plan', arguments: [run] };
    return item;
  }
}
