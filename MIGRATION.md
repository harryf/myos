# Migration guide: pai and pmai to myos

Status: BUILT, 2026-09-27. The operator's guide for moving Harry's working setup onto myos. Each step can be run and checked on its own. The migration tool was rehearsed read only against the real pai tree into a sandbox (122 WORK dirs, 10 KNOWLEDGE files, PROJECTS.md split into a 4,231 byte index plus 20 project files, path audit 0); section 3 records what the real run produced.

## 0. What moves, what stays

| From | What | To |
|---|---|---|
| `~/.claude-personal/PAI/USER/PROJECTS/PROJECTS.md` | the live project handover notes (74 KB) | `~/.myos/MYOS/USER/PROJECTS.md` (a short index, under 6 KB, the only always loaded file) plus `~/.myos/MYOS/USER/PROJECTS/<slug>.md` per project (`SplitProjects.ts`) |
| `~/.claude-personal/PAI/MEMORY/WORK/*/` | 122 work dirs with their ISAs, the decision record since May 2026 | `~/.myos/MYOS/MEMORY/WORK/` (byte for byte, old format kept) |
| `~/.claude-personal/PAI/MEMORY/KNOWLEDGE/` | 10 files (Grist plus Cloudflare Access, Remotion gotchas, Swiss scraping law, ...) | `~/.myos/MYOS/MEMORY/KNOWLEDGE/` |
| `~/.claude-personal/PAI/MEMORY/STATE/{work.json,session-names.json}` | session registry and names | `~/.myos/MYOS/MEMORY/STATE/` (merged; existing rows win) |
| `~/.claude-personal/projects/*/*.jsonl` | Claude Code transcripts still on disk (about 30 days) | read once by MyTokens into `~/.myos/MYOS/MEMORY/OBSERVABILITY/TOKENS/sessions.json`; the files stay where they are |
| `~/.claude-personal/projects/-Users-harry--claude-personal/memory/` | Claude Code auto memory (MEMORY.md plus two project notes) | not migrated: auto memory is off in myos (Harry's answer to question 20); the two notes are covered by PROJECTS.md |
| `~/.claude-personal/settings.json` `model`, `enabledPlugins`, `theme`, `tui`, `max_tokens` | the values Harry chose by hand | `~/.myos/settings.json` (via the template) |
| `~/.pmai/skills/GigsTokens`, `~/.pmai/hooks/TokenLog.hook.ts` | token log and reports | `payload/skills/MyTokens`, `payload/hooks/TokenLog.hook.ts` in the myos repo |
| `~/.pmai/PMAI/MEMORY/OBSERVABILITY/TOKENS/` | 575 work sessions of token history | stays in pmai; MyTokens in myos starts from the pai transcripts. Merge later if wanted (`sessions.json` is keyed by session id; a `merge` subcommand would be a small addition) |

Stays where it is: `~/bin/publish`, `~/bin/interceptor`, `~/bin/transcribe`, `~/bin/claude-switch`; every crontab job; every launchd agent; all project `.env` files; `~/.pmai` in full (the work profile keeps running pmai); the OAuth login in the keychain (each config dir has its own entry, the first `myos` launch logs in once).

Not migrated: `PAI/MEMORY/LEARNING/FAILURES` (652 MB of transcript copies), OBSERVABILITY logs other than as a read once source for MyTokens, SECURITY alert logs, VOICE, RELATIONSHIP, the stale top level `MEMORY/`, the literal `${HOME}/` tree (106 MB), `PAI-Install/` (255 MB), `VoiceServer/`, the two `.claude-*.bak` dirs, all of `PAI/USER/` except PROJECTS.md (placeholders), TELOS.

## 1. Preconditions

Check before anything else:

```bash
bun --version            # 1.4.2 seen on 2026-09-27
claude --version         # 2.1.283 seen
gh auth status           # logged in as harryf
command -v rtk jq rg     # rtk optional (ContextReduction), jq required by the shell hook
ls -d ~/.myos            # must NOT exist before the first install
command -v myos          # must be empty before the first install
```

Run the install from a project directory, never from `$HOME`: Claude Code loads `<cwd>/.claude/settings.json` as project settings, and at `$HOME` that file is pai's.

Hidden references to the pai install outside cron and launchd, found on 2026-09-27 by grepping the rc files, `~/bin` and `~/.config`:

```bash
rg -n -e '\.claude-personal' -e 'claude/PAI' -e 'PAI_DIR' ~/.zshrc ~/.zprofile ~/.zshenv ~/.bashrc ~/.bash_profile ~/.profile ~/bin/ ~/.config
# .zshrc:38   alias pai='bun /Users/harry/.claude/PAI/Tools/pai.ts'
# bin/claude-switch:7   PERSONAL_DIR="$HOME/.claude-personal"
```

Both keep working while pai exists. Re run the grep before cutover (section 8); also check MCP configs and git hooks in the project repos you use most (`rg -l '\.claude' ~/Code/personal/*/.git/hooks ~/Code/personal/*/.mcp.json`).

Path audit of the data to migrate, same day: no `ISA.md` under `PAI/MEMORY/WORK` and no line of `PROJECTS.md` contains an absolute `~/.claude-personal` or `~/.claude/` path, so no rewrite step is needed. Keep the check in `--from-pai` anyway (`rg -l '\.claude-personal|/Users/harry/\.claude/' <migrated files>` must print nothing).

## 2. Install myos alongside pai

From the myos repo at a tagged release:

```bash
cd ~/Code/personal/myos
git fetch --tags && git checkout "$(git tag --sort=-v:refname | head -1)"
./install.sh --dry-run          # prints the plan, writes nothing
./install.sh                    # fresh install into ~/.myos, symlinks ~/.local/bin/myos
myos --version                  # myos v0.1.0
```

What the installer writes: `~/.myos/{CLAUDE.md,settings.json,hooks,skills,agents,commands,MYOS,bin,package.json,.install-manifest.json,install.log}` and the empty `MYOS/MEMORY/*` and `MYOS/USER/CONFIG/MYOS_CONFIG.toml` (copied once, never overwritten). It asserts the login state before and after and refuses to continue if the target already holds someone else's `skills/` or `hooks/` without a myos marker.

First launch:

```bash
cd ~/Code/personal/inyourfacecomedy    # any project dir
myos
```

Claude Code asks to log in (new config dir, new keychain entry). Then check `/hooks` shows the myos set and `/context` shows `~/.myos/CLAUDE.md` plus the project's CLAUDE.md, and nothing from `~/.claude`.

## 3. Bring the data over

```bash
./install.sh --from-pai --dry-run
./install.sh --from-pai
```

`--from-pai` runs `bun MYOS/TOOLS/MigrateMemory.ts --from-pai` (also runnable by hand with `--dry-run` and `--source <dir>`; the default source is `~/.claude-personal`). It copies and never edits the source:

1. every `PAI/MEMORY/WORK/<slug>/` dir into `MYOS/MEMORY/WORK/` (dirs already present are skipped, so a rerun copies nothing; three literal `${HOME}` cache dirs left by a pai bug are skipped);
2. `PAI/MEMORY/KNOWLEDGE/` into `MYOS/MEMORY/KNOWLEDGE/`;
3. `work.json` and `session-names.json` into `MYOS/MEMORY/STATE/`, merged into existing files;
4. `PAI/USER/PROJECTS/PROJECTS.md` through `SplitProjects.ts` into the index `MYOS/USER/PROJECTS.md` plus `MYOS/USER/PROJECTS/<slug>.md` per project (a per project file Harry has edited is left alone and reported);
5. a path audit: the count of migrated lines containing `.claude-personal` or `/Users/harry/.claude` (expected 0);
6. the MyTokens one time sync over the pai transcripts (`MYOS_TOKENLOG_PROJECTS=~/.claude-personal/projects`), when the skill is installed.

Checks:

```bash
ls ~/.myos/MYOS/MEMORY/WORK | wc -l          # 122
find ~/.myos/MYOS/MEMORY/KNOWLEDGE -type f | wc -l   # 10
wc -c ~/.myos/MYOS/USER/PROJECTS.md          # under 6000
ls ~/.myos/MYOS/USER/PROJECTS | wc -l        # 20
bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts report --days 30 | head -20
touch /tmp/pai-marker && find ~/.claude-personal -newer /tmp/pai-marker -not -path '*/MEMORY/OBSERVABILITY/*' -not -path '*/projects/*' | wc -l   # 0 after the run
```

The old ISAs keep their twelve section format (an `effort:` key in the frontmatter marks them). ContextSearch (`/cs <topic>`) indexes them; the ISA gates skip them; new ISAs use the myos format (`MYOS/DOCUMENTATION/IsaFormat.md`). Old ISAs are never converted.

## 4. Settings you set by hand

The template carries the shared shape. These come from Harry's current settings and are set once in `~/.myos/settings.json` (MergeSettings never changes a value you set):

- `model`: `fable[1m]` (current pai value; also the pin ModelRungGuard reads).
- `theme`: `dark-daltonized`. `tui`: `fullscreen`.
- `enabledPlugins`: `code-review`, `pr-review-toolkit`, `swift-lsp` (pai) plus `typescript-lsp` (LifeOS).
- `permissions.allow`: add `Edit(~/Code/**)`, `Edit(~/Documents/Comedy/**)`; pai's `~/Projects/**` entries are not carried (Harry's code is under `~/Code`).
- `autoMode.environment`: name `~/Code`, `~/Documents/Comedy`, `~/.myos` as trusted; name Grist, Meta, Eventfrog and the GitHub Pages repo as the external destinations scripts talk to.
- `MYOS_CONFIG.toml` (written by the installer from the example): `[principal] name = "Harry"`, `timezone = "Europe/Zurich"`; `[paths] code = "~/Code"`; `[gates] blocking = false` (flip to true to arm the ISA gates after the review; `verification = "block"` is the one gate armed from day one).
- `MYOS/USER/CONFIG/trial.json`: written on first install with the two review dates; TrialClock prints a reminder at session start when one is due; `bun ~/.myos/MYOS/TOOLS/GateReview.ts mark gate-review-done` silences it after the review.

