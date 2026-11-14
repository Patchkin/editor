import * as vscode from 'vscode';
import type { Session } from './auth';
import { HubClient, HubError } from './client';
import { webUrlFor } from './config';
import { renderPlanPanel } from './planHtml';
import type { PlanDecisionInput } from './client';
import type { Run } from './types';

export interface RunPanelDeps {
  client: HubClient;
  session: Session;
  canDecide: boolean;
  /** Called after a decision so the sidebar and status bar can refresh. */
  onChanged: () => void;
}

interface PanelMessage {
  type?: string;
  note?: string;
  feedback?: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

/** One plan/run panel at a time, reused when another run is opened, the way the web board keeps one sheet. */
export class RunPanel {
  private static current: RunPanel | undefined;

  private planText: string | null = null;
  private sealed = false;
  private error = '';
  private notice = '';
  private loading = true;
  private busy = false;
  private generation = 0;
  private readonly nonce = randomNonce();

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private deps: RunPanelDeps,
    private run: Run,
  ) {
    panel.onDidDispose(() => {
      if (RunPanel.current === this) RunPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage((message: PanelMessage) => {
      void this.onMessage(message).catch((error) => {
        this.error = messageOf(error);
        this.render();
      });
    });
    void this.load();
  }

  static show(deps: RunPanelDeps, run: Run): RunPanel {
    if (RunPanel.current) {
      RunPanel.current.update(deps, run);
      RunPanel.current.panel.reveal(undefined, false);
      return RunPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'patchkin.run',
      `Patchkin: ${run.ticketKey}`,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    RunPanel.current = new RunPanel(panel, deps, run);
    return RunPanel.current;
  }

  private update(deps: RunPanelDeps, run: Run): void {
    this.deps = deps;
    this.run = run;
    this.panel.title = `Patchkin: ${run.ticketKey}`;
    this.planText = null;
    this.sealed = false;
    this.error = '';
    this.notice = '';
    void this.load();
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    this.render();
    try {
      const detail = await this.deps.client.run(this.deps.session.team.id, this.run.id);
      if (generation !== this.generation) return;
      this.run = detail.run;
      this.sealed = !!detail.planSealed || detail.run.planEncrypted;
      this.planText = detail.planSealed ? null : detail.plan;
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = messageOf(error);
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.render();
      }
    }
  }

  private render(): void {
    this.panel.webview.html = renderPlanPanel({
      run: this.run,
      plan: this.planText,
      planSealed: this.sealed,
      canDecide: this.deps.canDecide,
      cspSource: this.panel.webview.cspSource,
      nonce: this.nonce,
      error: this.error || undefined,
      notice: this.notice || undefined,
      loading: this.loading,
    });
  }

  private async onMessage(message: PanelMessage): Promise<void> {
    if (!message || this.busy) return;
    switch (message.type) {
      case 'refresh':
        this.error = '';
        this.notice = '';
        await this.load();
        return;
      case 'open-browser':
        await this.open(webUrlFor(this.deps.session.hubUrl));
        return;
      case 'open-pr':
        if (this.run.prUrl) await this.open(this.run.prUrl);
        return;
      case 'approve-plan':
        await this.decidePlan('approve', { note: oneLine(message.note, 700) }, false);
        return;
      case 'revise-plan':
        await this.decidePlan('revise', { feedback: clean(message.feedback, 1000) }, false);
        return;
      case 'approve-run':
        await this.decideRun('approve');
        return;
      case 'decline-run':
        await this.decideRun('decline');
        return;
    }
  }

  private async decidePlan(action: 'approve' | 'revise', input: PlanDecisionInput, acknowledged: boolean): Promise<void> {
    if (action === 'revise' && (input.feedback ?? '').trim().length < 3) {
      this.error = 'Say what to change (at least 3 characters), then send it back.';
      this.render();
      return;
    }
    this.busy = true;
    this.error = '';
    this.notice = '';
    this.render();
    try {
      await this.deps.client.decidePlan(this.deps.session.team.id, this.run.id, action, input);
      this.notice = action === 'approve' ? 'Plan approved. The agent carries on.' : 'Sent back to the agent with your changes.';
      this.deps.onChanged();
      await this.load();
    } catch (error) {
      if (error instanceof HubError && error.code === 'adr_conflict' && action === 'approve' && !acknowledged) {
        this.busy = false;
        const choice = await vscode.window.showWarningMessage(error.message, { modal: true }, 'Approve anyway');
        if (choice === 'Approve anyway') {
          await this.decidePlan('approve', input, true);
          return;
        }
        this.render();
        return;
      }
      this.error = messageOf(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async decideRun(action: 'approve' | 'decline'): Promise<void> {
    if (action === 'decline') {
      const choice = await vscode.window.showWarningMessage(
        `Decline the run for ${this.run.ticketKey}? The agent will not start.`,
        { modal: true },
        'Decline',
      );
      if (choice !== 'Decline') return;
    }
    this.busy = true;
    this.error = '';
    this.notice = '';
    this.render();
    try {
      await this.deps.client.decideRun(this.deps.session.team.id, this.run.id, action);
      this.notice = action === 'approve' ? 'Run approved. The agent is starting.' : 'Run declined.';
      this.deps.onChanged();
      await this.load();
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async open(url: string | null | undefined): Promise<void> {
    if (!url) return;
    try {
      const parsed = vscode.Uri.parse(url);
      if (parsed.scheme !== 'https' && parsed.scheme !== 'http') throw new Error('Only web addresses can be opened');
      await vscode.env.openExternal(parsed);
    } catch {
      this.error = `Could not open ${url}`;
      this.render();
    }
  }
}

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const oneLine = (value: unknown, max: number) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

function randomNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

