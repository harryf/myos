---
project: myos
task: Build myos phases 1 to 5 (repo, launcher, hooks, doctrine, skills, memory migration) per the approved plan
slug: 20260927-220000_myos-build
effort: E4
phase: observe
progress: 40/160
mode: algorithm
started: 2026-09-27T20:05:00+02:00
updated: 2026-09-27T22:05:00+02:00
---

# myos ISA

## Problem

Harry runs two forks of Daniel Miessler's PAI: the personal install at `~/.claude-personal` (PAI 5.0.0, Algorithm v6.3.0, symlinked from `~/.claude`) and the work port at `~/.pmai` (pmai 0.32.0, source repo `~/Code/gigs/pmai/pmai`). The upstream project has become LifeOS (v7.40.4) and moved on. Both installs carry a large amount he never uses: voice, notifications, Pulse dashboards, kitty tab plumbing, life coaching, TELOS. The parts he does use (hooks, skills, the Algorithm, the ISA, Interceptor, token reports, the no-em-dash gate, skill versioning, the install and release process) are spread across two trees with different names and paths. There is no single lean system he owns.

## Vision

Harry types `myos` in any project directory and gets Claude Code with exactly the intelligence he uses: the Algorithm and ISA for deep work, the hooks that gate quality and log tokens, the skills he actually invokes, his house style enforced, and nothing running in the background. Upgrading is `git pull` plus one install command that never touches his data. The first read of the plan should feel like an accurate mirror of how he really works, with the dead weight named and removed.

## Out of Scope

No voice services (ElevenLabs, voice curls, VoiceCompletion). No notifications (Pulse notify endpoint, push, Telegram, iMessage, Discord). No locally running web servers or daemons (Pulse, dashboards, Observability UI, Arbol, Hermes sidecar). No life coaching or TELOS goal tracking. No Gigs* skills except GigsTokens (renamed MyTokens). No kitty terminal tab management. This run produces the plan only; implementation waits for Harry's review.

## Principles

- Evidence over intent: what gets carried over is what the activity logs and ISAs show being used.
- Hooks are the enforcement layer; prose rules are the fallback, not the mechanism.
- Every component earns its place by removing a failure Harry has actually hit.
- Owned data (MEMORY, USER, settings) is never touched by an install or upgrade.
- One name space: `myos`, `~/.myos`, `MYOS_*`, no `PAI_` or `PMAI_` residue.

## Constraints

- bun and TypeScript only for tooling; Bash only for the launcher.
- Runs as a standalone Claude Code config dir via `CLAUDE_CONFIG_DIR=~/.myos`; bare `claude` stays untouched.
- Repo at `/Users/harry/Code/personal/myos`, private GitHub under Harry's account, commits to main.
- No em dashes anywhere in the repo, the plan, or the generated output.
- Existing pai and pmai installs are read, never modified, during this run.

## Goal

Run 1 (2026-09-27, ISC-1 to 40, done): a reviewable `PLAN.md` and `MIGRATION.md` exist in `/Users/harry/Code/personal/myos`, grounded in a usage audit of pai, an inventory of pmai and a survey of LifeOS.

Run 2 (2026-09-27 evening, ISC-41 to 160): `myos` is installed at `~/.myos` from the private repo `harryf/myos` with the launcher, about twenty tested hooks (Stop gates log only), the stripped LifeOS doctrine under the 6 KB budgets, the twenty core skills with MyTokens and Writing, Designer, Engineer and Max, and Harry's PROJECTS.md, WORK ISAs, KNOWLEDGE and token history migrated from pai without touching pai; `bun test`, the contraband, coverage and style gates and CI are green.

## Criteria

