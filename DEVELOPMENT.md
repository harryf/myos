# DEVELOPMENT: how this codebase works

Maintainer guide for myos. The system of record for goals, criteria and decisions is [ISA.md](ISA.md); the plan the repo was built from is [PLAN.md](PLAN.md); the data move from the old setup is [MIGRATION.md](MIGRATION.md). Private single author repo: commits go to `main`, no branches.

## What this is

myos is Harry's Claude Code harness: the hooks, skills, Algorithm, ISA, house style and token reports he actually uses, and nothing that runs in the background. It was built from the pmai repo skeleton (installer, upgrade manifest, release tooling, test harness) and the LifeOS Algorithm, after an audit of what two earlier PAI forks were used for. Hard exclusions, enforced by `Tools/ContrabandCheck.ts`: voice, notifications, local servers, TELOS and life coaching, kitty tabs, Telegram.

## Structure

```
myos/
  payload/                 mirrors ~/.myos one to one. THE product. Edit here, then ./install.sh
    CLAUDE.md              routing table plus Harry's rules (under 6 KB, BudgetCheck enforced)
    settings.template.json __MYOS_HOME__ substituted by the installer
    hooks/                 *.hook.ts and .sh entrypoints, lib/, README.md (every hook, kill switches)
    skills/                20 skills; each SKILL.md carries name, description, version
    agents/                Designer, Engineer, Max
    commands/              /cs, /myos
    MYOS/                  VERSION (written at install), MYOS_SYSTEM_PROMPT.md, statusline.ts,
                           ALGORITHM/, RULES/, DOCUMENTATION/, TOOLS/, USER/ (scaffold only)
  bin/myos                 launcher: CLAUDE_CONFIG_DIR=~/.myos, system prompt append, settings shield
  install.sh               installer and upgrader (see Installer semantics)
  Tools/                   repo gates and Release.ts (never shipped)
  test/                    bun test suite: harness, corpus/, hooks/, tools/, skills/, gates/, doctrine/, fixtures/
  .githooks/pre-commit     refuses an em dash in staged changes (git config core.hooksPath .githooks)
  .github/workflows/       ci.yml (every push), release.yml (tag push)
  docs/research/           the audits behind PLAN.md
```

The mirror rule: `payload/` and `~/.myos` have identical layout. After editing payload run `./install.sh` (a few seconds). Never edit only `~/.myos`; upgrades overwrite managed files. Two trees are the user's and are never touched by an install: `~/.myos/MYOS/MEMORY/**` and `~/.myos/MYOS/USER/**` (the payload ships a USER scaffold that is copied only when a file is absent).

## Conventions

- bun only, TypeScript ESM, no tsconfig, no linter. Shell only for `install.sh`, `bin/myos`, the pre commit hook and one hook; macOS `bash` is 3.2 (no associative arrays, guard empty arrays under `set -u`).
- No em dash (U+2014) anywhere: code, comments, docs, commits, file names. Tests and StyleCheck write the character as the escape `backslash-u2014`. The pre commit hook and CI both grep for it.
- Always loaded context stays small: `payload/CLAUDE.md` and the system prompt each under 6,000 bytes (`payload/MYOS/TOOLS/context-budgets.json`, checked by `BudgetCheck.ts` in CI and by `test/doctrine`).
- Hooks never call a model, never curl a server, never spawn `claude`. A hook checks a property of an artifact or gates an irreversible act, and nothing else.
- Every Stop gate and ISA guard decides its mode through `payload/hooks/lib/gates.ts` (`gateMode()`: `MYOS_GATES=off|log|block`, else `[gates] blocking` in `MYOS_CONFIG.toml`, default log). A log only gate still computes its verdict and writes it to `MEMORY/OBSERVABILITY/*.jsonl`; `GateReview.ts report` reads those rows when the trial asks whether to arm a gate.
- When a component is dropped, add a grep able signature for it to `Tools/ContrabandCheck.ts` in the same commit.
- Permission rules fail silently twice: `MergeSettings` prunes rules naming tools outside its `KNOWN_TOOL_NAMES`, and the harness ignores `Write(<path>)` rules (`Edit(<path>)` covers all file editing tools). `bun Tools/PermissionRulesCheck.ts` gates both.
- Every `MYOS/TOOLS/*.ts` a skill, hook or doc mentions must exist in payload (CI sweeps it).
- ISA format: `payload/MYOS/DOCUMENTATION/IsaFormat.md` is frozen; golden fixtures in `test/fixtures/isa/`. Legacy twelve section ISAs (an `effort:` key in the frontmatter) stay readable and are exempt from the gates.

## The test suite

`bun test` covers every tool and hook myos ships: repo `Tools/`, `payload/MYOS/TOOLS/`, `statusline.ts`, `bin/myos`, every `payload/skills/*/Tools/*.ts`, every hook entrypoint, and the doctrine files. No network, no model.

```bash
bun install                     # once; the two small test deps
bun test                        # everything
bun test test/hooks/            # one area
bun Tools/TestCoverageCheck.ts  # tool and test parity
```

- `test/corpus.ts` is the parity contract, aggregated from `test/corpus/{hooks,gates,tools,skills}.ts`: a script is on disk exactly when it has a row naming its test file. Add the row in the same commit as the script.
- Hooks run as real subprocesses (`test/hooks/harness.ts`): JSON on stdin, sandbox HOME, scrubbed env, sparse PATH so `claude` never resolves, hard timeout. Cross hook wiring (registered on disk, Stop order) is `test/hooks/HookContract.test.ts`.
- Tests that need ffmpeg, a browser or a binary skip and say why.
- Never run a tool or `install.sh` against the real home while developing; every test and every manual probe sets `HOME`, `MYOS_HOME` and `CLAUDE_CONFIG_DIR` to a sandbox.

