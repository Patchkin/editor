# Patchkin for VS Code and Cursor

The Patchkin sidebar puts the "waiting for you" queue, the runs and their pull requests where you already work.

## Install

- **VS Code**: install **Patchkin** from the VS Code Marketplace.
- **Cursor** and other Open VSX editors: install **Patchkin** from Open VSX.

Then run **Patchkin: Sign in** from the Command Palette. Enter your hub address (`https://blue.patchkin.io` unless your team self-hosts), your work email and password. If your account uses an authenticator app, the extension asks for the 6-digit code. Choose a team if you are in more than one. The password is never stored; the session token goes into VS Code's secret storage.

## What it does

- **Waiting for you** lists runs that need a person: a run waiting for approval and a plan waiting for your decision. The count is on the status bar too.
- **Runs** groups every run the way the web board does: waiting for approval, plan ready, running, needs attention, in review, recently finished.
- Each run shows a **pull-request badge** (ready to merge, conflicts, checks failing, checks running, merged, closed, open) and a tooltip with the machine, agent, branch and the review brief's headline.
- **Read the plan** opens a panel with the plan, the agent's open questions, the AI check against accepted decisions, the review brief, and two boxes: notes sent with an approval, and what should change if you send it back. **Approve the plan** and **Send back with these changes** call the same hub endpoints as the web board, so the decision is recorded in the activity log and the agent receives your words.
- For a run waiting for approval, the panel offers **Approve run** and **Decline run**.
- **Start a run from a ticket** picks a repository, an open ticket, a machine and one of the coding agents installed there, then asks the hub to start it. The team's approval rule still applies.
- **Pair this machine** gets a one-time code from the hub, opens a terminal with the same install command the web board shows, and tells you when the machine appears.
- A notification appears when a run starts waiting for you, and when a run you asked for starts needing attention (it failed, its pull request conflicts, or its checks fail); owners and admins hear about the team's runs too. "Read the plan" or "Open the run" goes straight to it.

## Commands

| Command | What it does |
|---|---|
| `Patchkin: Sign in` / `Sign out` | Start or end the session in this editor |
| `Patchkin: Select team` | Switch between teams |
| `Patchkin: Pair this machine` | Pair a Mac, Linux or Windows machine |
| `Patchkin: Start a run from a ticket` | Pick a ticket and a machine and ask for a run |
| `Patchkin: Refresh` | Refresh the queue and runs now |
| `Patchkin: Read the plan` | Open the plan/run panel for the selected run |
| `Patchkin: Approve the run` / `Decline the run` | Answer a run waiting for approval |
| `Patchkin: Open in Patchkin` | Open the web board |

Right-click a run in the sidebar for the same actions.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `patchkin.hubUrl` | `https://blue.patchkin.io` | Your hub address, suggested when you sign in. `http://` is accepted only for a hub on this machine. |
| `patchkin.pollSeconds` | `60` | How often the queue refreshes, never faster than 15 seconds. |
| `patchkin.notifications` | `true` | Show a VS Code notification when a run starts waiting for you. |

## Limitations

- A plan from an **end-to-end encrypted machine** is sealed for the team key. This extension cannot open or sign it; the panel says so and links to the web board, where a browser holding the team key can decide.
- **Pairing an encrypted machine** needs the team key added to the install command, which the web board does. Pair those machines from Machines → Pair on the web board; this command pairs ordinary machines.
- **Starting an approved run on an encrypted machine** also needs the team key in a browser; the extension can request the run and read its status, but the decision is signed on the web board.
- **SSO-only organizations** sign in on the web board; this extension uses email and password (or an authenticator code). Use the web board if your organization requires SAML single sign-on.
- Sessions last 7 days. When the hub refuses the token, the extension asks you to sign in again.
- A Claude Code conversation that Patchkin did not start cannot submit a plan from here; the Claude Code plugin and the daemon cover that flow.

## Development

```bash
npm install
npm --workspace=packages/editor run build
code --extensionDevelopmentPath="$PWD/packages/editor"
```

Run the unit tests with `npm --workspace=packages/editor test`; the pure rules (queue, badges, plan panel escaping, hub client) are covered without an editor host.

To make a VSIX: `npm --workspace=packages/editor run package:vsix`. The release workflow packages it on every change and publishes to the VS Code Marketplace and Open VSX on an `extension-v*` tag, using the `VSCE_PAT` and `OVSX_PAT` repository secrets.
