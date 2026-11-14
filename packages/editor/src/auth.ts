import * as vscode from 'vscode';
import { HubClient, HubError } from './client';
import { DEFAULT_HUB_URL, normalizeHubUrl } from './config';
import type { Team, User } from './types';

const TOKEN_KEY = 'patchkin.token';
const HUB_KEY = 'patchkin.hubUrl';
const EMAIL_KEY = 'patchkin.email';
const TEAM_KEY = 'patchkin.teamId';

export interface Session {
  hubUrl: string;
  token: string;
  user: User;
  teams: Team[];
  team: Team;
}

/** Who is signed in, which team they are looking at, and the token; the token lives in VS Code's secret storage. */
export class SessionStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get hubUrl(): string {
    const configured = vscode.workspace.getConfiguration('patchkin').get<string>('hubUrl') || DEFAULT_HUB_URL;
    return normalizeHubUrl(this.context.globalState.get<string>(HUB_KEY) || configured);
  }

  get email(): string {
    return this.context.globalState.get<string>(EMAIL_KEY) || '';
  }

  get teamId(): string {
    return this.context.globalState.get<string>(TEAM_KEY) || '';
  }

  /** The saved session, checked against the hub. A token the hub no longer accepts is forgotten. */
  async restore(): Promise<Session | undefined> {
    const token = await this.context.secrets.get(TOKEN_KEY);
    if (!token) return undefined;
    const hubUrl = this.hubUrl;
    try {
      const me = await new HubClient({ hubUrl, token }).me();
      const teams = me.teams ?? [];
      const team = this.pickSavedTeam(teams) ?? teams[0];
      if (!team) {
        await this.signOut();
        return undefined;
      }
      if (team.id !== this.teamId) await this.context.globalState.update(TEAM_KEY, team.id);
      return { hubUrl, token, user: me.user, teams, team };
    } catch (error) {
      if (error instanceof HubError && error.status === 401) {
        await this.signOut();
        return undefined;
      }
      throw error;
    }
  }

  private pickSavedTeam(teams: Team[]): Team | undefined {
    return teams.find((team) => team.id === this.teamId) ?? (teams.length === 1 ? teams[0] : undefined);
  }

  /** Ask for the hub, email and password once, then keep only the session token. */
  async signIn(): Promise<Session | undefined> {
    const configured = vscode.workspace.getConfiguration('patchkin').get<string>('hubUrl') || DEFAULT_HUB_URL;
    const currentHub = this.context.globalState.get<string>(HUB_KEY) || configured;
    const enteredHub = await vscode.window.showInputBox({
      title: 'Patchkin: sign in',
      prompt: 'Hub address',
      value: currentHub,
      ignoreFocusOut: true,
      validateInput: (value) => {
        try { normalizeHubUrl(value); return undefined; } catch (error) { return (error as Error).message; }
      },
    });
    if (enteredHub === undefined) return undefined;
    const hubUrl = normalizeHubUrl(enteredHub);

    const enteredEmail = await vscode.window.showInputBox({
      title: 'Patchkin: sign in',
      prompt: 'Work email',
      value: this.email || undefined,
      ignoreFocusOut: true,
      validateInput: (value) => (/^\S+@\S+\.\S+$/.test(value.trim()) ? undefined : 'Enter a valid email'),
    });
    if (enteredEmail === undefined) return undefined;

    const password = await vscode.window.showInputBox({
      title: 'Patchkin: sign in',
      prompt: 'Password',
      password: true,
      ignoreFocusOut: true,
    });
    if (password === undefined) return undefined;

    const client = new HubClient({ hubUrl });
    let result = await client.signIn({ email: enteredEmail.trim(), password });
    if (!result.ok && result.mfaRequired) {
      const code = await vscode.window.showInputBox({
        title: 'Patchkin: sign in',
        prompt: '6-digit code from your authenticator app',
        ignoreFocusOut: true,
        validateInput: (value) => (/^\d{6}$/.test(value.trim()) ? undefined : 'Enter the 6-digit code'),
      });
      if (code === undefined) return undefined;
      result = await client.signIn({ email: enteredEmail.trim(), password, code: code.trim() });
    }
    if (!result.ok) throw new Error(result.error);

    const chosen = await this.chooseTeam(result.token, result.user, result.teams, hubUrl);
    if (!chosen) return undefined;
    await this.context.secrets.store(TOKEN_KEY, result.token);
    await this.context.globalState.update(HUB_KEY, hubUrl);
    await this.context.globalState.update(EMAIL_KEY, enteredEmail.trim());
    return chosen;
  }

  private async chooseTeam(token: string, user: User, teams: Team[], hubUrl: string): Promise<Session | undefined> {
    let team = this.pickSavedTeam(teams);
    if (!team && teams.length > 1) {
      const picked = await vscode.window.showQuickPick(
        teams.map((candidate) => ({ label: candidate.name, description: candidate.id, team: candidate })),
        { title: 'Patchkin: choose a team', ignoreFocusOut: true },
      );
      if (!picked) {
        await this.signOut();
        return undefined;
      }
      team = picked.team;
    }
    if (!team) throw new Error('This account is not in a team yet.');
    await this.context.globalState.update(TEAM_KEY, team.id);
    return { hubUrl, token, user, teams, team };
  }

  async selectTeam(session: Session): Promise<Session | undefined> {
    if (session.teams.length < 2) {
      void vscode.window.showInformationMessage(`You are in one team: ${session.team.name}.`);
      return session;
    }
    const picked = await vscode.window.showQuickPick(
      session.teams.map((candidate) => ({ label: candidate.name, description: candidate.id, team: candidate })),
      { title: 'Patchkin: choose a team', ignoreFocusOut: true },
    );
    if (!picked) return undefined;
    await this.context.globalState.update(TEAM_KEY, picked.team.id);
    return { ...session, team: picked.team };
  }

  async signOut(): Promise<void> {
    await this.context.secrets.delete(TOKEN_KEY);
    await this.context.globalState.update(TEAM_KEY, '');
  }
}