- [x] ISC-1: `/Users/harry/Code/personal/myos/PLAN.md` exists and is under 900 lines.
- [x] ISC-2: `/Users/harry/Code/personal/myos/MIGRATION.md` exists.
- [x] ISC-3: `/Users/harry/Code/personal/myos/ISA.md` exists with all twelve sections.
- [x] ISC-4: The plan states the pai usage evidence: date range, session count, top skills by invocation count from tool-activity.jsonl.
- [x] ISC-5: The plan states the mode classifier tallies (ALGORITHM / NATIVE / MINIMAL and tier counts).
- [x] ISC-6: The plan lists every pai hook registered in settings.json with a keep / adapt / drop verdict.
- [x] ISC-7: The plan lists every pmai hook with a keep / adapt / drop verdict.
- [x] ISC-8: The plan lists every LifeOS hook with a keep / adapt / drop verdict.
- [x] ISC-9: The plan names the LifeOS Algorithm version to adopt and what changed since v6.3.0.
- [x] ISC-10: The plan describes the pmai TokenLog hook and GigsTokens skill and the rename to MyTokens with the list of references to change.
- [x] ISC-11: The plan describes the pmai em dash mechanism precisely (which hook or tool, which event) and how myos adopts it.
- [x] ISC-12: The plan describes the pmai skill versioning mechanism and how myos adopts it.
- [x] ISC-13: The plan describes the pmai install / upgrade / release process and how myos adopts it.
- [x] ISC-14: The plan lists the skills to carry over with source (pai, pmai, LifeOS) and evidence of use.
- [x] ISC-15: The plan names every Gigs* skill as dropped except GigsTokens.
- [x] ISC-16: The plan has a section "Questions for Harry" with LifeOS features I could not judge.
- [x] ISC-17: The plan has numbered implementation phases each with a verification step.
- [x] ISC-18: The plan defines the `myos` launcher behaviour (CLAUDE_CONFIG_DIR, system prompt append, settings shield).
- [x] ISC-19: The plan defines the repo layout of `/Users/harry/Code/personal/myos` (payload, tools, docs, tests).
- [x] ISC-20: The plan defines the runtime layout of `~/.myos`.
- [x] ISC-21: The plan defines what is migrated from pai MEMORY (KNOWLEDGE, WORK ISAs, LEARNING) and how.
- [x] ISC-22: The plan defines how Harry's ~/bin scripts and crontab jobs that reference ~/.claude are handled.
- [x] ISC-23: The plan names the Claude Code features to lean on (agent teams, worktrees, background agents, effort, thinking, plugins) with a source in LifeOS or Claude Code docs.
- [x] ISC-24: The plan states the coexistence strategy with ~/.claude during migration (both usable, no shared writes).
- [x] ISC-25: The plan carries over Harry's own operational rules verbatim (bun, TypeScript, no em dashes, Interceptor verification, publish recipe; project-scoped rules excluded).
- [x] ISC-26: Anti: no file under `~/.claude-personal`, `~/.pmai` or the LifeOS clone is modified by this run (git status / mtime check).
- [x] ISC-27: Anti: no em dash character appears in PLAN.md, MIGRATION.md or ISA.md.
- [x] ISC-28: Anti: the plan proposes no voice, notification, Pulse, dashboard, Telegram, iMessage or kitty component as "keep".
- [x] ISC-29: Anti: the plan proposes no locally running server or daemon.
- [x] ISC-30: Anti: no implementation file (hook, skill, launcher) is created in myos by this run other than ISA.md, PLAN.md, MIGRATION.md, README.md and docs/research copies.
- [x] ISC-31: The plan lists pai hooks present in hooks/ but not registered in settings.json as dead code.
- [x] ISC-32: The plan states where the pmai source repo is (or that it is absent from this machine and the installed copy is the source).
- [x] ISC-33: The plan names the security hooks to keep and the known false positive to fix.
- [x] ISC-34: The plan states which agents (Forge, Cato, Anvil, researchers) are kept given codex is not installed.
- [x] ISC-35: The plan states the output-format modes decision (ALGORITHM / NATIVE / MINIMAL headers) as a question or a recommendation.
- [x] ISC-36: README.md in myos points at PLAN.md, MIGRATION.md and ISA.md.
- [x] ISC-37: The three source reports (pai, pmai, LifeOS) are saved under `myos/docs/research/` for traceability.
- [x] ISC-38: Advisor called once on the plan before it is declared ready.
- [x] ISC-39: The plan includes a size budget (target hook count, skill count, lines of CLAUDE.md) versus pai today.
- [x] ISC-40: The plan has a rollback statement (myos can be deleted without affecting ~/.claude).

### Run 2: build (phases 1 to 5)

Phase 1, repo and launcher:

- [ ] ISC-41: `/Users/harry/Code/personal/myos` is a git repository on branch `main`.
- [ ] ISC-42: `origin` is `git@github.com:harryf/myos.git` and `gh repo view harryf/myos --json visibility` reports PRIVATE.
- [ ] ISC-43: `VERSION` contains `0.1.0` and `install.sh` copies it to `~/.myos/MYOS/VERSION`.
- [ ] ISC-44: `bin/myos` is executable and `myos --version` prints `myos v0.1.0` after install.
- [ ] ISC-45: `bin/myos` exports `CLAUDE_CONFIG_DIR` to `MYOS_HOME` and passes `--append-system-prompt-file` with the myos system prompt.
- [ ] ISC-46: `bin/myos` applies `--setting-sources user` when cwd is `$HOME` with `~/.claude/settings.json` present or under `~/.claude*`, and honours `MYOS_SETTING_SOURCES`.
- [ ] ISC-47: `./install.sh --dry-run` on a machine without `~/.myos` plans a fresh install and creates no `~/.myos`.
- [ ] ISC-48: `./install.sh` creates `~/.myos` with `.install-manifest.json` holding a sha256 for every payload file.
- [ ] ISC-49: `install.sh` links `~/.local/bin/myos` to `~/.myos/bin/myos`.
- [ ] ISC-50: A second `./install.sh` run reports no changed release files and leaves `settings.json` byte identical.
- [ ] ISC-51: `install.sh --from-pai` exists and runs the memory migration once.
- [ ] ISC-52: `rg -i 'pmai'` over `payload/`, `Tools/`, `install.sh`, `bin/` and `test/` returns nothing.
- [ ] ISC-53: `Tools/ContrabandCheck.ts` denies `localhost:31337`, `voice_enabled`, `ntfy`, `display notification`, `elevenlabs`, `Bun.serve(`, `.listen(` and `launchctl load` in shipped code and passes on the payload with zero hits.
- [ ] ISC-54: `.github/workflows/ci.yml` runs the contraband gate, TestCoverageCheck, `bun test`, StyleCheck in three profiles, the U+2014 grep over the repo, shell syntax, the install smoke test and the hook import sweep.
- [ ] ISC-55: `.github/workflows/release.yml` refuses a tag that differs from `VERSION`.
- [ ] ISC-56: `Tools/Release.ts` and both workflows reference `harryf/myos`, never a pmai remote.
- [ ] ISC-57: `bun test` passes with zero failures.
- [ ] ISC-58: `bun Tools/TestCoverageCheck.ts` exits 0 (every shipped tool and hook has a corpus row).
- [ ] ISC-59: `.gitignore` excludes `node_modules`, `.test-tmp`, `settings.json`, `.env`, `bun.lock` and runtime memory dirs.
- [ ] ISC-60: Anti: no file under `~/.claude-personal` (excluding MEMORY/OBSERVABILITY, projects and logs), `~/.pmai` or `~/Code/gigs/pmai/pmai` is modified by this run (`find -newermt` against the run start).
- [ ] ISC-61: Anti: no U+2014 character in any tracked file of the repo.
- [ ] ISC-62: Anti: `~/.claude` still resolves to `~/.claude-personal`.
- [ ] ISC-63: A pre commit hook under `.githooks/` (activated by `core.hooksPath`) rejects a commit that adds a U+2014, shown with a scratch file.

