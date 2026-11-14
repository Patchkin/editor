import * as vscode from 'vscode';
import type { Session } from './auth';
import { HubClient, pairInstallCommand } from './client';

/**
 * Pairing from the editor: the hub issues the one-time code, and the same install command the web board shows runs in
 * a terminal here. The daemon downloads, pairs and starts at sign-in; the extension watches for the new machine.
 */
export async function pairMachine(client: HubClient, session: Session): Promise<void> {
  const pairing = await client.createPairing(session.team.id);
  const command = pairInstallCommand(session.hubUrl, pairing.code, process.platform);
  const terminal = vscode.window.createTerminal(process.platform === 'win32'
    ? { name: `Patchkin pairing ${pairing.code}`, shellPath: 'powershell.exe' }
    : { name: `Patchkin pairing ${pairing.code}` });
  terminal.show();
  terminal.sendText(command, true);
  const minutes = Math.max(1, Math.round((pairing.expiresInSeconds || 900) / 60));
  void vscode.window
    .showInformationMessage(`Pairing code ${pairing.code} is running in the terminal. It expires in ${minutes} minutes.`, 'Copy code')
    .then((choice) => {
      if (choice === 'Copy code') void vscode.env.clipboard.writeText(pairing.code);
    });

  const before = new Set((await client.machines(session.team.id).catch(() => [])).map((machine) => machine.id));
  const deadline = Date.now() + 5 * 60_000;
  const check = async (): Promise<void> => {
    if (Date.now() > deadline) return;
    try {
      const machines = await client.machines(session.team.id);
      const added = machines.find((machine) => !before.has(machine.id));
      if (added) {
        const choice = await vscode.window.showInformationMessage(`Patchkin: ${added.name} is paired to ${session.team.name}.`, 'Refresh');
        if (choice === 'Refresh') void vscode.commands.executeCommand('patchkin.refresh');
        return;
      }
    } catch {
      // The hub may be briefly busy while the daemon pairs; keep watching until the code expires.
    }
    setTimeout(() => void check(), 5000);
  };
  setTimeout(() => void check(), 5000);
}