Most of the list above is already in the template; MergeSettings only ever adds, so anything you change by hand in `~/.myos/settings.json` stays.

Do not add `Write(<path>)` rules; the harness ignores them and warns at boot. `Edit(<path>)` covers Write.

## 5. Two installs on one machine

- `claude` (bare) still runs pai from `~/.claude`. `myos` runs myos from `~/.myos`. `pmai` runs pmai from `~/.pmai`. Three keychain entries, three session stores.
- The `myos` launcher passes `--setting-sources user` when cwd is `$HOME` or under `~/.claude*`, so pai's CLAUDE.md and hooks do not load as project config. Anywhere else, a project's own `.claude/settings.json` loads normally.
- Hooks in one install never see the other's sessions: `tool-activity.jsonl` and `work.json` live inside each config dir.
- CheckpointPerISC commits only in repos listed in `~/.myos/checkpoint-repos.txt`; start with none, add project repos deliberately.
- The `~/bin` scripts are shared and unchanged.

## 6. Trial period

Two weeks of real work in `myos`, pai available in another terminal. Each Friday:

```bash
bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts report --days 7
tail -50 ~/.myos/MYOS/MEMORY/OBSERVABILITY/format-gate.jsonl
tail -50 ~/.myos/MYOS/MEMORY/OBSERVABILITY/verification-gate.jsonl
bun ~/.myos/MYOS/TOOLS/Doctor.ts
```

