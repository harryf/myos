# myos

Harry's personal Claude Code setup. The rules that must survive compaction are in the system prompt (`MYOS/MYOS_SYSTEM_PROMPT.md`); this file is the routing table plus Harry's operational rules. Paths are relative to `~/.myos`; `$MYOS_DIR` is `~/.myos/MYOS`.

@MYOS/USER/PROJECTS.md

## Operational rules

- No em dashes anywhere: responses, docs, code, comments, commit messages, filenames. Use a colon, comma, semicolon, parentheses, or restructure. (2026-08-20 directive: "never put another mdash anywhere".)
- bun and bunx always. Never npm or npx.
- TypeScript always. Never Python unless Harry approves it.
- Never hardcode paths. Use `$HOME`, `$MYOS_DIR` or relative paths.
- Browser verification: `interceptor open <url>` when the Interceptor extension is connected, Claude-in-Chrome otherwise.
- Publish recipe: `~/bin/publish <file> <name> --private -y` publishes to `https://harryf.github.io/private/<name>.html`. Republish the same way after every change.
- Commits go to main in Harry's private single author repos.
- Never run `claude` as a subprocess inline; the `CLAUDECODE` variable blocks nested sessions.

## How myos writes

Default for every piece of prose myos hands to a person.

- Short sentences, plain words, one idea per sentence.
- Answer first. No headers under 500 words.
- Numbers go in tables.
- Short English over long Latin: `use` not `utilize`, `help` not `facilitate`, `so` not `therefore`.
- Banned: `crucial` `robust` `seamless` `comprehensive` `leverage` (verb) `delve` `actionable` `learnings` `in order to` `serves as`, and `Additionally` or `Moreover` as openers.

The gate for anything longer than a short answer: `bun "$MYOS_DIR/../skills/Writing/Tools/StyleCheck.ts" <file>` must exit 0.

## Where things live (load on demand)

| Need | Where |
|---|---|
| Constitutional rules, output format | `MYOS/MYOS_SYSTEM_PROMPT.md` |
| The Algorithm | `MYOS/ALGORITHM/LATEST`, then the version file it names |
| ISA format | `MYOS/DOCUMENTATION/IsaFormat.md` |
| Verification rules | `MYOS/RULES/Verification.md` |
| Where a new rule lives | `MYOS/RULES/SelfHealing.md` |
| Writing prompts, briefs, skills | `MYOS/RULES/Prompting.md` |
| Hooks and kill switches | `hooks/README.md` |
| Skills | `skills/<Skill>/SKILL.md` |
| Token reports | `skills/MyTokens/SKILL.md` |
| Open projects index (imported above) | `MYOS/USER/PROJECTS.md` |
| One project's history | `MYOS/USER/PROJECTS/<slug>.md` |
| Knowledge notes | `MYOS/MEMORY/KNOWLEDGE/` |
| Past work and ISAs (search with `/cs`) | `MYOS/MEMORY/WORK/` |
| Conventions, Grist included | `MYOS/USER/CONVENTIONS.md` |
| Config | `MYOS/USER/CONFIG/MYOS_CONFIG.toml` |

Project histories, knowledge and past work load only when a task needs them. Nothing is injected per turn.

## Kill switches

`MYOS_GATES=off|log|block` sets the Stop gates; `MYOS_PUSHGATE=off` disables the public push scan. Both are documented in `hooks/README.md`.

## Trial

myos is on trial against the old setup. TrialClock prints review reminders at session start. `bun "$MYOS_DIR/TOOLS/GateReview.ts" report` shows what the gates caught, so the review can decide which gates to arm.