Phase 2, hooks:

- [ ] ISC-64: `payload/hooks/` holds exactly the target set: AgentInvocation, CheckpointPerISC, ContextReduction, DriftReminder, EventLogger, FormatGate, HookHealer, ISACloseGate, ISAFoldGate, ISAGate, ISAStaleWriteGuard, ISASync, LastResponseCache, LoadContext, LoopDetector, ModelRungGuard, PreToolGuard, PromptProcessing, PublicPushGate, Safety, SessionCleanup, StopGates, TaskGovernance, TimeContext, TokenLog, TrialClock, VerificationGate, plus `lib/`.
- [ ] ISC-65: `settings.template.json` contains no hook of `type: http`.
- [ ] ISC-66: Every hook registered in the template exists on disk and every `*.hook.ts` or `.sh` on disk is registered (HookContract test).
- [ ] ISC-67: TimeContext prints the live Europe/Zurich wall clock on UserPromptSubmit (synthetic stdin test).
- [ ] ISC-68: DriftReminder prints the format contract with an em dash cap of zero and the count of violations in the previous response (test).
- [ ] ISC-69: FormatGate on Stop appends a row to `MEMORY/OBSERVABILITY/format-gate.jsonl` and exits 0 even when the response violates the contract (log only).
- [ ] ISC-70: VerificationGate blocks a "deployed" claim when the replayed transcript has no probe (test fixture).
- [ ] ISC-71: VerificationGate accepts a Claude-in-Chrome screenshot call (`mcp__claude-in-chrome__computer`) as evidence for a UI claim (test fixture).
- [ ] ISC-72: VerificationGate accepts an Interceptor screenshot as evidence (test fixture).
- [ ] ISC-73: StopGates runs FormatGate, VerificationGate, ISACloseGate, ISAGate and ISAFoldGate in that order and exits 0 with no output when `MYOS_GATES=off`.
- [ ] ISC-74: ISAGate, ISACloseGate and ISAFoldGate default to log only (`gates.blocking = false` in `MYOS_CONFIG.toml`) and write to `MEMORY/OBSERVABILITY/isa-gates.jsonl`; setting blocking true makes them block (test both).
- [ ] ISC-75: The three ISA gates skip any ISA whose frontmatter has an `effort:` key (twelve section format) (test).
- [ ] ISC-76: ISAFoldGate's prod mutation shapes cover `~/bin/publish`, `git push`, `launchctl`, `crontab`, a curl to `getgrist.com` with POST, PUT, PATCH or DELETE, and a script run with `--apply` (test).
- [ ] ISC-77: ISAStaleWriteGuard blocks a whole file Write over an ISA changed since the session last read it, and passes under `MYOS_GATES=off` (test).
- [ ] ISC-78: PublicPushGate scans before a push to a public GitHub remote (stub `gh` says public) and fails open when `gh` is absent (test).
- [ ] ISC-79: ModelRungGuard reads the pinned model from settings and only reports, never switches (test).
- [ ] ISC-80: LoopDetector flags a repeated failing call (pmai test passes).
- [ ] ISC-81: HookHealer only changes file modes under `hooks/`; a test asserts file content is byte identical after a run.
- [ ] ISC-82: EventLogger appends to `tool-activity.jsonl` and rotates the file at 20 MB (test with a pre grown file).
- [ ] ISC-83: Safety on PermissionRequest allows a read only Bash shape, stays neutral on `rm -rf`, and spawns no process (test).
- [ ] ISC-84: Safety on PostToolUse WebFetch wraps the result with the external content marker (test).
- [ ] ISC-85: PromptProcessing writes a deterministic session name (first prompt, 48 chars) to `session-names.json` and never spawns `claude` (test with sparse PATH).
- [ ] ISC-86: TokenLog.hook.ts imports `skills/MyTokens/Tools/TokenLog.ts` and folds a fixture transcript into `MEMORY/OBSERVABILITY/TOKENS/sessions.json` (test).
- [ ] ISC-87: SessionCleanup marks the work.json row complete (pmai test passes).
- [ ] ISC-88: ISASync writes frontmatter of `<project>/ISA.md` and of `MEMORY/WORK/*/ISA.md` to work.json (test covers both homes).
- [ ] ISC-89: CheckpointPerISC commits an opted in scratch repo on an ISC transition (pmai test passes).
- [ ] ISC-90: AgentInvocation logs subagent start and end (pmai test passes).
- [ ] ISC-91: TaskGovernance and LoadContext pmai tests pass.
- [ ] ISC-92: TrialClock on SessionStart prints the trial day, and "gate arming review due" or "doctrine review due" once the dates in `MYOS/USER/CONFIG/trial.json` pass; silent after both reviews are marked done (test).
- [ ] ISC-93: `MYOS/TOOLS/GateReview.ts report` summarises format-gate, verification-gate and isa-gates logs (rows per gate and reason) and prints an arming recommendation (test fixture).
- [ ] ISC-94: Every hook registration carries a `timeout`; EventLogger, TokenLog, PromptProcessing and ModelRungGuard are `async`.
- [ ] ISC-95: `payload/hooks/README.md` lists every hook with event, purpose, kill switch and log file.
- [ ] ISC-96: Anti: `rg -n 'claude -p|spawn\("claude"|Inference\.ts' payload/hooks` returns nothing (no hook calls a model).
- [ ] ISC-97: Anti: `rg -in '31337|ntfy|osascript|elevenlabs|kitty|voice' payload/hooks` returns nothing.
- [ ] ISC-98: A twelve section ISA fixture edited in a replayed session passes all Stop gates with exit 0 and no block.
- [ ] ISC-99: `bun build --target=bun` succeeds for every hook file (import sweep).

Phase 3, doctrine:

