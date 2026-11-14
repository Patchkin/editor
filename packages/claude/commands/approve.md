---
description: Approve or send back a Patchkin plan
argument-hint: [run id or ticket key]
---

Help the person answer a plan that is waiting for them in Patchkin.

1. If `$ARGUMENTS` names a run id, use it. Otherwise call `patchkin_queue` and ask which run they mean when more than one is waiting.
2. Call `patchkin_run` with the run id and show the plan, the open questions, the AI check against accepted decisions, and the review brief if there is one.
3. Ask the person what to do. Never decide on your own:
   - **Approve**: ask whether they want a note or answers to the open questions, then call `patchkin_decide_plan` with `action: "approve"` and that note.
   - **Send back**: ask what should change, then call `patchkin_decide_plan` with `action: "revise"` and their words as `feedback` (at least 3 characters).
4. If the tool says the plan conflicts with an accepted decision, show the conflict and ask again. Call it with `acknowledge: true` only after the person says to approve it anyway.
5. Repeat the result: the plan was approved (the agent carries on) or sent back, and that the activity log recorded it.

A plan from an end-to-end encrypted machine cannot be read here. Say so and point the person to the Patchkin web board; do not try to approve it.
