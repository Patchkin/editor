---
description: Start a Patchkin run from a ticket
argument-hint: [ticket key or what to work on]
---

Start a run in Patchkin from a ticket, without leaving Claude Code.

1. Call `patchkin_projects` to show the repositories. If `$ARGUMENTS` names a ticket, use it to choose; otherwise ask the person which repository and ticket.
2. Call `patchkin_tickets` with the chosen repository, then show the open tickets and ask which one. Read the chosen one with `patchkin_ticket` so the description is in front of the person before the run starts.
3. Call `patchkin_machines`, show the machines that are online and available, and ask which one (and which agent, unless the machine has only one).
4. Ask for optional notes for the agent, then call `patchkin_start_run` with `project`, `ticket`, `machine`, `agent` and `notes`.
5. Report the run id and status. If it is waiting for approval, say that an owner or admin must approve it; if it started, say that a plan-first project will bring the plan back for a person to answer.