- [ ] ISC-100: `payload/MYOS/MYOS_SYSTEM_PROMPT.md` is under 6,000 bytes and contains no `{{` placeholder.
- [ ] ISC-101: The system prompt defines the single output format: banner, answer first, `🔧 CHANGE` and `✅ VERIFY` only when something mutated, `🗣️ myos:` closer, and the no em dash rule.
- [ ] ISC-102: The system prompt contains "confidence requires source", reproduce before fixing, the Algorithm entry rule (read `ALGORITHM/LATEST` first) and the no voice, no notification, no server constraint.
- [ ] ISC-103: `payload/CLAUDE.md` is under 6,000 bytes and carries the "How myos writes" block, bun and bunx always, TypeScript always, plan means stop, build over ask, real browser verification with Claude-in-Chrome named as the fallback, the publish recipe and a Grist conventions routing row.
- [ ] ISC-104: `payload/CLAUDE.md` `@` imports only `MYOS/USER/PROJECTS.md` and routes everything else through a table of on demand paths that all exist in the payload or USER scaffold.
- [ ] ISC-105: `payload/MYOS/ALGORITHM/LATEST` is `1.0.0` and `v1.0.0.md` names its provenance (LifeOS v8.20.2).
- [ ] ISC-106: `v1.0.0.md` keeps the 16 claims and contains none of: Pulse, cmux, Kitty, Bunker, `lifeos-ascent-delta`, 31337, voice.
- [ ] ISC-107: `payload/MYOS/RULES/Verification.md`, `SelfHealing.md` and `Prompting.md` exist; SelfHealing has no autonomic loop or Pulse text.
- [ ] ISC-108: `bun payload/MYOS/TOOLS/BudgetCheck.ts` exits 0 with ceilings CLAUDE.md 6,000 and system prompt 6,000.
- [ ] ISC-109: `StyleCheck.ts --profile prose` exits 0 over CLAUDE.md, the system prompt, ALGORITHM and RULES.
- [ ] ISC-110: `payload/MYOS/DOCUMENTATION/IsaFormat.md` is the v2.21 shape (Not yet specified, `(after:)` edges, verifier classes) and states that pre 2026-09-28 twelve section ISAs stay readable and exempt from the gates.
- [ ] ISC-111: `myos -p 'reply with the word ready' --output-format text` run in `~/Code/personal/myos` returns a reply in the myos format (banner and closer present).

Phase 4, skills and agents:

- [ ] ISC-112: `payload/skills/` holds exactly: ISA, Interceptor, FirstPrinciples, BeCreative, SystemsThinking, IterativeDepth, Science, ContextSearch, RootCauseAnalysis, BitterPillEngineering, Writing, MyTokens, Council, RedTeam, CreateSkill, CreateCLI, Trim, Remotion, Fabric, Scheduler.
- [ ] ISC-113: Every SKILL.md has frontmatter `name`, `description` under 1,024 characters and a semver `version`.
- [ ] ISC-114: `rg -l 'Voice Notification|localhost:31337|voice_enabled' payload/skills` returns nothing.
- [ ] ISC-115: `rg -il 'gigs' payload/skills payload/hooks` returns nothing.
- [ ] ISC-116: `rg -l '\.pmai|PMAI|pmai' payload/skills payload/agents payload/commands` returns nothing.
- [ ] ISC-117: Interceptor SKILL.md points at the `interceptor` binary in `~/bin` and has a section for the disconnected extension naming Claude-in-Chrome as the fallback.
- [ ] ISC-118: `bun payload/skills/MyTokens/Tools/TokenLog.ts report --days 7` prints a report against a fixture store (test).
- [ ] ISC-119: MyTokens env overrides are `MYOS_TOKENLOG_*` and the release probe exclusion is `myos-release-probe`.
- [ ] ISC-120: `StyleCheck.ts --profile dashes payload/skills` exits 0.
- [ ] ISC-121: `bun Tools/SkillVersionBump.ts --dry-run` lists every skill with a version and exits 0.
- [ ] ISC-122: `payload/agents/` holds Designer.md, Engineer.md and Max.md only; Max.md has no ElevenLabs or voice block.
- [ ] ISC-123: `payload/skills/Scheduler/Tools/Scheduler.ts` manages launchd jobs of kind `command` and `prompt` (headless `myos -p`) with `add`, `list`, `remove`, `run` and no notification code (test writes a plist into the sandbox).
- [ ] ISC-124: Fabric skill ships its patterns and SKILL.md states that no `fabric` binary is required.
- [ ] ISC-125: ISA skill has Scaffold, Interview, Grill, CheckCompleteness, Reconcile, Seed and Append workflows and a v2.21 template.
- [ ] ISC-126: `payload/commands/` holds `cs.md` and `myos.md`.
- [ ] ISC-127: Anti: `payload/skills` has no Research, Art, Evals, Gigs*, Delegation, LocalModel, Telos, Interview or Daemon directory.
- [ ] ISC-128: The skill tests for Writing, Interceptor, MyTokens, Remotion, Scheduler and ContextSearch pass.

Phase 5, memory and settings:

