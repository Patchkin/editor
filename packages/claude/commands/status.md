---
description: Report Patchkin run and pull-request status
argument-hint: [run id, ticket key, or nothing for the queue]
---

Report where Patchkin work stands.

- With no argument: call `patchkin_queue` first, then `patchkin_runs` with `status: "running"` so the person sees both what needs them and what is in flight.
- With a run id or ticket key: call `patchkin_runs` (or `patchkin_run` when you have the id) and report the run's status, machine, agent, branch, pull request state, checks, and the review brief.
- For a pull request, say plainly whether it is merged, closed, ready to merge, conflicting, has failing checks, or still open.
- This command only reads. Do not start, cancel, approve or send anything back unless the person asks for it.
