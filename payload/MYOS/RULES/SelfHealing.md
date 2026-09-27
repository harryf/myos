---
version: 1.0.0
---

# Where a rule lives

Provenance: adapted from LifeOS RULES/SelfHealing.md v1.1.5.

When the system fails (a rule missed, a behaviour recurred) fix the system, not a note. Put the rule where it structurally lives, and every later session starts with it in effect.

"The system failed" and "I failed" are different diagnoses, and only the first takes a patch. When the rule was already written, already loaded and simply not followed, the fix is nothing: read it and do not repeat the lapse. A new gate that catches me obeying doctrine I already hold is the wrong move.

| What is being encoded | Where it goes |
|---|---|
| Operational preference (tool choice, repo convention, naming) | `CLAUDE.md` operational rules |
| A checkable property of an artifact, or a gate on an irreversible act | `hooks/*.hook.ts`, and only these two classes |
| Permissions (allowed and denied tools, paths, hosts) | `settings.json` `permissions` |
| Domain behaviour (how to do one class of work) | the skill's `SKILL.md` and `Workflows/` |
| Algorithm doctrine (the loop, claims, gates) | `MYOS/ALGORITHM/v<version>.md` |
| Identity, open projects, conventions | `MYOS/USER/` (`PROJECTS.md`, `PROJECTS/<slug>.md`, `CONVENTIONS.md`) |
| Per task record (claims, decisions, evidence) | the ISA: `<project>/ISA.md` or `MYOS/MEMORY/WORK/<slug>/ISA.md` |
| Reusable knowledge (people, services, research notes) | `MYOS/MEMORY/KNOWLEDGE/` |

A hook must not encode how I work (which tool I reach for, which language, which style). The test: would a smarter model make this hook pointless? If yes, the rule belongs in doctrine and the lapse belongs nowhere.

Claude Code auto memory is off in myos. A preference or behaviour rule never goes into a memo; it goes into the table above. A fact about the world goes into `MYOS/MEMORY/KNOWLEDGE/`.

## Four kinds of HOW that stay

Instructions state the ideal state, not a procedure. Four kinds of procedural text survive that cut, because a smarter model still needs them:

| Kind | What it is |
|---|---|
| Safety gates | confirmations, destructive operation guards, approvals |
| Verified gotchas | a documented, non obvious failure with a dated incident, test or reproduction |
| Tool contracts | exact CLI syntax, API parameters, paths, deterministic recipes |
| Output format contracts | the required shape of the deliverable |

Full reasoning: `MYOS/RULES/Prompting.md`.