- [ ] ISC-129: `bun payload/MYOS/TOOLS/MigrateMemory.ts --from-pai --dry-run` lists the WORK dirs, KNOWLEDGE notes, work.json, session-names.json and PROJECTS.md it would copy, with counts.
- [ ] ISC-130: After `--from-pai`, `ls ~/.myos/MYOS/MEMORY/WORK | wc -l` equals the pai WORK dir count.
- [ ] ISC-131: `~/.myos/MYOS/MEMORY/KNOWLEDGE` holds the pai notes (same file count).
- [ ] ISC-132: `~/.myos/MYOS/USER/PROJECTS.md` is under 6,000 bytes and `~/.myos/MYOS/USER/PROJECTS/*.md` together contain every project bullet of the pai file (heading count equal).
- [ ] ISC-133: `MYOS/TOOLS/SplitProjects.ts` is deterministic and idempotent: a second run changes no file.
- [ ] ISC-134: `MYOS/MEMORY/STATE/work.json` and `session-names.json` are copied.
- [ ] ISC-135: MyTokens `report --days 30` in the install shows the pai sessions after the one time sync from `~/.claude-personal/projects`.
- [ ] ISC-136: `bun payload/skills/ContextSearch/Tools/*.ts sarah` (or the `/cs` path) finds the flat finder sessions in the install.
- [ ] ISC-137: `postCompactRestore.fullFiles` contains `MYOS/USER/PROJECTS.md`.
- [ ] ISC-138: `autoMemoryEnabled` is `false` in the template.
- [ ] ISC-139: Anti: the migration writes nothing under `~/.claude-personal` (find -newer against a marker, MEMORY/OBSERVABILITY and projects excluded).
- [ ] ISC-140: The migration prints a path audit count of `.claude-personal` and `/Users/harry/.claude` occurrences in the migrated files (expected 0).
- [ ] ISC-141: `settings.template.json` pins `model` to `fable[1m]`.
- [ ] ISC-142: The template `env` has `MYOS_DIR`, `MYOS_CONFIG_DIR`, `BASH_DEFAULT_TIMEOUT_MS`, `API_TIMEOUT_MS`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_FORK_SUBAGENT`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`.
- [ ] ISC-143: `permissions.defaultMode` is `auto`; deny carries the destructive list with `~/.myos` and `~/.claude*`; ask carries `git push`, `rm`, `sudo`, `launchctl`, `crontab` and `.env` reads; `autoMode` prose names `~/Code`, `~/Documents/Comedy` and `~/.myos`.
- [ ] ISC-144: `enabledPlugins` lists code-review, pr-review-toolkit, typescript-lsp and swift-lsp from `claude-plugins-official`.
- [ ] ISC-145: `statusLine` runs `bun MYOS/statusline.ts` and the statusline test passes with `myos v0.1.0` and `ctx 34%`.
- [ ] ISC-146: `MergeSettings.ts --upgrade` keeps a user added rule and env value (pmai test passes).
- [ ] ISC-147: Anti: the template has none of `voiceEnabled`, `notifications`, `observability`, `allowedHttpHookUrls`, `daidentity`, `spinnerVerbs`, `counts`.
- [ ] ISC-148: `Tools/Doctor.ts` probes bun, rg, git, jq, gh, claude, rtk, interceptor, ffmpeg and whisper and lists misses without failing.
- [ ] ISC-149: `payload/MYOS/TOOLS/Inference.ts` keeps `--level`, the tier aliases and the API key scrub; `rg -i 'codex|perplexity|CROSS_VENDOR' payload/MYOS/TOOLS` returns nothing.
- [ ] ISC-150: Anti: `launchctl list | rg -i myos` is empty after install (nothing runs in the background).
- [ ] ISC-151: Anti: `~/.myos` has no Pulse, PAI-Install, Banners or Observability UI directory.

Process and documentation:

