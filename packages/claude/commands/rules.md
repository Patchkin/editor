---
description: Show the team rules and Context bank Patchkin keeps in sync
---

Call `patchkin_team_rules` and explain what it returns.

- Group the standards by kind (rule, command, skill) and name each one with its title and version.
- Say that the daemon on each paired machine writes them where the tools read them: Claude Code gets the marked block in `~/.claude/CLAUDE.md`, commands in `~/.claude/commands/<name>.md`, and skills in `~/.claude/skills/<name>/SKILL.md`.
- Point out the standard generated from the team's Context bank when it is there.
- Explain that the web board is the source of truth: changing a standard there reaches the machines through the daemon. This command only reads.
