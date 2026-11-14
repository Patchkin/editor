# Patchkin editor clients

Two small clients for [Patchkin](https://patchkin.io), the control plane for autonomous coding agents. They talk to your Patchkin hub over its normal API and use your own sign-in.

| Folder | What it is |
|---|---|
| [`packages/editor`](packages/editor) | The VS Code and Cursor extension: a "Waiting for you" queue, run status, plan approvals, review briefs and starting a run from a ticket. |
| [`packages/claude`](packages/claude) | The Claude Code plugin: an MCP server and slash commands to pull tickets, start plan-first runs, review plans and report run status. |

This repository holds only these two clients. The Patchkin hub, web app and daemon are not here. It is published from Patchkin's own repository, so changes are made there and copied over; issues and pull requests are welcome here.

## Develop

```bash
npm install
npm --workspace=packages/editor run typecheck
npm --workspace=packages/editor test
npm --workspace=packages/claude test
```

Licensed under the [Apache License 2.0](LICENSE).