- [ ] ISC-152: Harry's section 8 answers are recorded as a Decisions entry (phase 0).
- [ ] ISC-153: Advisor called before the build starts (approach) and once before `phase: complete` (gaps).
- [ ] ISC-154: An Engineer agent reviews the hook port and its findings are dispositioned in Decisions.
- [ ] ISC-155: `CHANGELOG.md` has a `## 0.1.0` entry and `bun Tools/Release.ts --dry-run` (or ReleaseCheck) passes.
- [ ] ISC-156: `README.md`, `MIGRATION.md` and `DEVELOPMENT.md` describe the built state (install, upgrade, kill switches, how to add a hook, release steps).
- [ ] ISC-157: The first commits are on `main` and pushed; `gh run list` shows the CI run and its status is recorded.
- [ ] ISC-158: `payload/MYOS/USER/` ships scaffold only: `CONFIG/MYOS_CONFIG.toml.example`, `CONFIG/trial.json.example`, `PROJECTS.md` template; the installer never overwrites files under `~/.myos/MYOS/USER` or `MYOS/MEMORY`.
- [ ] ISC-159: `~/.myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml` exists after install with `[principal]` name Harry, timezone Europe/Zurich and `[gates] blocking = false`.
- [ ] ISC-160: `~/.myos/MYOS/USER/CONFIG/trial.json` exists with `started`, `gate_review_due` (14 days), `doctrine_review_due` (30 days) and both `done` flags false.

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| ISC-1..3, 36 | file | exists, line count | present | Bash test -f, wc -l |
| ISC-4..25, 31..35, 39, 40 | content | section or phrase present | present | rg |
| ISC-26 | anti | mtimes and git status unchanged | zero changes by this run | Bash find -newermt, git status |
| ISC-27 | anti | em dash search | zero matches | rg (U+2014) |
| ISC-28..30 | anti | keep table and file list | zero violations | rg, find |
| ISC-37 | file | three reports present | 3 files | ls |
| ISC-38 | process | advisor output recorded | 1 call | Inference.ts advisor |
| ISC-41..51, 130..136, 141..151, 159, 160 | install | file, link, count, JSON value | as stated | Bash test, ls, jq, rg |
| ISC-52, 61, 96, 97, 114..116, 127, 149 | anti | text search over the tree | zero hits | rg |
| ISC-53..58, 99, 108, 109, 120, 121 | gate | tool exit code | 0 | bun Tools/*, bun test |
| ISC-60, 62, 139 | anti | mtimes and symlink | unchanged | find -newermt, readlink |
| ISC-63 | gate | pre commit refuses a scratch em dash | exit 1 | git commit |
| ISC-64..95, 98, 118, 123, 128, 146 | hook, skill | synthetic stdin subprocess via test harness | pass | bun test |
| ISC-100..107, 110 | doctrine | byte size, phrase present or absent | as stated | wc -c, rg |
| ISC-111 | live | headless myos session reply shape | banner and closer | myos -p |
| ISC-152..158 | process | file content, gh output | present | rg, gh run list |

## Features

| name | description | satisfies | depends_on | parallelizable |
|---|---|---|---|---|
| usage-audit | Count tool, skill, agent use from pai logs | ISC-4, ISC-5 | | true |
| pai-report | Deep dive of ~/.claude-personal | ISC-6, ISC-21, ISC-22, ISC-31, ISC-33 | | true |
| pmai-report | Deep dive of ~/.pmai and the pmai repo | ISC-7, ISC-10..13, ISC-15, ISC-32 | | true |
| lifeos-report | Survey of LifeOS clone | ISC-8, ISC-9, ISC-16, ISC-23 | | true |
| claude-code-reference | Docs pointers for harness features | ISC-23 | | true |
| plan | Write PLAN.md | ISC-1, ISC-4..20, ISC-23..25, ISC-28..29, ISC-33..35, ISC-39, ISC-40 | reports | false |
| migration-guide | Write MIGRATION.md | ISC-2, ISC-21, ISC-22, ISC-24 | reports | false |
| readme-and-research | README and docs/research copies | ISC-36, ISC-37 | reports | true |
| review | Advisor, anti checks | ISC-26, ISC-27, ISC-30, ISC-38 | plan | false |
| skeleton | Copy and rename the pmai repo skeleton, git init, pre commit em dash hook, ContrabandCheck list, CI | ISC-41, 43..47, 52..59, 61, 63 | | false |
| hooks | Port pmai core hooks and the LifeOS teeth with tests, settings template, TrialClock, GateReview | ISC-64..99, 141..147 | skeleton | true (agent A) |
| doctrine | System prompt, CLAUDE.md, Algorithm v1.0.0, RULES, IsaFormat v2.21, budgets | ISC-100..110 | skeleton | true (agent B) |
| skills | Core skills, MyTokens rename, Scheduler port, Writing, agents, commands, skill tests | ISC-112..128 | skeleton | true (agent C) |
| tools-and-memory | MYOS/TOOLS, install.sh adaptation with --from-pai, MigrateMemory, SplitProjects, Doctor, Inference, USER scaffold | ISC-48..51, 129..140, 148, 149, 158..160 | skeleton | true (agent D) |
| integrate | corpus merge, bun test, gates, install, live probes, repo creation, push, docs | ISC-42, 57, 58, 60, 62, 111, 150..157 | hooks, doctrine, skills, tools-and-memory | false |

## Decisions

- 2026-09-27 20:05: Voice curls skipped for this run. Harry stated he wants no voice; the Algorithm's voice steps are treated as inapplicable and this is the first decision the new system inherits. Confirmed moot at 20:20: Pulse is not listening on 31337, so every curl would have failed.
- 2026-09-27 20:05: ISA lives in the myos repo as a project ISA (persistent identity), not under MEMORY/WORK.
- 2026-09-27 20:05: E4 ISC soft floor (128) not met by design: the deliverable is one plan document; granularity produced 40 probes. Delegation floor met with four background agents (pai audit, pmai audit, LifeOS survey, Claude Code docs).
- 2026-09-27 20:05: pmai source repo not found on the first search (~/Code depth 4 for payload/ or PMAI/). CORRECTED 20:58 by the pmai audit agent: the repo is at `~/Code/gigs/pmai/pmai` (git, 51 tags, HEAD 8aa7416 "release: v0.32.0"), with `payload/`, `Tools/Release.ts`, `install.sh`, `test/`. The `fd` search missed it because the payload sits five levels deep. The repo, not the installed copy, is the source for myos.
- 2026-09-27 20:06: SecurityPipeline blocked a plain heredoc write ("Piping output to shell interpreter"); ISA written with the Write tool. The pai audit agent hit the same class twice more ("Disk overwrite with zeros" on a heredoc that documented the pattern; "| Bash" table cells read as a pipe into bash). Evidence for the plan's decision to replace the regex pipeline with native deny rules plus Safety.hook.ts.
- 2026-09-27 21:00: Foundation choice: pmai repo skeleton, not the LifeOS installer. Reason: pmai's install, upgrade, release and test machinery is proven on this machine (48 releases, about 1,000 tests) and built for one user; LifeOS's installer targets strangers on four harnesses and ships zero tests.
- 2026-09-27 21:00: Doctrine choice: LifeOS Algorithm v8.20.2 stripped, not pai v6.3.0. Reason: upstream retired tiers, modes, the classifier and phase choreography after a 1,117-run audit; the classifier alone cost a Sonnet call on 1,004 prompts here with 85 percent landing on ALGORITHM. Output format left as question 1 with a recommendation.
- 2026-09-27 21:05: The Claude Code docs agent's reference is kept with a caveat: two details (statusLine type, `[1m]` suffix) disagree with the live install; noted at the top of the saved file.
- 2026-09-27 21:40: Advisor review folded in (see ISC-38 verification). Ten of the twenty questions became defaults the implementation takes unless Harry objects; two questions added (PROJECTS.md split, auto mode posture). Next step is Harry's review; no implementation starts before phase 0 is answered.
- 2026-09-27 22:05: Phase 0 closed. Harry's answers in PLAN.md section 8 (his numbering shifted while editing; mapped by content): one output format, yes; model pin fable, yes, and offload work to other models when it makes sense (keep `Agent(model=...)` downshift and Inference tiers); browser evidence, both; memory model (b) plus a working pai migration path; private only; ISA gates log only with a mechanism that performs the check later; ISAFoldGate shapes: publish, git push, launchctl, crontab, Grist curls, `--apply`; Max only; no Evals but a scheduled review; rtk kept; session naming: the default (deterministic); pmai statusline, nothing more; observability rotated; optional skills: Remotion and Fabric, no Research (no Perplexity key); ISA v2.21 for new ISAs; myos stays a separate command (claude-switch becomes redundant, untouched by this run); pai residue may be deleted once the main memories are out (a separate, explicit step after phase 5 verification); create the private repo, yes; launchd Scheduler for jobs that fire myos, crontab for plain scripts; auto memory off (LifeOS choice); PROJECTS.md split; auto mode plus Safety confirmed.
- 2026-09-27 22:05: Run 2 extends this project ISA (ISC-41 onward) instead of opening a task ISA: the repo is the persistent thing. The ISA skill was loaded earlier this session; its rules are applied directly without re-invoking the workflow (no second notification).
- 2026-09-27 22:05: Tier E4 by conversation-context override (classifier said E3 on "let's go"). Forge and Cato skipped: codex is not installed (known since 2026-09-13). Voice curls skipped: Pulse is not running and Harry wants none.
- 2026-09-27 22:05: Reviews Harry asked to be "performed later" (gate arming after two weeks, doctrine and Evals review after a month) are implemented as a deterministic SessionStart hook (TrialClock) reading `MYOS/USER/CONFIG/trial.json`, plus `GateReview.ts` for the numbers. No launchd job and no model call: a reminder that fires at the next session is enough and costs nothing.
- 2026-09-27 22:40: refined: after the SystemsThinking pass on the Stop hooks (all hooks of one event run in parallel; only StopGates orders anything; the first block wins and the recovery turn is never gated), ISC-73's order becomes FormatGate, VerificationGate, ISACloseGate, ISAFoldGate, ISAGate (evidence gaps outrank ISA bookkeeping; ISAGate's condition is disjoint from the other two). ISC-64 drops PreToolGuard: its only remaining job in pmai was the egress branch; PublicPushGate and ISAStaleWriteGuard register directly. Further design rules handed to the hooks builder: parse the transcript once per Stop into a shared context; FormatGate grades the stdin message, not the transcript tail; LastResponseCache stores the full response (the 2000 char cap broke DriftReminder's closer check on long replies); ISACloseGate derives staleness from the transcript since AlgorithmNudge is not ported; log only gates compute the full verdict and log `would-block` with the reason, write no latch, and log `recovery-fixed` or `recovery-still-failing` on the recovery turn; `MYOS_GATES=off` means dead (no rows, no state), applies to the four gates and ISAStaleWriteGuard, and never to LastResponseCache, DriftReminder, EventLogger or Safety; PublicPushGate has its own `MYOS_PUSHGATE=off`.
- 2026-09-27 22:30: Advisor (approach call) returned eight points; all adopted: green baseline before forking (done: 579 pass, 47 fail, every failure explained: the em dash strip broke StyleCheck's own detection, since restored with `backslash-u2014` escapes; renamed MyTokens and Scheduler test paths; CLAUDE.md not yet written; pmai memory hooks that are being deleted); frozen ISA schema and golden fixtures written before the fork; corpus split into four owner modules; shared gate helpers in `hooks/lib/gates.ts` before the fork; path ownership per builder with GateReview assigned to the hooks builder; no git for builders and sandboxed tests only; byte budget tests for the doctrine; the memory wording ("KNOWLEDGE loads on demand through ContextSearch and the routing table, auto memory off") given to two builders verbatim; launchd label prefix `com.myos.`; migrated history keeps old names (a GigsTokens mention inside an old ISA is history, not a live reference).
- 2026-09-27 22:50: The tools builder ran `Doctor.ts --help` without a sandbox and it wrote four state files into the real `~/.myos/MYOS/MEMORY/STATE/` (capabilities.json, capabilities-statusline.txt, .capabilities-salt, doctor-heartbeat.json; nothing else, nothing under pai or pmai). Not deleted by this run: the installer instead learns to treat a target that holds only user owned trees (MYOS/MEMORY, MYOS/USER) and no marker as a fresh install, which is the right behaviour anyway, and Doctor stops writing on read only commands. Harry is told in the summary.
- 2026-09-27 22:50: GitHub repo `harryf/myos` created private (Harry's answer to question 18); `origin` set; nothing pushed yet.
- 2026-09-27 23:00: BitterPillEngineering quick check over the two always loaded files: two defaults cut from the system prompt (report outcomes as they are; never change working features unasked, both harness defaults), five duplicates merged (subprocess claude, plan means stop, build over ask, reproduce first, browser verification each stated once, the constitutional copy wins because it survives compaction; em dash rule once in CLAUDE.md), one missing rule added that no hook can enforce (read `MYOS/USER/PROJECTS/<slug>.md` before touching a project that has one). Sizes after: CLAUDE.md 3,154 bytes, system prompt 4,124; doctrine tests 19 pass; StyleCheck prose exit 0.
- 2026-09-27 21:25: Two pai files changed after session start: `settings.json` at 19:50:18 (the `/model` command Harry ran at session start saved the default) and a `skills/synced` manifest at 21:18:22 (Claude Code skill sync). Neither was written by this run; ISC-26 holds.

## Changelog

- conjectured: the pmai source repo is not on this machine, so the installed `~/.pmai` copy would be the porting source. refuted_by: the pmai audit agent found `~/Code/gigs/pmai/pmai` with 51 release tags. learned: a depth-limited `fd` over `~/Code` misses repos nested under a client directory; search for the repo marker (`install.sh` plus `payload/`) at unlimited depth before concluding absence. criterion_now: ISC-32 states the repo path and the plan uses the repo as the source.
- conjectured: the LifeOS Algorithm would be a longer version of v6.3.0 with more tiers and gates to strip. refuted_by: v8.20.2 is 100 lines, has no tiers, modes, phases or voice text, and pmai's v8.4.0 is the same lineage. learned: the lean direction Harry asked for is the upstream direction; the plan adopts rather than invents. criterion_now: ISC-9 names v8.20.2 and the changelog entries 7.0.0, 8.0.0 and 8.1.0 as the retirements.

## Verification

- ISC-1: Bash `wc -l PLAN.md` = 346.
- ISC-2: Bash `wc -l MIGRATION.md` = 152.
- ISC-3: Bash `rg -c '^## ' ISA.md` = 12.
- ISC-4: rg "83 sessions" in PLAN.md section 1 (table of 14 skills with counts).
- ISC-5: rg "ALGORITHM 850" in PLAN.md section 1.
- ISC-6: PLAN.md 3.3, table of 24 registered pai hooks with verdicts.
- ISC-7: PLAN.md 3.3 "pmai hooks carried" paragraph plus the dropped list.
- ISC-8: PLAN.md 3.3 "LifeOS hooks to add" table plus "LifeOS hooks dropped".
- ISC-9: PLAN.md 3.2 row for `ALGORITHM/v8.20.2.md` and section 1 (retirements 2026-07-10 and 11).
- ISC-10: PLAN.md 3.5 "Rename list".
- ISC-11: PLAN.md 3.6 "no runtime hook", StyleCheck.ts, CI, DriftReminder and FormatGate.
- ISC-12: PLAN.md 3.1 SkillVersionBump row and 3.4 conventions.
- ISC-13: PLAN.md 3.1 install.sh, UpgradePlan, MergeSettings, Release.ts rows.
- ISC-14: PLAN.md 3.4 core skills table with source copy and evidence column.
- ISC-15: PLAN.md 3.4 "Dropped: all Gigs* skills except GigsTokens" with 22 names.
- ISC-16: PLAN.md section 8, 20 questions.
- ISC-17: PLAN.md section 9, phases 0 to 7 each ending in "Verify:".
- ISC-18: PLAN.md section 4 "Launcher behaviour".
- ISC-19: PLAN.md section 4 tree.
- ISC-20: PLAN.md section 4 "Runtime `~/.myos`".
- ISC-21: PLAN.md 3.9 table; MIGRATION.md sections 0 and 3.
- ISC-22: PLAN.md 3.10; MIGRATION.md section 0 "Stays where it is".
- ISC-23: PLAN.md section 5 with `docs/research/2026-09-27-claude-code-reference.md` as source.
- ISC-24: PLAN.md section 4 "Coexistence"; MIGRATION.md section 5.
- ISC-25: PLAN.md 3.2 CLAUDE.md row quotes the 2026-08-20 directive, bun, TypeScript, build over ask, reproduce first, real browser, plan means stop, publish recipe.
- ISC-26: Bash `find ... -newermt '2026-09-27 19:48'` over pmai hooks, skills, PMAI, CLAUDE.md, settings.json: none. Over pai hooks, skills, ALGORITHM, USER, CLAUDE.md, settings.json (MEMORY excluded because pai hooks write logs there): `settings.json` 19:50:18 (Harry's `/model` at session start) and a `skills/synced` manifest 21:18:22 (Claude Code sync); neither written by this run. pmai repo `git status`: five pre-existing doc edits, unchanged. LifeOS clone `git status --short | wc -l` = 0.
- ISC-27: Bash `rg -n` for the U+2014 character over the myos tree: none (the earlier check found one instance inside this very line, an escape that rendered as the character; fixed 21:50 and rerun).
- ISC-28: rg over PLAN.md for table rows naming voice, pulse, kitty, telegram, imessage or notification with a KEEP verdict: none.
- ISC-29: PLAN.md section 2 Out and section 6 "Background processes: none"; no row proposes a server.
- ISC-30: Bash `find . -type f` in myos: ISA.md, MIGRATION.md, PLAN.md, README.md and four files under docs/research.
- ISC-31: PLAN.md 3.3 "Dead pai hooks (21 files ...)".
- ISC-32: PLAN.md header and 3.1 legend name `~/Code/gigs/pmai/pmai`.
- ISC-33: PLAN.md 3.3 SecurityPipeline row (root deletion regex matched inside heredocs and "confirm") and section 7 last bullet.
- ISC-34: PLAN.md 3.7 agents table and question 8.
- ISC-35: PLAN.md question 1 with recommendation.
- ISC-36: Bash `rg -c 'PLAN.md|MIGRATION.md|ISA.md' README.md` = 3.
- ISC-37: `ls docs/research`: 2026-09-27-pai-audit.md (44,825 bytes), 2026-09-27-pmai-audit.md (65,950), 2026-09-27-lifeos-survey.md (89,793), 2026-09-27-claude-code-reference.md (8,920).
- ISC-38: Bash `bun PAI/Tools/Inference.ts --mode advisor --timeout 420000 <task> <state> <question>` exit 0; output saved in the session task log. Seven points returned (the first was cut by the output tail). Dispositions: adopted (pmai usage census added to section 1; "zero network" wording made precise and Safety confirmed rule based; KVSync fact that no token exists; PROJECTS.md 74 KB import surfaced as question 21; tests for the LifeOS hooks budgeted in phase 2 with kill switches and HookHealer scope; old ISA exemption; hidden dependency grep run and recorded; upstream measurement labelled as LifeOS's; v8.4.0 to v8.20.2 changelog listed and the version independence stated; exit criteria added to phase 6; archive first default in MIGRATION.md; ten questions turned into defaults, two questions added). Rebutted: "absolute paths in the ISAs need a rewrite step" (checked: zero hits in 122 ISAs and PROJECTS.md, the check stays in `--from-pai`); "dropping Gigs skills is a regression" (Harry's instruction, and pmai keeps serving work). Deferred: none.
- ISC-39: PLAN.md section 6 table.
- ISC-40: PLAN.md section 4 "Rollback at any point"; MIGRATION.md section 9.
