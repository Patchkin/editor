# Patchkin for Claude Code

An MCP server and Claude Code plugin for the Patchkin board: pull tickets, start plan-first runs, read plans, approve or send them back, and report run status without leaving the terminal.

The server has no dependencies and needs Node 18 or newer. It talks to the same hub endpoints as the web board with a person's own token; the hub decides what that person may see and approve.

## Sign in

The server finds the hub and token in `PATCHKIN_TOKEN` / `PATCHKIN_HUB_URL` / `PATCHKIN_TEAM_ID`, or in `~/.patchkin/config.json`, which this command writes with mode `0600`:

```bash
npm --workspace=packages/claude run login
# or, once the package is published:
npx patchkin-mcp-login
```

It asks for the hub, email, password (not echoed) and, for an account with two-factor sign-in, the 6-digit code. It saves the session token and your team; the password is never written anywhere and the token is never printed. Sessions last 7 days, so run the login again when the hub says it has expired.

`PATCHKIN_CONFIG` points at a different config file. If a token file can be read by other users, the server warns about it but does not silently treat it as fine.

## Install the plugin

From this repository (build nothing; the plugin runs the source directly):

```bash
claude plugin marketplace add <path-to>/patchkin
claude plugin install patchkin@patchkin
```

Or, in a Claude Code session:

```text
/plugin marketplace add <path-to>/patchkin
/plugin install patchkin@patchkin
```

Then `/patchkin:queue`, `/patchkin:approve`, `/patchkin:start`, `/patchkin:status` and `/patchkin:rules` are available. The plugin declares the MCP server in `.claude-plugin/plugin.json`, so installing it connects the tools too.

## Tools

| Tool | What it does |
|---|---|
| `patchkin_queue` | What is waiting for you: runs waiting for approval and plans waiting for a decision |
| `patchkin_runs` | Runs by status (`needsMe`, `running`, `prOpen`, `checksFailing`, `conflicts`, `readyToMerge`, `merged`, `failed`, ...) |
| `patchkin_run` | One run in full: plan, open questions, AI check, review brief, pull request |
| `patchkin_tickets` | Open tickets in a repository (or the repository list) |
| `patchkin_ticket` | One ticket in full, including its description |
| `patchkin_projects` | The repositories in a team |
| `patchkin_machines` | Paired machines, their agents and whether they are online or encrypted |
| `patchkin_start_run` | Ask Patchkin to start a run for a ticket on a machine |
| `patchkin_decide_plan` | Approve a plan with a note, or send it back with what should change |
| `patchkin_teams` | Who you are signed in as, and your teams |
| `patchkin_team_rules` | The rules, commands and skills Patchkin keeps in sync, including the Context bank standard |

Mutating tools are explicit: `patchkin_start_run` creates a request (the hub still applies the team's approval rule and plan-first setting), and `patchkin_decide_plan` answers a waiting plan. Both are recorded in the activity log.

### Plans and the daemon

Patchkin's plan loop belongs to the daemon on the machine: when a plan-first run's agent writes its plan, the daemon sends it to the hub, and the hub checks it against accepted decisions. The plugin reads that plan and can answer it. A Claude Code session that Patchkin did not start cannot submit a plan through this server yet; that would need a new hub endpoint and decision channel.

### Encrypted machines

A plan from an end-to-end encrypted machine is sealed for the team key. The server says so and points at the web board; it cannot read or approve that plan. Starting a run on such a machine also waits for a browser holding the team key.

### Sign-in kinds

The login command uses email and password (with an authenticator code when the account has two-factor sign-in). An organization that requires SAML single sign-on signs in on the web board; its people can still use the MCP server by setting `PATCHKIN_TOKEN` to a session token obtained there.

## Team rules and the Context bank

The daemon keeps each machine in sync with the standards the web board owns. For Claude Code it writes:

- the marked block in `~/.claude/CLAUDE.md` (rules),
- `~/.claude/commands/<name>.md` (commands),
- `~/.claude/skills/<name>/SKILL.md` (skills),

and it removes them when a standard is withdrawn. `patchkin_team_rules` shows what is set; it does not change anything.

## Configuration

| Variable | Meaning |
|---|---|
| `PATCHKIN_HUB_URL` | Hub address (default `https://blue.patchkin.io`) |
| `PATCHKIN_TOKEN` | Session token; overrides the saved file |
| `PATCHKIN_TEAM_ID` | Team id; overrides the saved team |
| `PATCHKIN_CONFIG` | Config file path (default `~/.patchkin/config.json`) |

## Development

```bash
npm --workspace=packages/claude test   # node --test, no build step and no dependencies
npm --workspace=packages/claude start  # run the MCP server on stdio
```

The tests cover the config precedence and file permissions, the hub request shapes, every tool's output, the JSON-RPC handler and transport, and a spawned server against a stub hub.