Read the gate logs for false positives before arming any Stop gate. Fixes go into the repo, then `bun Tools/Release.ts patch` and `./install.sh` (the upgrade path keeps `MEMORY`, `USER`, `settings.json` values and any `_`-prefixed skill you created).

Exit test for the trial (from PLAN.md phase 6): 20 or more `myos` sessions; zero gate blocks overridden with a kill switch in the last 10; FormatGate violations under 5 percent of turns in the last week; MyTokens output tokens per session at or below the pai baseline; three or more tagged releases; zero ContrabandCheck hits. Until it passes, `claude` (pai) and `pmai` stay as they are.

## 7. Upgrading myos later

```bash
cd ~/Code/personal/myos
git fetch --tags && git checkout "$(git tag --sort=-v:refname | head -1)"
./install.sh --dry-run
./install.sh
```

The installer classifies every managed file against `.install-manifest.json` (sha256 per file): release changes are replaced, files you edited are backed up to `~/.myos/upgrade-backups/<timestamp>/` and reported, files you added in a replace area are backed up, orphans from the previous release are deleted. Your own `_MYSKILL/` dirs are never in the loop.

## 8. Cutover (decided)

Harry's answer to question 16: myos stays a separate command. `claude` (bare) keeps whatever `~/.claude` points at, `myos` runs myos, `pmai` runs pmai. `claude-switch` becomes redundant once pai is retired and is left as it is. Nothing assumes `~/.claude` is myos, so no symlink swap and no alias.

## 9. Rollback

At any point before cutover:

```bash
rm -rf ~/.myos ~/.local/bin/myos
```

pai and pmai are untouched. The myos repo keeps the plan and the code.

## 10. pai residue (question 17)

Harry's answer: deleting is fine once the main memories are out. After the trial, `~/.claude-personal` holds about 1 GB of which the useful parts have been copied. Recommended order all the same: archive first, `tar czf ~/Archive/claude-personal-<date>.tgz ~/.claude-personal`, and only then consider deleting. Two things in that tree are not copied anywhere else: the Claude Code session transcripts under `projects/` (the source MyTokens reads once, and the only record of past conversations) and the 78 failure summaries under `PAI/MEMORY/LEARNING/FAILURES`. The tarball keeps both. `~/.pmai` is the work profile and is not part of this migration.
