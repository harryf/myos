---
name: myos
description: What myos is, how to run the Algorithm, and where the ISA and everything else lives. Use at the start of a session or when unsure where something is.
argument-hint: [optional task]
---

**myos** is Harry's own Claude Code setup: a standalone config dir at `~/.myos`, launched with the `myos` command (`~/.myos/bin/myos`, which sets `CLAUDE_CONFIG_DIR=~/.myos` and appends `MYOS/MYOS_SYSTEM_PROMPT.md`). Its source is the repo `~/Code/personal/myos`; `payload/` there mirrors `~/.myos` one to one, and `install.sh` copies it over. Edit shipped files in the repo, not in `~/.myos`.

Orient in this order, reading only what the task needs:

1. `~/.myos/CLAUDE.md`: Harry's operating rules and the routing table (always loaded already).
2. **The Algorithm** for any multi-step build, fix or investigation: read `~/.myos/MYOS/ALGORITHM/LATEST`, then the version file it names (`MYOS/ALGORITHM/v<version>.md`), and follow it. It states what must be true when a run is done; the ISA is its instrument.
3. **The ISA** (the one document that says what done is): `<project>/ISA.md` for anything with persistent identity, `~/.myos/MYOS/MEMORY/WORK/<slug>/ISA.md` for one shot tasks. Format: `~/.myos/MYOS/DOCUMENTATION/IsaFormat.md`. Write and check it through the ISA skill (`Skill("ISA")`: Scaffold, Interview, Grill, CheckCompleteness, Reconcile, Seed, Append).
4. **Open work:** `~/.myos/MYOS/USER/PROJECTS.md` (the short index, imported every session); long histories in `MYOS/USER/PROJECTS/<slug>.md`. To find older work, `/cs <topic>`.
5. **Skills:** `~/.myos/skills/<Name>/SKILL.md`, read at the moment a task matches, never preloaded. Agents: `Designer`, `Engineer`, `Max` (read only second look).
6. **Verification:** evidence from a tool for every claim (`MYOS/RULES/Verification.md`); browser evidence from Interceptor when its extension is connected, Claude-in-Chrome otherwise.

Confirm in one line: the myos version (`~/.myos/MYOS/VERSION`) and whether an ISA already exists for the current directory. If `~/.myos` does not exist, say so and point at `~/Code/personal/myos/install.sh`.

$ARGUMENTS
