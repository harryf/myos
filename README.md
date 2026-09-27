# myos

A lean personal Claude Code harness: hooks, skills, the Algorithm and ISA, house style, token reports. No voice, no notifications, no dashboards, no servers. Runs as its own config dir at `~/.myos` with the `myos` command, alongside a stock `claude` and the older installs.

Successor to two forks of Daniel Miessler's PAI (the personal install at `~/.claude-personal` and the work port pmai), taking the parts the logs show being used and the newest doctrine from LifeOS. Private repository.

## Install

```bash
git clone git@github.com:harryf/myos.git ~/Code/personal/myos
cd ~/Code/personal/myos
./install.sh --dry-run        # what a fresh install would do
./install.sh --from-pai       # install and copy the memories from ~/.claude-personal once
cd ~/Code/some-project && myos
```

The first `myos` run asks for one interactive login (auth is per config dir). `myos --version` prints the installed version. Upgrading is `git pull && ./install.sh`; user data under `~/.myos/MYOS/MEMORY` and `~/.myos/MYOS/USER` is never touched. Removal is `rm -rf ~/.myos ~/.local/bin/myos`; nothing else on the machine changes.

## What is in it

| Piece | Where |
|---|---|
| Launcher and installer | `bin/myos`, `install.sh` |
| Hooks (26) and their kill switches | `payload/hooks/`, `payload/hooks/README.md` |
| Skills (20), agents (3), commands | `payload/skills/`, `payload/agents/`, `payload/commands/` |
| Algorithm v1.0.0, rules, ISA format | `payload/MYOS/ALGORITHM/`, `payload/MYOS/RULES/`, `payload/MYOS/DOCUMENTATION/IsaFormat.md` |
| System prompt and CLAUDE.md (under 6 KB each) | `payload/MYOS/MYOS_SYSTEM_PROMPT.md`, `payload/CLAUDE.md` |
| Tools: doctor, budgets, migration, gate review | `payload/MYOS/TOOLS/` |
| Repo gates, release tooling, tests | `Tools/`, `test/`, `.github/workflows/` |

## Read next

1. `PLAN.md`: the audit, the per component verdicts, Harry's answers to the 22 questions, the phases.
2. `MIGRATION.md`: how the data and the daily workflow moved over, coexistence with the old installs, rollback.
3. `DEVELOPMENT.md`: how to change things, tests, releases, installer semantics, traps.
4. `ISA.md`: the project's ideal state artifact (criteria, decisions, verification).
5. `docs/research/`: the four reports the plan is built on.

## Conventions

bun and TypeScript for tooling, Bash only for the launcher, installer and pre commit hook. No em dashes anywhere in this repo (a pre commit hook and CI enforce it). Commits go to main.