## Releases

Remote: `github.com/harryf/myos` (private). Semver `vX.Y.Z`; the tag push is the release act; `~/.myos` upgrades by pulling and re running `./install.sh`.

```bash
bun Tools/Release.ts patch            # or minor, major, an explicit X.Y.Z
bun Tools/Release.ts patch --dry-run  # full rehearsal, no writes or pushes
bun Tools/Release.ts patch --fast     # skip ReleaseCheck's live probes
```

It runs preflight (clean `main`, not behind origin, `gh` logged in), the gates (Contraband, PermissionRules, TestCoverage, `bun test`), `./install.sh` plus ReleaseCheck, the VERSION bump, the CHANGELOG re head and the skill version bumps (`Tools/SkillVersionBump.ts`: minor when files were added to a skill since the last tag, patch otherwise), then commit, push, wait for CI, tag, wait for the release workflow, confirm the GitHub release, resync `~/.myos`. Release notes are the `## Unreleased` section of `CHANGELOG.md`, written while doing the work.

## Installer semantics (upgrade safety contract)

`./install.sh` is both install and upgrade; it detects which from content markers and prints a `mode:` line before writing. A target that holds only user owned trees (`MYOS/MEMORY`, `MYOS/USER`) and no marker counts as fresh. Marker less content that looks like another install is refused (`--force` overrides). Flags: `--dry-run`, `--force`, `--reset` (clears only what a release owns), `--from-pai` (runs `MYOS/TOOLS/MigrateMemory.ts --from-pai` once; idempotent).

| Refreshed every run | Preserved forever |
|---|---|
| skills (rm and copy) | `~/.myos/MYOS/MEMORY/**` |
| hooks, agents, commands | `~/.myos/MYOS/USER/**` (config, PROJECTS, CONVENTIONS, trial.json) |
| `MYOS/*` except MEMORY and USER | every value in `settings.json` |

- `Tools/UpgradePlan.ts` classifies every managed file against `~/.myos/.install-manifest.json` (sha256 per file as last installed) and backs up anything of the user's before replacing it. Its area table and `install.sh`'s must agree.
- `settings.json` is written once; upgrades fold template additions in additively (`MergeSettings --upgrade`): new keys, env, hook registrations and permission rules are added, stale registrations dropped, nothing the user set changes, the file is untouched when nothing changed.
- Clean reinstall is `./install.sh --reset`, never `rm -rf ~/.myos` (that also deletes `.claude.json`, history and sessions). Complete removal, when wanted, is `rm -rf ~/.myos ~/.local/bin/myos`; pai and pmai are unaffected.

## Adding a hook

1. Write `payload/hooks/<Name>.hook.ts` reading stdin once through `lib/hook-io.ts`; gates decide through `lib/gates.ts`.
2. Register it in `payload/settings.template.json` with a `timeout` (and `async: true` when nothing downstream waits for it).
3. Add `test/hooks/<Name>.hook.test.ts` with synthetic stdin and a corpus row in `test/corpus/hooks.ts`.
4. Document it in `payload/hooks/README.md` (event, purpose, kill switch, log file).
5. `bun test test/hooks && bun Tools/TestCoverageCheck.ts && bun Tools/ContrabandCheck.ts`, then `./install.sh`.

## The style gate

`payload/skills/Writing/Tools/StyleCheck.ts` runs in CI in three profiles: `prose` (root docs, CLAUDE.md, the system prompt, RULES, USER scaffold, commands, agents, hooks/README.md), `docs` (DOCUMENTATION, ALGORITHM, docs/), `dashes` (payload/skills, kept close to upstream). The em dash rule is the one auto fix and cannot be suppressed. Opt outs for everything else: file level `<!-- stylecheck-disable: vocab -->`, line level trailing `<!-- stylecheck-ignore -->`.

## Verification recipes

```bash
bun test && bun Tools/TestCoverageCheck.ts
bun Tools/ContrabandCheck.ts
bun Tools/PermissionRulesCheck.ts
bun payload/MYOS/TOOLS/BudgetCheck.ts
./install.sh --dry-run                       # what an upgrade would do to your install
bun ~/.myos/MYOS/TOOLS/Doctor.ts             # installed system health
bun ~/.myos/MYOS/TOOLS/GateReview.ts report  # what the gates would have blocked
cd ~/Code/some-project && myos               # a real session; check /hooks and the statusline
```

## Traps

1. Project settings leak: a session at `cwd=$HOME` loads `~/.claude` as project config on top of `CLAUDE_CONFIG_DIR`. The launcher shields (`--setting-sources user`) at `$HOME` and under `~/.claude*` only; start `myos` inside a project directory.
2. Auth is per config dir: OAuth tokens live in the macOS Keychain keyed off the config dir path; `~/.myos/.claude.json` holds `hasCompletedOnboarding`. The first `myos` run needs one interactive login; headless probes report "Not logged in" until then. The installer reads `.claude.json`, never writes it, and exits 1 (`LOGIN STATE LOST`) if a run loses it.
3. Do not sweep hooks with fake stdin outside the harness; use `bun test test/hooks/` or the installed tree build sweep in `ci.yml`.
4. myos and pai draw one subscription budget.
5. A bare tool run without a sandbox writes into the real `~/.myos`. Set `HOME`, `MYOS_HOME` and `CLAUDE_CONFIG_DIR` first, every time.
