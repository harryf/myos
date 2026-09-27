# LifeOS v7.40.4 survey (2026-09-03 release) for myos

Clone surveyed read-only at `/private/tmp/claude-501/-Users-harry--claude-personal/ca3afb77-c194-4b9a-b7e0-7696dc49a1c9/scratchpad/lifeos` (1,991 files). Reference points: Harry's fork at `/Users/harry/.claude-personal` (PAI 5.0.0, Algorithm v6.3.0, 46 hooks). All paths below are relative to `LifeOS/` in the clone unless they start with `/`.

Headline: since Harry's fork, Miessler retired modes (NATIVE/ALGORITHM/MINIMAL), effort tiers (E1 to E5), the classifier hook, the seven phases and the phase banners. The Algorithm is now a 100-line "run contract" of 16 done-claims (v8.20.2). The hook layer grew from 46 to 60 files, consolidated into a few dispatchers (PreToolGuard, StopGates, PostToolObserver, MemoryTurnStart, EventLogger, TabState, Safety) plus a large set of deterministic "teeth" hooks (VerificationGate, ISAGate, ISACloseGate, ISAFoldGate, ISAStaleWriteGuard, SystemFileGuard, EgressClassGuard, PublicPushGate, LoopDetector, DriftReminder, FormatGate, WritingGate, ComplexityRatchet, ModelRungGuard, SpendAuditor, HookHealer, TimeContext). Voice, Pulse and Kitty are still woven through, but the coupling is shallow in most hooks (a curl to localhost:31337, a tab-setter call) and hard in only a handful (VoiceCompletion, VoiceEgressGuard, TabState, KittyEnvPersist, PromptProcessing, SessionCleanup, the two HTTP hooks, AtlasEventCapture).

---

## 1. Repo layout and installer

### Top level

```
LifeOS/                 the single distribution unit ("one self-contained skill")
  SKILL.md              LifeOS skill (install/onboard orchestrator), version 1.5.43
  INSTALL.md            AI-native install doc ("give this to your AI and say install this")
  GETTING-STARTED.md    optional external tools (codex, Interceptor, wrangler, gh, ffmpeg, ...) and Doctor.ts
  Tools/                installer tools (bun, dry-run by default, --apply to mutate)
  Workflows/            Setup.md (63 lines), Interview.md (31), Update.md (35), Uninstall.md (22)
  install/              THE PAYLOAD (what gets deployed into ~/.claude)
Releases/v7.40.4/       README.md release notes ("The Receipts Release") plus art
README.md, SECURITY.md, LICENSE, images/, .github/
```

### The payload: `install/`

| Entry | What it is |
|---|---|
| `install.sh` (466 lines) | shell bootstrap. Resolves latest tag, pins to commit SHA, downloads tarball to a file, sha256s it (optional `LIFEOS_EXPECTED_SHA256`), copies ONLY `LifeOS/` into `~/.claude/skills/LifeOS`, appends Interceptor screenshot rules to `.gitignore`, migrates pre-7.x `pai` aliases to `bun LIFEOS/TOOLS/lifeos.ts -s LIFEOS_SYSTEM_PROMPT.md`, then `exec claude "/LifeOS setup"`. Additive by design: "bolt on, don't take over". |
| `CLAUDE.template.md` | becomes `~/.claude/CLAUDE.md` (see below) |
| `settings.system.json` | system half of settings (no `hooks` key; hooks come from `hooks/hooks.json`) |
| `settings.enhancements.json` | 523 spinner verbs plus 265 spinner tips, deployed a la carte |
| `LIFEOS/` | runtime: `ALGORITHM/`, `RULES/`, `LIFEOS_SYSTEM_PROMPT.md`, `TOOLS/` (186 entries), `DOCUMENTATION/`, `PULSE/` (7.8 MB, 449 files), `ATLAS/`, `HERMES/`, `USER_TEMPLATES/`, `LIFEOS_StatusLine.sh` (2,862 lines), `VERSION`, `CORTEX_INDEX_POLICY.json` |
| `USER/` | scaffold of the private tree (identity, TELOS, CONFIG, ALGOPREFS.md, ...) |
| `hooks/` | 57 `.hook.ts` + `ContextReduction.hook.sh` + `hooks.json` + `README.md` + `lib/` (30 files) + `handlers/` (9) |
| `skills/` | 56 skills plus `skills/CLAUDE.md` |
| `agents/` | 8 agent files |
| `commands/` | 7 slash commands |
| `package.json` | `lifeos-runtime`, one dependency: `yaml ^2.8.2` (deployed to `<configRoot>/package.json`) |

Note: zero `*.test.ts` files ship in the payload. The hooks README references `bun test ContextReduction.test.ts` and `test/regression/`, and `RULES/SelfHealing.md` says the `test/` tree "was dropped with the 7.4+ single-skill layout" (public issue #1550). Everything you port is untested on arrival.

### How the installer works (high level)

All tools import `Tools/InstallEngine.ts` (772 lines: detection of OS/harness, `copyMissing`, `mergeHooks`, `detectDevTree`, `substituteTree`, `activateImports`, `setupUserSeparation`). Every tool is dry-run by default, refuses to run inside the author's source tree (`--allow-dev`), and backs up before writing.

| Tool | Setup step | What it does |
|---|---|---|
| `DetectEnv.ts` | 1 | `{os, harness (claude-code / hermes / cursor / openclaw / opencode), display, ssh, bun, existingInstall, isDevTree, settingsExists, claudeMdExists}` |
| `ScanConflicts.ts` | 2 | READ-ONLY report: existing settings hooks, populated config tree, case-insensitive skill-name collisions, discoverable API key names (never values) |
| `InstallSettings.ts` | 4 | places `settings.system.json` into `settings.json`; if present, additive merge of only ABSENT top-level and env keys; expands leading `$HOME`/`~` in `env` values at write time because "the harness injects env values verbatim with NO shell expansion" (a literal `$HOME/` directory was being created on disk) |
| `DeployCore.ts` | 4.5 | `copyMissing` of `install/skills/` to `<configRoot>/skills/` and `install/LIFEOS/` to `<configRoot>/LIFEOS/`, skipping USER, MEMORY, node_modules, .git; scaffolds an empty MEMORY tree; never overwrites |
| `ScaffoldUser.ts` | 5 | existsSync-guarded copy of `install/USER/` into `~/.config/LIFEOS/USER` |
| `LinkUser.ts` | 6 | `<configRoot>/LIFEOS/USER` becomes a symlink to `~/.config/LIFEOS/USER` (migrates live content first) |
| `InstallHooks.ts` | 7 (trust-gated) | merges `hooks/hooks.json` into `settings.json` "per matcher bucket, idempotent by normalized command (and url for http entries), never touching foreign entries"; backs up `settings.json` |
| `DeployComponents.ts` | 7.5 (opt-in) | non-launchd components `statusline, tooltips, spinnerverbs, agents, commands` (settings merges plus file copies) and launchd services delegated to `LIFEOS/TOOLS/Services.ts` ("single source of truth for all 16 background services": pulse, pulse-menubar, deriver, conduit, synthesis, worksweep, derivedsync, atlas, ...) |
| `ActivateImports.ts` | 8 | uncomments the `# @LIFEOS/USER/...` lines in CLAUDE.md, each guarded by existsSync of the target |
| `OverlaySystem.ts` | Update path | the counterpart to DeployCore: overwrites SYSTEM-owned paths only (`hooks/ skills/ agents/ LIFEOS/{TOOLS,DOCUMENTATION,ALGORITHM,RULES,PULSE}` plus CLAUDE.md and the system prompt, the last two backed up first); never USER, MEMORY, settings.json; writes VERSION last |
| `SeedPulse.ts` | Interview end | runs `GenerateTelosSummary.ts` and `UpdateLifeosState.ts` so the Pulse rings render |

Setup.md presents a two-tier model: "LifeOS Core" (system prompt, base settings, CLAUDE.md, skills, runtime, `lifeos` launcher alias) with one consent, and "Enhancements" (hooks, statusline, tooltips, spinner verbs, agents, Pulse, launchd jobs) a la carte. Step 8.5 is important: the constitutional system prompt only loads when Claude is launched with `--append-system-prompt-file`, wired as `alias lifeos='bun <configRoot>/LIFEOS/TOOLS/lifeos.ts -s LIFEOS_SYSTEM_PROMPT.md'`. Step 9.5 offers the Hermes sidecar.

### settings.system.json (what it contains)

- `env`: `LIFEOS_DIR=$HOME/.claude/LIFEOS`, `LIFEOS_CONFIG_DIR=$HOME/.config/LIFEOS`, `PROJECTS_DIR`, `BASH_DEFAULT_TIMEOUT_MS=600000`, `API_TIMEOUT_MS=1800000`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `CLAUDE_CODE_FORK_SUBAGENT=1`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=20`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=3`.
- `permissions.allow`: 213 entries (long Bash allowlist, `Agent(...)` for its 8 agents plus Explore/Plan/general-purpose/claude-code-guide/pr-review-toolkit, `EnterWorktree`/`ExitWorktree`, `TeamCreate`/`TeamDelete`, `SendMessage`, `Task*`, `Cron*`, `RemoteTrigger`, `Monitor`, `ToolSearch`, 33 chrome-devtools MCP tools). `deny`: 47 (destructive rm variants, downloader-to-shell pipes, force-push main, reading `~/.claude/.env` by any verb, `Edit(~/.claude/projects/**/memory/**)`, ssh/aws/gnupg keys). `ask`: 8 (.env read/edit).
- `autoMode`: `allow`, `hard_deny`, `environment` prose rules for the auto-mode classifier (trusted `~/.claude` and `~/Projects`, `localhost:31337` trusted, "EXTERNAL DESTINATIONS: populate during setup").
- Harness flags: `skillListingBudgetFraction: 0.15`, `includeGitInstructions: false`, `worktree: {sparsePaths: [], baseRef: "head"}`, `allowedHttpHookUrls: ["http://localhost:31337/hooks/*"]`, `enabledPlugins` (code-review, pr-review-toolkit, typescript-lsp, swift-lsp from claude-plugins-official), `autoMemoryEnabled: false`, `cleanupPeriodDays: 3650`, `skipDangerousModePermissionPrompt: true`, `fileCheckpointingEnabled: true`, `teammateMode: "auto"`, `remoteControlAtStartup: true`, `inputNeededNotifEnabled: false`, `agentPushNotifEnabled: false`, `voiceEnabled: true`, `theme: dark`, `editorMode: normal`.
- `principal.timezone` (read by TimeContext and the statusline), `dynamicContext` toggles for LoadContext (`relationshipContext`, `learningReadback`, `activeWorkSummary`), `preferences.temperatureUnit`.
- No `hooks` key. No `model` key either, despite the Algorithm saying "`settings.json` pins `"model"` to the top-rung alias" (the pin lives in the maintainer's private overlay `settings.user.json`, which ships empty). ModelRungGuard therefore has nothing to compare against on a fresh public install until you add `"model": "opus"` (or fable) yourself.

Runtime settings are GENERATED: at SessionStart `MergeSettings.ts --system settings.system.json --user USER/CONFIG/settings.user.json --output settings.json` deep-merges (user wins; arrays can opt into append via `{"__merge":"append"}`), and `SettingsBackport.ts` diffs the live settings.json against the last-merge snapshot and writes hand edits back into the user overlay so they survive.

### settings.enhancements.json

Two keys: `spinnerVerbs` (`mode: replace`, 523 verbs: "Krahing", "Hill-climbing", "Kwisatz-haderaching", "Ideal-stating", ...) and `spinnerTipsOverride` (`excludeDefault: true`, 265 tips such as "/council spawns a multi-agent debate on any topic."). Cosmetic; deployed by `DeployComponents --components tooltips,spinnerverbs`.

### CLAUDE.template.md

Structure: header quote (LifeOS thesis line), ONE active import `@LIFEOS/DOCUMENTATION/ARCHITECTURE_SUMMARY.md`, five COMMENTED imports that ActivateImports uncomments (`TELOS/PRINCIPAL_TELOS.md`, `PRINCIPAL/PRINCIPAL_IDENTITY.md`, `DIGITAL_ASSISTANT/DA_IDENTITY.md`, `PROJECTS.md`, `CONFIG/OPERATIONAL_RULES.md`), then a "Constitutional layer" paragraph ("When this file and the system prompt disagree, the system prompt wins"), then pure routing tables: LifeOS System docs (about 40 rows), Principal identity files, TELOS, Work, Project-specific rules. No format templates, no modes, no operational rules in CLAUDE.md any more: "This file is the routing table". Compared with Harry's CLAUDE.md, the NATIVE/ALGORITHM/MINIMAL templates and the Operational Rules section have moved to the system prompt or been deleted.

---

## 2. The Algorithm

### Files in `install/LIFEOS/ALGORITHM/`

| File | Lines / bytes | Content |
|---|---|---|
| `LATEST` | `8.20.2` | version pointer |
| `v8.20.2.md` | 100 lines, 28.3 KB | the whole doctrine (only one version file ships) |
| `changelog.md` | 413 lines, 145 KB | every change since v4.1.0, migration and rollback recipes |
| `eval-guide.md` | 191 lines | how to eval the Algorithm |
| `ideate-loop.md`, `optimize-loop.md` | 26 / 28 lines | loop specs used by the Ideate/Optimize/Loop skills |
| `archive/mode-detection.md`, `archive/parameter-schema.md`, `archive/target-types.md`, `archive/modes/{README,native,ideate,iterate,loop,optimize}.md` | | retired mode docs kept as history |

Harry's `PAI/ALGORITHM/` still carries `capabilities.md`, `mode-detection.md`, `parameter-schema.md`, `target-types.md` and versions v3.5.0 to v6.3.0. None of `capabilities.md` survives in LifeOS (folded into skills' USE WHEN and the nudge layer).

### Doctrine of v8.20.2 (read fully)

Sections: `## The point`, `## The Loop`, `## A run is complete when` (16 claims), `## The ISA asks the questions`, `## Events ask the rest` (nudge table), `## Spend`, `## Telemetry & records (tool contracts)`.

**The point.** "The whole point is euphoric surprise: the principal got exactly the output he wanted, in the right amount of time, for the right amount of spend." "I don't classify the work into an effort tier or predict how hard to go before I start; there is the desired outcome and my judgment about how to reach it." Output format is explicitly a separate contract owned by the system prompt.

**The Loop.** "The ISA is the hill and the instrument at once... each claim names the tool probe that would falsify it, so the spec IS the test suite and evidence is altitude." For persistent things the ISA lives with the thing and "outlives every run"; "Add a feature means add claims that don't hold yet." Dynamic range: "easy things finish in seconds on almost nothing; hard things earn agents, audits, stronger models, and days."

**No phases, no tiers, no modes.** There is no OBSERVE/THINK/PLAN/BUILD/EXECUTE/VERIFY/LEARN walk. `phase:` in ISA frontmatter is "a minimal lifecycle bracket": `marking` (or `scoping`) while articulating, `climbing` on the wall, `complete` at close. Everything else is derived by `deriveAscent()` in `LIFEOS/TOOLS/ascent.ts` (six ascent states shared by Kitty tab, cmux, statusline, Pulse board, ISA HTML mirror).

**The 16 done-claims** (each tagged with its teeth: HOOK blocks mechanically, CHECK is a gate the run executes and records, SELF is honest self-attestation):

1. Principal's stated goal survives verbatim in ISA frontmatter `principal_stated_goal`; every claim traces to it. (CHECK)
2. Done existed in writing before building: ISA at `<project>/ISA.md` or `MEMORY/WORK/{slug}/ISA.md`, claims naming their falsifying probe; substantial work runs `Skill("ISA","check completeness")`, trivial work may direct-write Goal plus Claims. (CHECK)
3. At least one Anti-claim written. (CHECK)
4. Experiential goals name an antecedent for the feeling. (CHECK)
5. External prerequisites probed; MISSING blocks, UNKNOWN surfaces. (SELF)
6. Material ambiguity resolved: up to 3 questions or an inline flag; literal `proceed` accepts defaults; a named-but-unverified referent is always material. (SELF)
7. Reported bug reproduced before suspect code was read; fixes moved to ingestion. (SELF plus Log bypass rows)
8. No claim closed without tool evidence of the right modality (file to Read, code to Grep, command to checked output, HTTP to `curl -i`, deploy to live probe, web/UI to Interceptor, appearance to pixels, motion to frame scrub, schema to SELECT, config to read-back, behavioral to eval pass^k). Evidence must span the claim and arrive when the failure can exist. `[DEFERRED-VERIFY]` is a holding state. (HOOK: VerificationGate; CheckpointPerISC commits every `[x]`)
9. Class-sweep: a defect recognized as a class does not close until one grep enumerated every sibling; `CLASS-SWEEP:` line. (CHECK)
10. Every explicit ask met, skipped with reason, or surfaced; depth directives ("think deeply", "quick pass") count as explicit asks; one line to `MEMORY/OBSERVABILITY/ask-fidelity.jsonl`. (CHECK)
11. Validation intrinsic: the builder never rubber-stamps its own build; a forked subagent counts as the builder, so an independent second look runs NON-FORKED. Second looks (Forge cross-vendor, Max in-family) are elected by judgment, never mandated; electing zero on core-surface/auth/publish work needs one Log row. (CHECK)
12. Trail left but "The changelog is git": the ISA carries NO in-document changelog; evidence collapses to a one-line provenance stub on close; Learning Router routes learnings (knowledge, incident, rule, gotcha, state, business; identity/doctrine/hook/permission surface to the principal). (CHECK at learn)
13. State observable: `phase:` and `progress:` current; "ISASync mirrors every ISA write to work.json, then Pulse; that write IS the telemetry".
14. The ISA at close is not the ISA at open: discoveries folded in as they arrive. (SELF)
15. Spend matched the task; principal's plain-language calls outrank judgment; breaks surfaced. (SELF plus reflection `within_budget`)
16. Previous functionality restored or improved, proven against a captured baseline; destructive ops need ownership enumerated via the provider's authority API before and after. (CHECK; HOOK: AlgorithmNudge destructive-infra row)

**The ISA asks the questions.** Goal (verbatim), Vision (implied), Out of Scope, Anti-claims, Test Strategy probes, "Not yet specified" (fog, graduates into claims). Format spec is `DOCUMENTATION/ISA/ISAFormat.md` v2.21.0: up to seventeen sections (Problem, Vision, Out of Scope, Language, Principles, Constraints, Dependencies, Goal, Criteria, Not yet specified, Bridge Criteria, Test Strategy, Features, Decisions, Verification, Remaining Work; Changelog deleted), `(after: ID, ID)` ordering edges, verifier classes (deterministic / judged / human), `effort:` no longer written.

**Events ask the rest.** The nudge table, run by `hooks/AlgorithmNudge.hook.ts`, deterministic, zero inference. Rows: skill USE WHEN match (always-on), depth directive with no run registered (always-on), deep into a session with no ISA (always-on), behavioral claim wants an eval suite, long stretch with no ISA edits, authority/security or architecture work earns a DESIGN PASS (always-on), destructive infra op ran (always-on). Rule: "a row may only ask a question about an outcome already stated in this file, and only about state the model cannot observe from its own context".

**Spend.** "There is no effort tier to declare and no predicted execution class." Model rung IS written down, as roles not model names, in `OPERATIONAL_RULES.md § Model selection`: "everything important... runs the smartest rung (MAX), then pivots one rung down (HIGH) for the execution leg of scoped, well-defined work, or two (MEDIUM) when execution is trivially easy." "The main loop IS the top rung, by config, not by election": `settings.json` pins `model`; the only elected rung move is the downshift, dispatched with a tier alias. Menu of capabilities (skills, agents, thinking tools, stronger models, native harness features, evals) all elected the same way; two heavy agents named: `Max` (Anthropic top rung, read-only scrutiny) and `Forge` (OpenAI, build or audit). Three non-negotiable spend facts: inline-reachable answers spend nothing (the "110k-token-writing-agent gotcha"); work units sized to the smart zone (about 100k tokens, "prefer closing a coherent work unit and re-entering fresh from the ISA over pushing one long session through compaction"); carrier facts live only in `LIFEOS/TOOLS/models.ts`; rung moves ride native routing (tier aliases on dispatch, `/model`); `Inference.ts` is a standalone leveled utility for scripts. Delegate liveness: one nudge to an idle delegate, then FAILED; briefs sized so one silent death loses little.

**Telemetry and records.** `phase:` bracket only; `deriveAscent()`; the hook-fed phase strip `════ LifeOS | Algorithm | <icon> <Label> ════` injected by ISASync as a `<lifeos-ascent-delta>` block and echoed verbatim; reflections via `bun LIFEOS/TOOLS/Reflect.ts --reflection ...` to `MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl`; `IsaFrontier.ts frontier, claim, release, status, validate` for concurrent sessions with per-claim locks in `MEMORY/STATE/isa-locks/`; resume rule (ISA body edit on a `complete` task rewinds to learn, iteration+1); second-look invocation strings; close in the ONE format.

### What changed since v6.3.0 (Harry's version)

Harry's v6.3.0 (673 lines) has: Effort Levels table (E1 to E5 with time budgets, ISC floors, HARD thinking floors, delegation floors), a closed-enumeration thinking-capability vocabulary, Mode Classification by a Sonnet classifier in PromptProcessing (`MODE: MINIMAL / NATIVE / ALGORITHM`, `TIER:`), Voice Announcements at every phase transition via a curl to `localhost:31337/notify`, seven phases with mandatory headers (`━━━ 👁️ OBSERVE ━━━ 1/7`), INTENT ECHO, REPRODUCE-FIRST gate, DELIVERABLE MANIFEST, PARALLELISM SCAN, INLINE VERIFICATION MANDATE, CHECKPOINTS, Verification Doctrine rules 1 to 3 (live probe, Advisor calls at commitment boundaries, Cato cross-vendor audit at E4/E5, conflict surfacing), RE-READ CHECK, Learning Router, MANDATORY RESPONSE FORMAT, Context Recovery, FINAL OUTPUT FORMAT.

Changelog entries after 6.3.0 (from `changelog.md`, newest first):

- 8.20.2 incident codenames scrubbed from doctrine (patch); 8.19.2 euphoric surprise named the meta-ideal-state of every ISA; 8.19.1 / 8.19.0 the hook-fed phase strip; 8.18.0 delegate briefs sized by blast radius; 8.17.3 / 8.17.2 / 8.17.1 nudge and state-enumeration cleanups; 8.17.0 "the main loop IS the top rung, by config" (`settings.json` `"model": "fable"`); 8.16.0 MAX elected (reverted a day later); 8.14.0 MAX-default rung; 8.12.0 Max agent joins the menu; 8.11.0 "one home per rule" plus native rung routing, `RULES/Verification.md` becomes the single statement of the verification rules, Advisor subprocess door retired; 8.10.0 Advisor restored briefly; 8.9.0 model-routing doctrine cut from Spend; 8.8.0 roles never models; 8.7.x ISA path sync, Workflow tool joins the menu, BPE cleanup, carrier bullet defers to models.ts; 8.6.0 evals join the menu ("we can't make everything require evals"); 8.4.4 claim 8 container-coverage; 8.4.3 execution-class Opus-delegate spend fact; 8.4.2 phase machinery retired (`AlgoPhase.ts`, `algorithm.ts`, `AlgorithmPhaseReport.ts` deleted); 8.4.1 Grok removed; 8.4.0 depth-directive nudge; 8.3.0 AlgorithmNudge unifies SkillRouter and IsaNudge (prebuilt USE WHEN index, 129 skills / 1,482 phrases); 8.2.1 model-selection baseline; **8.1.0 "outcome over machinery": the `## Mode, tier, budget` section deleted, replaced by `## Spend`**; **8.0.0 (2026-07-11) the claims restructure: one-page ISA of 15 done-claims plus a nudge table, 28.2 KB to 11.7 KB**; **7.0.0 (2026-07-10) the Run Contract: a BPE audit over a 1,117-run corpus split kernel from shell; kept verification rules, Reproduce-First, prerequisite manifest, class-sweep, ISA format, checkpoints, Learning Router; cut the mandated OUTPUT choreography (reverse-engineer, premortem, planning line, parallelism scan, LEARN's 4 questions, capability-selection ritual) and the 7-signal density formula**.
- 6.x after 6.3.0: 6.31 Grok audit voice; 6.29 Fable via verified subprocess; 6.28 doctrine relocated to a lean file; 6.27 concise-by-default (128 lines a ceiling, never a target); 6.26 reasoning effort flattened to uniform `high`; 6.25 ISA scale (Dependencies, Bridge Criteria sections); 6.24 motion evidence; 6.23 Claude-persona agents retired; 6.22 Fable is the top rung; 6.21 prerequisite manifest; 6.20 ultracode is not an effort level; 6.19 Forge plus Cato merged into one Forge agent with `MODE: build` or `MODE: audit` and the builder-is-never-auditor invariant; 6.18 per-task intelligence routing; 6.15 four-level effort-model abstraction (`EFFORT_MODEL` max/high/medium/low in models.ts; Inference.ts fast/standard/smart renamed to low/medium/max); 6.12 standalone doctrine file (no more delta chains); 6.11 tier-scaled delegation effort; 6.6 literal surfacing plus calibrated reflection; 6.5 density x tier gate.

Net for Harry: everything he has as "Algorithm choreography" (phase headers, intent echo, deliverable manifest, parallelism scan, voice per phase, effort tiers, mode classification, capabilities.md floors) is gone upstream; what survives is the claim list, the ISA contract, the verification rules and the hooks that enforce them.

### Coupling of the Algorithm file to Voice/Pulse/Kitty/notifications

Light. The doctrine file contains no curl and no voice line. Couplings are prose references: claim 13 ("ISASync mirrors every ISA write to work.json, then Pulse"), the Telemetry bullets (Kitty tab, cmux sidebar, Pulse board, `ascent.ts`, the `<lifeos-ascent-delta>` strip), the frontier bullet ("a cmux fleet"), the "Close" bullet (the hook-fed 🧠 line and the 🗣️ closer). Stripping: delete or reword about six sentences. The ascent strip itself is produced by `ISASync.hook.ts` importing `../LIFEOS/TOOLS/ascent.ts`, which is pure TypeScript with no server; you can keep the strip without Pulse or drop the block (then FormatGate/system prompt bullets about the strip need the same trim). The Reflect.ts, IsaFrontier.ts, ISAGate.ts tools referenced are local bun scripts.

`RULES/Verification.md` (the operative verification rules) is Interceptor-heavy but not Pulse-coupled. `RULES/Philosophy.md` mentions the dashboard URL once.

---

## 3. Hooks

### Registration model (`hooks/hooks.json`)

`hooks.json` is `{ "hooks": { <EventName>: [ { "matcher": "<regex or Tool>", "hooks": [ { "type": "command" or "http", "command": "$HOME/.claude/hooks/X.hook.ts", "timeout": N, "async": true } ] } ] } }`, the exact shape of the `hooks` key in Claude Code `settings.json`. `InstallHooks.ts` merges it into `settings.json` per matcher bucket, deduplicating on normalized command (or url). Hooks are registered BARE (path only, no `bun` prefix), relying on `#!/usr/bin/env bun` and the exec bit; `HookHealer` is the one `bun`-prefixed registration so it can repair a lost exec bit on the others. Two entries are `type: http` to `http://localhost:31337/hooks/skill-guard` and `/hooks/agent-guard` (Pulse routes, allowed via `allowedHttpHookUrls`). SessionStart also runs two inline commands: `FreshnessCache.ts --quiet` and `SettingsBackport.ts; MergeSettings.ts ...`.

Events used: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, StopFailure, PermissionRequest, TaskCreated, ConfigChange, SessionEnd. Not used: PreCompact, PostCompact, SubagentStart/Stop, Notification.

Sixteen `.hook.ts` files carry no registration of their own; they export `run()`/`check()` and are imported by a dispatcher (README says 12, the code shows 16: PreToolGuard also imports BashSystemWriteGuard, PublicPushGate, VoiceEgressGuard; StopGates also imports DeployRegistrationGate). The README also lists `ULWorkSync.hook.ts` under SessionEnd; it is not on disk and not in hooks.json.

### Every hook

Coupling scale: none = pure local files; light = a curl to 31337 or a tab-setter call that fails silently, or a spawn of a local inference script; hard = the hook's purpose is voice/Pulse/Kitty/network. Matchers written as comma lists (the JSON uses regex alternation).

| Hook | Event(s) | Purpose | Deps (lib/handlers) | Coupling |
|---|---|---|---|---|
| `AgentInvocation.hook.ts` | PreToolUse:Agent, PostToolUse:Agent | log subagent_start/stop with real `subagent_type`, duration and resolved model to `MEMORY/OBSERVABILITY/subagent-events.jsonl`; inherited dispatch resolved via ModelRungGuard's `liveModel()` | none | none |
| `AlgorithmNudge.hook.ts` (916 lines) | UserPromptSubmit; PostToolUse via PostToolObserver; PostToolUseFailure | the live nudge layer: skill-routing against `MEMORY/STATE/skill-usewhen-index.json`, depth-directive, design-class, late-ISA, stale-ISA, exec-delegation, inherited-dispatch, capability (Doctor manifest) rows; all advisory `additionalContext` | `../LIFEOS/TOOLS/ascent`, Doctor manifest | light (one regex names `31337/notify` as a capability id; CAP_FIX strings mention ELEVENLABS) |
| `AtlasEventCapture.hook.ts` | PostToolUse: Bash, Write, Edit, MultiEdit | append mutation HINTS (deploys, DNS, tracked-asset edits) to `~/.local/state/lifeos/atlas/events.jsonl` for the Atlas launchd tick | none | hard (useless without Atlas service) |
| `BashSystemWriteGuard.hook.ts` | PreToolUse:Bash via PreToolGuard | when a Bash command is write-shaped into the SYSTEM tree (redirect, tee, cp/mv, sed -i, writeFileSync), scan the whole command text against the deny-list; blocks on hit | `lib/system-file-guard-core` | none |
| `CheckpointPerISC.hook.ts` | PostToolUse: Write, Edit, MultiEdit (timeout 30) | git commit per ISC `[ ]` to `[x]` transition in repos listed in `~/.claude/checkpoint-repos.txt`; stages only paths dirty since the ISA's `started` | none | none |
| `CommunicationSkillGuard.hook.ts` | PreToolUse:Bash via PreToolGuard | block raw `gmail.ts send` / `aws ses send-email` not routed through a communication skill | none | none (irrelevant without those tools) |
| `ComplexityRatchet.hook.ts` | PostToolUse: Write, Edit, MultiEdit | advisory complexity-drift meter | none | none |
| `ConfigEvalFire.hook.ts` | PostToolUse: Write, Edit, MultiEdit | when CLAUDE.md / OPERATIONAL_RULES / system prompt / identity / a hook changes, debounce and spawn `LIFEOS/TOOLS/ConfigEvalOnChange.ts` detached (behavioural eval suite, subscription billed); never blocks | ConfigEvalOnChange, Evals skill | light (spawns local inference) |
| `ContextReduction.hook.sh` | PreToolUse:Bash | rewrite `git`/`gh` commands to `rtk` equivalents to compress output; inert without `rtk` and `jq`; never rewrites read-path commands | rtk, jq | none |
| `DeployRegistrationGate.hook.ts` | Stop via StopGates | a `wrangler deploy` that attached a custom domain must leave the domain registered in PROJECTS.md and the Bunker infra inventory | `lib/hook-io` | none (Cloudflare-specific) |
| `DocIntegrity.hook.ts` | SessionEnd | if system docs/hooks changed, run deterministic cross-ref checks plus inference semantic drift (`handlers/DocCrossRefIntegrity.ts`, Inference.ts medium) and regenerate ARCHITECTURE_SUMMARY (`handlers/RebuildArchSummary.ts`) | handlers, Inference.ts | light |
| `DriftReminder.hook.ts` | UserPromptSubmit | per-turn PRE-WRITE format contract: line budget for this turn, banner-first / closer-last / em-dash cap, what the previous response broke (measured from `last-response.txt`), banned vocabulary | `lib/banned-vocab` | none |
| `EgressClassGuard.hook.ts` | PreToolUse:Bash via PreToolGuard | block Tier-2 inference calls (`OpenRouter.ts`) whose payload is classified above the route's data-class ceiling; fail-CLOSED on confirmed Tier-2 calls | `lib/egress-class-core`, models.ts `maxClassForRoute` | none |
| `EventLogger.hook.ts` | PostToolUse (all), PostToolUseFailure, StopFailure, ConfigChange | unified append-only observability: `tool-activity.jsonl`, `MEMORY/SKILLS/execution.jsonl`, `tool-failures.jsonl`, stop-failures, `config-changes.jsonl` plus ISA heartbeat bump | `lib/skill-notify-core` | light (imports skill-notify-core; log-only, "re-adding voice is a regression") |
| `FormatGate.hook.ts` | Stop via StopGates | deterministic structural check of the ONE format; observation-only since 2026-07-12 (logs to `format-gate.jsonl`) | `lib/hook-io` | none |
| `HookHealer.hook.ts` | SessionStart (`bun` prefixed, timeout 10) | chmod +x every script a settings hook command executes; `--posttool` mode heals at write time | none | none |
| `ISACloseGate.hook.ts` | Stop via StopGates | block a completion claim on an active run whose ISA is stale (>= 10 tool calls since last ISA edit), once per run | `VerificationGate`, `lib/transcript-evidence`, `lib/isa-utils` | none |
| `ISAFoldGate.hook.ts` | Stop via StopGates | "prod mutated, ISA untouched": a turn with a successful deploy / remote D1 write / `wrangler secret put` / `--apply` tool and no ISA edit blocks until the fold or an honest "no ISA delta needed" | same | none (patterns are Cloudflare-flavoured) |
| `ISAGate.hook.ts` | Stop via StopGates | structural gate at `phase: complete` for an ISA written THIS turn: progress-format, fog-at-complete, anchors-missing HARD violations block | `../LIFEOS/TOOLS/ISAGate` | none |
| `ISARenderOnStop.hook.ts` | Stop | re-render ISA.html for ISAs edited this turn, only if the html already exists | `LIFEOS/TOOLS/ISARender.ts` | none (produces the Pulse-visible HTML mirror; optional) |
| `ISAStaleWriteGuard.hook.ts` | PreToolUse:Write via PreToolGuard; PostToolUse Read, Write, Edit, MultiEdit | records this session's content hash of any ISA it read; blocks a whole-file Write when disk moved since; "NOT A LOCK" | none | none |
| `ISASync.hook.ts` | PostToolUse Write, Edit, MultiEdit (and Read) | ISA frontmatter to `MEMORY/STATE/work.json`; resume-after-complete bump; emits the `<lifeos-ascent-delta>` strip when the derived state changed; per-session state for ISARenderOnStop | `../LIFEOS/TOOLS/ascent` | light (README says "KV push"; the file itself has no fetch) |
| `IntegrityCheck.hook.ts` | SessionEnd | detect system-file changes in the transcript and spawn `IntegrityMaintenance` | `handlers/SystemIntegrity`, `lib/change-detection` | light |
| `KittyEnvPersist.hook.ts` | SessionStart | persist `KITTY_LISTEN_ON`/`KITTY_WINDOW_ID`, reset tab title | none | hard (Kitty) |
| `KnowledgeWriteGuard.hook.ts` | PostToolUse Write, Edit, MultiEdit | advisory schema feedback when a `MEMORY/KNOWLEDGE/<Type>/<slug>.md` note is written off-schema | `lib/paths`, MemorySystem schema | none |
| `LastResponseCache.hook.ts` | Stop | write `MEMORY/STATE/last-response.txt` for SatisfactionCapture and DriftReminder | none | none |
| `LoadContext.hook.ts` (590 lines) | SessionStart | inject dynamic context: relationship notes, learning readback, advisory readback, active work summary (last 48h) as a system-reminder; toggles in `settings.json dynamicContext` | `lib/learning-readback`, `lib/advisory-readback` | none |
| `LoadMemory.hook.ts` | UserPromptSubmit via MemoryTurnStart | inject the two hot-layer files `USER/PRINCIPAL/PRINCIPAL_MEMORY.md` and `USER/DIGITAL_ASSISTANT/DA_MEMORY.md` (48 entries x 256 chars each) as `<lifeos-memory>` | `../LIFEOS/TOOLS/MemoryWriter` | none |
| `LoopDetector.hook.ts` | PostToolUse (catch-all), PostToolUseFailure | `[LOOP DETECTED]` additionalContext for exact repeats of the same tool+input, a-b-a-b oscillation, and hammering (same tool in quick succession with >= 3 failures); cooldown 4 | none | none |
| `MemoryDeltaSurface.hook.ts` | UserPromptSubmit via MemoryTurnStart | emit the verbatim `🧠 MEMORY:` line (delta or heartbeat) plus `<lifeos-memory-health>` when critical | none | none |
| `MemoryHealthGate.hook.ts` | Stop (async, 15), SessionEnd | run `LIFEOS/TOOLS/MemoryHealthCheck.ts`, surface WARN/CRITICAL to stderr; never blocks | MemoryHealthCheck | none |
| `MemoryReviewFire.hook.ts` | Stop | owns the memory-review cadence (`USER/CONFIG/memory-review.json`: turn_threshold 8, min 30 minutes, idle 2, confidence 0.70); spawns `LIFEOS/TOOLS/MemoryReviewer.ts` detached (inference) | MemoryReviewer | light |
| `MemoryTurnStart.hook.ts` | UserPromptSubmit (timeout 8) | the ONE per-prompt memory hook: dispatches LoadMemory (first prompt, on change, or every N turns) and MemoryDeltaSurface; also imports SystemChangeSurface and MemoryRetriever | above | none |
| `ModelRungGuard.hook.ts` | UserPromptSubmit (async, 5) | compare `settings.json model` pin with the model on the last assistant transcript row; report the gap and the sanctioned move; never changes the model | none | none |
| `PostToolObserver.hook.ts` | PostToolUse (empty matcher) | the ONE sync catch-all: LoopDetector + AlgorithmNudge + SystemChangeSurface joined into one `hookSpecificOutput` | those three | none |
| `PreToolGuard.hook.ts` | PreToolUse Bash, Write, Edit, MultiEdit | the ONE blocking dispatcher: Write/Edit/MultiEdit to SystemFileGuard then ISAStaleWriteGuard; Bash to BashSystemWriteGuard, CommunicationSkillGuard, EgressClassGuard, PublicPushGate, VoiceEgressGuard; each in its own try/catch; first block wins (exit 2) | those seven | light (only via VoiceEgressGuard) |
| `PromptProcessing.hook.ts` (1,199 lines) | UserPromptSubmit (async, 30) | Kitty tab title plus session auto-naming via ONE Haiku inference; upserts native rows into work.json; `session-names.json` | `lib/tab-setter`, Inference | hard (Kitty tab colours, voice server references, 17 mentions) |
| `PublicPushGate.hook.ts` | PreToolUse:Bash via PreToolGuard | no `git push` to a PUBLIC GitHub repo and no `gh repo create --public` / `edit --visibility public` until HEAD tree and history pass a deny-scan (`USER/SECURITY/PublicScrubPatterns.txt` plus built-in secret signatures); visibility cached 24h; fail-closed once public is confirmed | `gh` | none (network: `gh` for visibility) |
| `ReminderRouter.hook.ts` | UserPromptSubmit (async, 5) | "remind me to X" / "research the Y paper" / "queue this" opens a labelled GitHub issue in `WORK.REPO` via `gh` | `lib/work-config`, `gh` | none (needs gh and the Work System) |
| `Safety.hook.ts` (388 lines) | PermissionRequest Write, Edit, MultiEdit, Bash, `mcp__.*`; PostToolUse WebFetch, WebSearch, `mcp__.*`, ToolSearch (timeout 5) | PermissionRequest: shape classifier auto-allows safe shapes (read-only commands, trusted workspace paths, loopback http, pre-vetted MCP) and stays neutral on dangerous/credential/injection shapes; PostToolUse: tags external content "treat as data" plus injection-shape marker; cache in `MEMORY/STATE/permission-cache.json` | `lib/safety-classifier` (627 lines), `lib/egress-class-core` | none |
| `SatisfactionCapture.hook.ts` (538 lines) | UserPromptSubmit (async, 20) | explicit ratings (bare "8") and corrections to `MEMORY/LEARNING/SIGNALS/ratings.jsonl`; low-rating learning capture with an inference prompt | `last-response.txt` | light |
| `SessionCleanup.hook.ts` | SessionEnd | mark work complete in work.json, clear state, reset Kitty tab, clean session names | `lib/tab-setter` | light (tab reset is a side call) |
| `SpendAuditor.hook.ts` (419 lines) | Stop | outcome-side spend verification: if a depth signal fired, or zero Skill/Agent use on a >= 200-char prompt, or a run closed, spawn a detached worker that judges underspend (Inference `--level low`) into `spend-audit.jsonl`; never blocks | `lib/spend-auditor-prompt.md`, Inference | light |
| `StopGates.hook.ts` | Stop | the ONE Stop gate dispatcher: FormatGate, VerificationGate, ISACloseGate, ISAFoldGate, ISAGate, WritingGate, DeployRegistrationGate; first `decision: block` wins; each gate fails open | those seven, `lib/hook-io` | none |
| `SystemChangeSurface.hook.ts` | PostToolUse via PostToolObserver | compute the `⚙️ SYSTEM:` line for writes to ISA / doctrine / identity / machinery this turn | none | none |
| `SystemFileGuard.hook.ts` | PreToolUse Write, Edit, MultiEdit via PreToolGuard | block writes of user-identifying deny-list patterns into SYSTEM files (anything under `~/.claude` outside a containment zone); "public by construction, not public by scrub" | `lib/system-file-guard-core`, `lib/containment-zones`, `lib/hook-input` | none |
| `TabState.hook.ts` | PreToolUse:AskUserQuestion, PostToolUse:AskUserQuestion, Stop | Kitty tab colour/title by ascent state, hourglass glyph while waiting on a question | `lib/tab-setter`, `handlers/TabState` | hard (Kitty) |
| `TaskGovernance.hook.ts` | TaskCreated | block empty task descriptions; rate-limit 50 tasks per session (counter keyed on ppid in /tmp) | none | none |
| `TimeContext.hook.ts` | UserPromptSubmit (async, 5) | inject a live wall-clock line every turn (`settings.json principal.timezone`, UTC fallback) | none | none |
| `UpdateCounts.hook.ts` | SessionEnd | refresh skill/hook counts in settings.json and the Anthropic usage cache (`api.anthropic.com/api/oauth/usage`, cost_report) for the statusline | `handlers/UpdateCounts` | light (network to Anthropic; statusline consumer) |
| `VerificationGate.hook.ts` (482 lines) | Stop via StopGates | "THE MESSAGE IS A CLAIM; THE TRANSCRIPT IS THE EVIDENCE": blocks T1 web-deploy / T2 interactive-flow / T3 visual-appearance / T5 publicity claims when the transcript shows no post-mutation probe of the right type; T4 code-logic log-only | `lib/transcript-evidence` (291 lines), `lib/hook-io` | none |
| `VersionDrift.hook.ts` | UserPromptSubmit (async, 10) | nag when the core surface drifted past the last vX.Y.Z tag without a bump (Ledger) | git | none (Ledger-specific) |
| `VoiceCompletion.hook.ts` | Stop | extract the `🗣️` line and POST to the ElevenLabs voice server | `handlers/VoiceNotification`, `lib/notification-channel` | hard |
| `VoiceEgressGuard.hook.ts` | PreToolUse:Bash via PreToolGuard | block Bash curls to speaker endpoints (`/notify`, `/pai`, `/voice`) in headless sessions | `lib/notification-channel` | hard |
| `WorkCompletionLearning.hook.ts` | SessionEnd | write a learning file from work.json metadata (files changed, tools used, ISCs) into `MEMORY/LEARNING/` | `lib/learning-utils`, `lib/isa-utils` | none |
| `WritingGate.hook.ts` | Stop via StopGates | authored outbound prose must have a fresh `PangramScore.ts` run logged (execution artifact, not a typed token); blocks only on STRONG publication signals (#ad line, hashtag cluster, "Rewritten version:", blog frontmatter) | `LIFEOS/TOOLS/PangramScore.ts` (PANGRAM_API_KEY) | none (external Pangram API) |

Shared libs of note: `lib/hook-io.ts` (stdin reader plus transcript parser for Stop hooks), `lib/hook-input.ts`, `lib/transcript-evidence.ts`, `lib/safety-classifier.ts`, `lib/system-file-guard-core.ts`, `lib/egress-class-core.ts`, `lib/banned-vocab.ts` (delve, leverage, robust, seamless, tapestry, ...), `lib/subagent.ts` ("the single answer to am I running inside a subagent"), `lib/resolve-bin.ts` (absolute bun path for detached spawns), `lib/isa-utils.ts`, `lib/work-events.ts`, `lib/tab-setter.ts` and `lib/tab-constants.ts` (Kitty), `lib/notification-channel.ts` and `lib/notifications.ts` (voice, ntfy), `lib/containment-zones.ts` (release zones).

### Groups

(a) Quality and verification gates worth keeping: StopGates + VerificationGate + ISAGate + ISACloseGate + ISAFoldGate (trim the wrangler patterns) + FormatGate + DriftReminder + LoopDetector + ComplexityRatchet + ModelRungGuard + SpendAuditor (optional, spawns inference) + TimeContext + HookHealer + TaskGovernance + ConfigEvalFire (only if you adopt the Evals skill) + WritingGate (only with a Pangram key; otherwise drop).

(b) Memory and ISA plumbing: ISASync, ISAStaleWriteGuard, CheckpointPerISC, ISARenderOnStop, LastResponseCache, MemoryTurnStart + LoadMemory + MemoryDeltaSurface, MemoryReviewFire, MemoryHealthGate, KnowledgeWriteGuard, LoadContext, WorkCompletionLearning, SessionCleanup (tab call removed), EventLogger, AgentInvocation, PostToolObserver, SystemChangeSurface, SatisfactionCapture, UpdateCounts (Anthropic usage call optional).

(c) Security guards: PreToolGuard + SystemFileGuard + BashSystemWriteGuard + PublicPushGate + EgressClassGuard + CommunicationSkillGuard + Safety (PermissionRequest auto-allow and external-content tagging) + DeployRegistrationGate (Cloudflare only) + IntegrityCheck/DocIntegrity.

(d) Voice / Pulse / Kitty / notification: VoiceCompletion, VoiceEgressGuard, TabState, KittyEnvPersist, PromptProcessing (tab title half; the session-naming half is worth keeping), the two `type: http` Pulse routes (skill-guard, agent-guard), AtlasEventCapture, `lib/notifications.ts`, `lib/notification-channel.ts`, `lib/tab-*`, `handlers/VoiceNotification.ts`, `handlers/TabState.ts`.

(e) Misc: ContextReduction.hook.sh (rtk), ReminderRouter (GitHub issues), VersionDrift (Ledger), the inline SessionStart `FreshnessCache.ts` (statusline) and `SettingsBackport + MergeSettings` (settings layering).

### New versus Harry's pai hooks

New in LifeOS (not in Harry's 46): AlgorithmNudge, AtlasEventCapture, BashSystemWriteGuard, CommunicationSkillGuard, ComplexityRatchet, ConfigEvalFire, DeployRegistrationGate, DriftReminder, EgressClassGuard, EventLogger, FormatGate, HookHealer, ISACloseGate, ISAFoldGate, ISAGate, ISARenderOnStop, ISAStaleWriteGuard, KnowledgeWriteGuard, LoadMemory, LoopDetector, MemoryDeltaSurface, MemoryHealthGate, MemoryReviewFire, MemoryTurnStart, ModelRungGuard, PostToolObserver, PreToolGuard, PublicPushGate, ReminderRouter, Safety, SpendAuditor, StopGates, SystemChangeSurface, SystemFileGuard, TabState, TimeContext, VerificationGate, VersionDrift, VoiceEgressGuard, WritingGate.

Harry's hooks that no longer exist upstream: AgentExecutionGuard, ContainmentGuard, ContentScanner, ElicitationHandler, FileChanged, KVSync, PRDSync, PreCompact, RestoreContext ("compaction handover is handled by the harness's own summarization"), PromptGuard, SecurityPipeline, SecurityValidator, SmartApprover (their roles now sit in `Safety.hook.ts` plus native `permissions.deny`), SkillGuard (now a Pulse HTTP route), TeammateIdle, TelosSummarySync (now `DerivedSync.ts` under launchd), RatingCapture (renamed SatisfactionCapture), SessionAutoName and UpdateTabTitle (folded into PromptProcessing), RepeatDetection (replaced by LoopDetector), ConfigAudit / InstructionsLoadedHandler / StopFailureHandler / ToolActivityTracker / ToolFailureTracker (folded into EventLogger), SetQuestionTab / QuestionAnswered / ResponseTabReset (folded into TabState), RelationshipMemory (folded into MemoryReviewFire).

### The named hooks in detail

- **FormatGate** (195 lines, Stop via StopGates, v1.0.1). Deterministic structural checks on the ONE format: banner `════ LifeOS` first visible line, `🗣️` closer last, `🧠 MEMORY:` present when a `<lifeos-memory-delta>` arrived, `⚙️ SYSTEM:` when a system delta arrived, "No more than 2 em-dashes in prose (code/blockquote stripped)". OBSERVATION-ONLY since 2026-07-12: a Stop hook "cannot edit emitted text; its only enforcement move is decision:block, which forces a FULL re-emit of the whole response", which doubled output; so it logs to `format-gate.jsonl` and returns null. Fails open, no network.
- **DriftReminder** (253 lines, UserPromptSubmit). The pre-write half of the same contract, born from measurement: "0% violations across 168 turns while it blocked (Jul 10-11), then 61-91% EVERY DAY across 2,608 turns once it only logged". Emits every turn: the line budget for this turn (lifted when the prompt asks for depth), the structural rules, what the previous response actually broke (measured from `last-response.txt`), banned vocabulary from `lib/banned-vocab.ts`. No inference. Directly relevant to Harry's em-dash rule: the pair FormatGate + DriftReminder is the upstream mechanism for that.
- **WritingGate** (254 lines, Stop via StopGates). For authored outbound prose (posts, newsletters): the pass condition is "an EXECUTION ARTIFACT, not a self-authored string": `PangramScore.ts` must have logged a fresh run whose SHA matches a deliverable block. Blocks only on strong publication signals. Needs `PANGRAM_API_KEY`; Pangram is "REPORTED, never thresholded".
- **VerificationGate** (482 lines, Stop via StopGates, v1.0.6). Detects claims in the last message (with negation, question, future, conditional, quote, narration and honest-downgrade guards), detects evidence ONLY from the transcript's tool calls (`lib/transcript-evidence.ts`), requires ACT-THEN-CLAIM (the turn actually mutated something of the claimed type), blocks when type-scoped evidence is absent or stale after the last mutation, skips when a subagent ran this turn (evidence invisible) and dedupes by fingerprint. T1 web-deploy / T2 interactive-flow / T3 visual-appearance / T5 publicity block; T4 code-logic log-only. Env: `VERIFGATE_T5=logonly` or `off`. The evidence types are Interceptor-shaped (screenshot, real browser); porting to Harry's Claude-in-Chrome setup means editing the evidence detectors.
- **StopGates** (91 lines). Reads stdin once and runs the gates in order FormatGate, VerificationGate, ISACloseGate, ISAFoldGate, ISAGate, WritingGate, DeployRegistrationGate; "the FIRST gate returning a decision:block wins"; every gate wrapped in try/catch; "always exit 0".
- **ComplexityRatchet** (247 lines, PostToolUse Write/Edit/MultiEdit). "Inspired by github.com/0xwilliamortiz/ratchet": measures complexity a session ADDS (blob size, dependency growth) with generous budgets; v1 advise-only via additionalContext; `MODE` constant is the future strict tier; "Fail-open is absolute".
- **ModelRungGuard** (201 lines, UserPromptSubmit). Reads the `model` pin from settings.json and the model on the last assistant transcript row (tail read, sidechain rows skipped); when below the pin, injects one line stating the gap and the sanctioned move (OPERATIONAL_RULES § Model selection). Never changes the model ("a hook cannot set the main loop's carrier"). Born 2026-07-31 when "a session ran a rung below the pin for its entire length... the only detection in the end was the principal getting angry twice". Also exports `liveModel()` used by AgentInvocation.
- **LoopDetector** (235 lines, PostToolUse catch-all plus PostToolUseFailure). Per-session state in `MEMORY/STATE/`; three detectors: exact repeat (same tool plus same input N times), oscillation (a-b-a-b between two tools), hammering (same tool in quick succession with >= 3 failures); `[LOOP DETECTED] ...` as additionalContext; COOLDOWN 4 per episode; 10 MB stdin cap. Note the finding that "A failed tool call does NOT emit PostToolUse", hence the dual registration.
- **HookHealer** (210 lines, SessionStart, `bun` prefixed). Sweeps every script named as the first token of a settings hook command; missing exec bit gets `chmod +x` (only under `~/.claude`); missing file or shebang is warned; logs to `hook-healer.jsonl`; `--posttool` mode heals at ingestion. Solves the real "Write tool creates 0644, hook dies with Permission denied" class.
- **SpendAuditor** (419 lines, Stop). Triggers: a depth signal fired this session, zero Skill/Agent calls with a >= 200-char last prompt, or a run closed in the last 10 minutes; spawns a detached, unref'd worker running Inference at `--level low` (about 90 s) writing verdicts to `spend-audit.jsonl` and underspend at confidence >= 0.6 to `capability-incidents.jsonl`. "NON-BLOCKING BY DESIGN. A Stop-blocking spend gate Goodharts into token dispatches."
- **TimeContext** (44 lines, UserPromptSubmit). Ported from public PR #1511: the harness `currentDate` is date-only and anchored at session start, so this injects `additionalContext` with the live time, date and weekday from `settings.json principal.timezone`. Trivially portable; probably the first hook to copy.
- **ISAGate** (75 lines, Stop via StopGates; logic in `LIFEOS/TOOLS/ISAGate.ts`). Fires only when an ISA was written THIS turn and is at `phase: complete`; blocks on HARD violations: progress-format, fog-at-complete, anchors-missing ("92 no-anchors, 60 no-anti, 14 fog-at-complete; 2026-07-23 audit"). `ISAGATE_OFF=1` kill switch.
- **ISACloseGate** (176 lines). Blocks once per run when the message asserts completion, the session is bound to an active run, no ISA edit and no subagent this turn, and >= `ISACLOSEGATE_THRESHOLD` (10) tool calls since the last ISA edit (counter maintained by AlgorithmNudge). Passes if the message honestly addresses ISA state ("no ISA delta needed").
- **ISAFoldGate** (143 lines). Same conditions but keyed on a SUCCESSFUL prod-mutating call this turn (deploy event, `wrangler d1 execute ... --remote` write, `wrangler secret put`, remote KV put/delete, or an own tool run with `--apply`); no once-per-run latch. For myos the command shapes would need to become Harry's own (`~/bin/publish`, `git push`, launchctl, ...).
- **ISAStaleWriteGuard** (198 lines). Two entry points: PostToolUse records a content hash of any ISA this session read or wrote; PreToolUse:Write blocks a whole-file Write when the on-disk hash differs ("Edit is SAFE... Write DESTROYS SILENTLY"). "NOT A LOCK... NOT A TICKET SYSTEM." Fail-open everywhere.
- **AlgorithmNudge** (916 lines, v3.2.2). Rows: skill-routing (prompt matches a skill's USE WHEN phrases, index at `MEMORY/STATE/skill-usewhen-index.json`, rebuilt detached with `--rebuild-index`; noise guards: single words >= 6 chars, multiword >= 7, more than 6 matches is silence, 60-minute per-skill cooldown), depth-directive, design-class, late-ISA (25+ tool calls with no run), stale-isa, exec-delegation (long Edit/Write stretch with zero Agent dispatches), inherited-dispatch (Agent call with no `model` field), capability (a Bash failure on a Doctor-tracked broken capability emits its fix command). All advisory: "A Stop-blocking variant was adversarially killed... it Goodharts into token dispatches". State in `MEMORY/STATE/isa-nudge/{session_id}.json`. Depends on `deriveAscent` and the Doctor manifest; otherwise local.
- **MemoryHealthGate** (55 lines). Runs `MemoryHealthCheck.ts` at Stop (async) and SessionEnd, surfaces WARN/CRITICAL on stderr, never blocks. Only meaningful if you adopt the Cortex hot-layer files and reviewer.
- **BashSystemWriteGuard** (120 lines). Closes the 2026-08-11 incident where a heredoc redirected into `hooks/<file>` "carried a principal path literal into the SYSTEM tree": write-shaped Bash into the SYSTEM tree is deny-scanned as text. Honest residual: content via variables, template files or network is invisible.
- **SystemFileGuard** (146 lines plus 266-line core). Deny-list (release skill's identity patterns) against SYSTEM-file writes; USER zone and out-of-tree writes allowed; exit 2 to deny; fail-open. Only matters if myos keeps a public/private split of the same tree; for a purely private system this is dead weight.
- **PublicPushGate** (187 lines). Push-shaped Bash to a confirmed-public GitHub remote, or `gh repo create --public` / `edit --visibility public`, must pass a deny-scan of the HEAD tree AND reachable history (patterns from `USER/SECURITY/PublicScrubPatterns.txt` plus built-in secret signatures); visibility cached 24h in `MEMORY/STATE/public-push-gate.json`; fail-open when visibility is undetermined, fail-closed once public is confirmed. Directly relevant to Harry's `harryf.github.io` publishing.
- **EgressClassGuard** (126 lines plus core). Classifies the payload of `OpenRouter.ts` (Tier-2 inference) Bash calls against the route's data-class ceiling from `models.ts`; blocks secrets or `LIFEOS/USER/**` refs going to a broker route; fail-closed on Tier-2 calls, allow otherwise. Only meaningful with LifeOS's OpenRouter tool.
- **TaskGovernance** (66 lines, TaskCreated). Same as Harry's: blocks empty descriptions, 50 tasks per session; the counter is keyed on ppid in `/tmp`.

---

## 4. Claude model leverage and the other named systems

Model and harness facts, as shipped:

- **Rungs**: `LIFEOS/TOOLS/models.ts` holds data only. `EFFORT_MODEL = {max: "fable", high: "opus", medium: "sonnet", low: "haiku"}` ("Prefer a tier ALIAS everywhere: the claude CLI resolves an alias to the latest model in that tier"), `CURRENT` pinned IDs (`claude-fable-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`), `UNIFORM_HARNESS_EFFORT = "high"` ("Every rung thinks at high; the MODEL rung still varies"), `DISPATCH_EXECUTES_FABLE = true` (probed by `CarrierProbe.ts`), `CROSS_VENDOR` pins (gpt-5.6-sol for Forge and CodexResearcher, gemini-3.6-flash, gemini-3.1-pro-preview, grok-4.6 with a hard "non-sensitive only" ceiling, z-ai/glm-5.2 via OpenRouter). Three level dials named: model rung, reasoning effort (owned by Claude Code; "a hook can read it but cannot set the main loop's value"), composition (ultracode as multi-agent Workflow, "Not an effort level").
- **Rung policy** (`OPERATIONAL_RULES.md § Model selection`, a stub in the payload): "Three rungs. MAX to think, HIGH to execute, MEDIUM when execution is trivial... The main loop runs the top rung; settings.json pins it. Never ask which rung to use... Safe default if you never edit this: run everything on the session's pinned model." Enforced softly by ModelRungGuard (report) and the AlgorithmNudge exec-delegation and inherited-dispatch rows (a dispatch with no `model` inherits the top rung and "one line surfaces that fact so inheriting is a decision, not the silent default").
- **Effort / thinking**: no `/effort` automation anywhere (changelog 6.11: "a hook cannot set it per turn (confirmed against Claude Code hooks docs)"). Doctrine flattened reasoning effort to uniform `high` (6.26). No extended-thinking or ultrathink triggers in the constitution; BeCreative and IterativeDepth skills invoke thinking in prose.
- **Context management**: the 100k "smart zone" rule and "resume reads the artifact, never the conversation"; MemoryTurnStart injects the hot layer only on the first prompt, on change, or every N turns ("injecting it EVERY prompt duplicated it dozens of times per session"); `skillListingBudgetFraction: 0.15`; ContextReduction (rtk) for git/gh output; Trim skill for oversized always-on files; no PreCompact/PostCompact hooks by decision.
- **Prompt caching**: not mentioned anywhere in the payload (zero hits for "prompt cach" across DOCUMENTATION, hooks, skills).
- **Subagents / agent teams / worktrees / background**: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `CLAUDE_CODE_FORK_SUBAGENT=1`, `MAX_CONCURRENT_SUBAGENTS=20`, `SPAWN_DEPTH=3`, `teammateMode: auto`, `worktree.baseRef: head`, `EnterWorktree`/`ExitWorktree`, `TeamCreate`/`TeamDelete`/`SendMessage` all allowed. The Delegation doc is marked RETIRED ("agent orchestration is native harness surface"). Doctrine facts: a forked subagent "inherits the build context and counts as the builder" so second looks are non-forked; delegate liveness (one nudge then FAILED); "the Workflow tool joins the capability menu for large elected fan-outs (per-run token budget, schema-forced agent output, pipelining)". Subagents are detected by `lib/subagent.ts`; `AgentInvocation` logs every dispatch and resolved model; `TaskGovernance` rate-limits.
- **Model-facing plugins**: `enabledPlugins` code-review, pr-review-toolkit, typescript-lsp, swift-lsp from `claude-plugins-official`.

Named systems:

| System | What it is | Server or external service? | Worth carrying into a lean local system? |
|---|---|---|---|
| ModelRungGuard / models.ts / rungs | see above; roles-not-models policy, pin in settings.json, report-only guard | none | Yes: `models.ts` (trimmed to Claude tiers) plus the rung paragraph plus ModelRungGuard; add `"model"` to settings yourself |
| Hermes sidecar (`LIFEOS/HERMES/`, `DOCUMENTATION/Hermes/HermesSidecar.md`) | Nous Research's Hermes agent mounted on the LifeOS tree as "a second front door" (terminal now, messaging later); `Mount.ts` installer, a Python plugin `guard.py`, heartbeat scripts, `RenderSoul.ts` | Yes: a separate agent install (`hermes-agent.nousresearch.com/install.sh`), Python | No |
| Cortex (`LIFEOS/TOOLS/Cortex.ts`, `CortexAdapter.ts`, `skills/Cortex`, `DOCUMENTATION/Memory/`) | the memory system as a product: file-backed `MEMORY/` tree, BM25 over canonical markdown, a versioned JSON envelope CLI (`status search timeline get export rebuild remember propose`), `CORTEX_INDEX_POLICY.json` = `no-index-v1` | No: "a local Bun CLI over the existing file-backed memory system. It is not an MCP server, HTTP service, daemon" | Partly: the file layout and the hot-layer files; the CLI is optional |
| Synapse (`DOCUMENTATION/Synapse/`) | input router: capture, amber ledger (write-ahead journal), grade vs TELOS, route; implementation is private (Arbol workers) | Yes (Cloudflare) and not shipped | No |
| Atlas (`LIFEOS/ATLAS/`) | asset graph of domains, DNS, workers, repos, devices in SQLite (`~/.local/state/lifeos/atlas/atlas.db`), launchd 15-minute tick, Pulse `/atlas` page | launchd service plus Pulse for the UI; Cloudflare collectors | No (unless Harry wants an asset inventory; the CLI is local) |
| Ledger (`DOCUMENTATION/Ledger/`) | change tracking: Major.Feature.Patch versioning of every component, update registry, integrity gate `/ic`, VersionDrift hook | tooling is private ("NOT in the public release payload") | No; only VersionDrift ships and it needs the private registry |
| Bunker (`DOCUMENTATION/Bunker/`) | universal application harness concept (six planes, ISA as test suite); reference implementation private | not shipped | No (concept only) |
| Arbol (`DOCUMENTATION/Arbol/`) | Cloudflare Workers execution layer (Actions, Pipelines, Flows) | Cloudflare; not shipped | No |
| LocalIntelligence (`skills/LocalIntelligence`, 27 files) | civic digest for a US city (permits, crime, officials) feeding a Pulse tab; uses ANTHROPIC_API_KEY | Pulse consumer, US-only data | No |
| CMUX (`skills/CMUX`) | drives the cmux terminal multiplexer as an "agent cockpit" (boot team, race, fleet, monitor); Mac only; live driving "UNPROVEN" | cmux app plus socket auth | No |
| Loop (`skills/Loop`, `ALGORITHM/ideate-loop.md`) | `/loop --target --iterations`: repeated full Algorithm cycles with human review between, `--autoresearch` for unattended cycles with a Dead Ends ledger and MAD confidence gating | none | Maybe: it is prose only (one SKILL.md, no tools) |
| Optimize (`skills/Optimize`, `ALGORITHM/optimize-loop.md`) | autonomous hill-climb: metric mode (a shell command producing a number) or eval mode (LLM-as-judge over a skill/prompt); Karpathy autoresearch inspired | none | Maybe, same as Loop |
| Trim (`skills/Trim`) | human-gated shrink of an always-on context file: deterministic GC of stale entries via `ProposalGC.ts`, then MERGE/TIGHTEN/RELOCATE | none | Yes, small and useful for CLAUDE.md hygiene |
| Novelty (`skills/Novelty`) | evolutionary explanation-discovery for hard-to-vary causal theories (EvolutionCycle, ExplanatorySelection, RapidCycle) | none | Optional thinking skill |
| SuggestSkills (`skills/SuggestSkills`) | read-only analytics over work history plus ratings to propose which skills to build next | none (reads MEMORY) | Maybe later |
| Teach (`skills/Teach`, `/teach-me`, `/tm`) | voice-narrated Socratic tutorial with ASCII diagrams | voice server | No (voice) |
| Vitals (`skills/Vitals`) | read-only macOS performance diagnostics CLI plus interpretation | none | Optional utility |
| Interceptor 4.3.18 | real Chrome/Brave plus macOS computer use from inside the browser; 20 workflows, 11 tools | Chrome extension plus local daemon | Harry already has it (his is broken: "no extensions connected"); the LifeOS version is newer |
| Upgrade (`skills/Upgrade`, `/lu`) | mine Anthropic changelogs, trusted creators, trending repos and the system's own reflections for improvements | WebFetch/WebSearch | Yes if Harry wants a periodic "what did Claude Code ship" pass |
| Doctor (`LIFEOS/TOOLS/Doctor.ts`) | capability prober and TTL'd manifest: codex, interceptor, cloudflare, voice, ripgrep, imagemagick, gh, ffmpeg, yt-dlp, fabric, jq, hook interpreters, identity placeholders; `decline <name>` | none (probes local binaries; `--network` for auth) | Yes, trimmed |
| Inference.ts | standalone leveled inference (`--level low`, `medium`, `high`, `max`) via `claude` subprocess with subscription billing (deletes ANTHROPIC_API_KEY, never `--bare`) | none | Yes (Harry has the older fast/standard/smart version) |

---

## 5. Skills

56 skills under `install/skills/` (Harry's list has 51). One line each; NEW marks skills absent from Harry's list.

| Skill | Note |
|---|---|
| ApertureOscillation 1.0.9 | 3-pass zoom (tactical, strategic, synthesis) |
| Aphorisms 1.1.20 | quote CRUD |
| Apify 1.1.22 | social scraping via Apify actors |
| ArXiv 1.0.9 | paper search |
| Art 1.5.23 | 22 workflows, 12 tools; Nano Banana Pro / Flux |
| AudioEditor 1.0.27 | Whisper plus ffmpeg cleanup |
| BeCreative 1.1.21 | Verbalized Sampling ideation |
| BiasCheck 1.0.3 NEW | three-layer bias analysis of a URL or text |
| BitterPillEngineering 1.0.10 | over-prompting audit |
| BrightData 1.2.20 | tiered scraping |
| CMUX 1.0.5 NEW | cmux agent cockpit (Mac) |
| Cortex 2.1.2 NEW (replaces Knowledge plus ContextSearch) | Knowledge Archive plus recall; `context: fork`; `Tools/ContextSearch.ts` |
| Council 1.1.20 | multi-agent debate |
| CreateCLI 1.1.25 | TS CLI scaffolds |
| CreateSkill 1.1.31 | mandatory skill orchestrator, 7 workflows |
| Daemon 1.0.25 | public daemon profile |
| DetectAI 1.1.2 NEW | AI-writing detection: heuristics, statistics, Pangram, watermark |
| Evals 1.2.29 | assertion-first eval framework, 12 tools |
| ExtractWisdom 1.1.16 | |
| Fabric 1.1.19 | 240 patterns |
| FirstPrinciples 1.1.15 | |
| HTML 1.0.0 NEW | render session output as a designed self-contained HTML artifact (`Tools/Render.ts`) |
| Hardening 1.0.6 NEW | property/mutation testing (fast-check, Stryker, jscpd) |
| ISA 1.1.2 | Scaffold, Interview, Grill, CheckCompleteness, Reconcile, Seed, Append |
| Ideate 1.0.19 | evolutionary ideation |
| Interceptor 4.3.18 | |
| Interview 1.1.13 | evidence-grounded context refresh (TelosFreshness, Oura, Conduit); Phase0Setup on fresh install |
| IterativeDepth 1.1.16 | |
| LifeOS 1.5.43 NEW | the installer skill itself |
| LocalIntelligence 1.0.9 NEW | US civic digest for Pulse |
| Loop 1.0.9 | |
| Migrate 1.0.11 | import external content into the taxonomy |
| Novelty 1.1.0 NEW | explanation discovery |
| Optimize 1.0.12 | |
| PrivateInvestigator 1.1.18 | |
| Prompting 1.1.27 | meta-prompting standards |
| RedTeam 1.1.17 | |
| Remotion 1.2.15 | 35 tool files |
| Research 1.5.16 | 17 workflows |
| RootCauseAnalysis 1.0.7 | |
| Sales 1.0.28 | |
| Science 1.1.18 | |
| SecurityMarketData 1.0.0 NEW | cybersecurity market data (ROS_API_KEY) |
| SuggestSkills 1.0.0 NEW | |
| SystemsThinking 1.0.7 | |
| Teach 1.1.0 NEW | voice tutorial |
| Telos 1.0.46 | personal and project TELOS |
| ThreatModel 1.0.1 NEW | defensive threat model of your own estate (asset graph, risk register) |
| Tldraw 1.0.1 NEW | read/write .tldr canvases |
| Trim 1.0.4 NEW | shrink always-on context files |
| USMetrics 1.0.20 | |
| Upgrade 1.1.26 (renamed from PAIUpgrade) | |
| Vitals 1.0.0 NEW | macOS diagnostics |
| Webdesign 1.2.3 | |
| WorldThreatModel 1.0.18 | |
| WriteStory 1.1.10 | |

In Harry's list but gone upstream: Agents, Browser (Interceptor is the only sanctioned browser), ContentAnalysis, ContextSearch and Knowledge (both into Cortex), Delegation (native harness), Investigation, Media, Scraping, Security, Thinking (umbrella), Utilities, PAIUpgrade (renamed Upgrade).

Almost every skill (including new ones like Vitals, HTML, SuggestSkills, Teach) opens with a "Voice Notification" section that curls `localhost:31337/notify` and a "Customization" section reading `USER/CUSTOMIZATIONS/SKILLS/<Skill>/PREFERENCES.md`. VoiceEgressGuard exists precisely because "~500 call sites across SKILL.md/workflow files" curl the speaker. Stripping voice from skills is a mechanical sed over one section per file.

### Skill format conventions

`skills/CLAUDE.md`: "Creating, modifying structure of, or validating any skill under this directory REQUIRES invoking Skill("CreateSkill") first. Reading CreateSkill's workflows and executing the steps by hand is NOT compliance". Direct edits allowed for typos, gotchas sections, reference entries.

From `CreateSkill/SKILL.md` and `DOCUMENTATION/Skills/SkillSystem.md`:
- Frontmatter keys in use across the 56 skills: `name` (56), `version` (56), `description` (56), `context: fork` and `background` (7 each), `disable-model-invocation` (5), `argument-hint` (2), `allowed-tools` (1), `disallowed-tools` (1), `license` (1).
- `description` carries the routing: a one-paragraph capability statement, then `USE WHEN <comma-separated trigger phrases>` and `NOT FOR <confusable skill> (use X)`. Hard cap 1,024 characters ("This file's own description is at ~1022 chars, 2 under the 1024 cap"). AlgorithmNudge parses these USE WHEN clauses into its index.
- `version:` is per-skill semver `Major.Feature.Patch` ("the middle number is Feature, not minor"); a new skill starts at 1.0.0; bumped at ship time by a private `BumpSkillVersions.ts`, so public installs do not need to bump.
- Structure is flat, two levels max: `SKILL.md`, `Workflows/*.md` (execution workflows only, TitleCase), `Tools/*.ts` (executables, TitleCase), optional `References/`. "THREE levels: NO."
- Naming: public skills `TitleCase`, private skills `_ALLCAPS` (leading underscore is the release boundary); `name:` must match the directory.
- Body sections: What It Does, The Problem, How It Works, Workflow Routing table (trigger to `Workflows/X.md`), Customization, Voice Notification, Gotchas, Examples. "Session startup: Only frontmatter loads for routing."
- Enforcement: `LIFEOS/TOOLS/SkillHygieneGate.ts --skill <Name>` (deny-list clean) plus SystemFileGuard.

---

## 6. RULES and LIFEOS_SYSTEM_PROMPT.md

`install/LIFEOS/RULES/`: `Philosophy.md` (70 lines, v1.2.3: what the system is, verification as mechanism, ideal-state prompting and the four keep-classes safety-gates / verified-gotchas / tool-contracts / output-format-contracts), `SelfHealing.md` (52 lines, v1.1.5: the routing table for where a rule belongs; "fix the system, not your notes"; ignore harness auto-memory for rules; the autonomic loop that drafts a red replay fixture instead of a patch), `Verification.md` (49 lines, v2.2.1: the seven incident-derived rules: modality fidelity, unavailable verifier means DEFER, appearance is not existence, reproduce before fixing, temporal fidelity, restore-parity with ownership enumeration, cache fidelity in three places; evidence coverage; viewport is a member type; brief a verifier with steps never the expected result).

`LIFEOS_SYSTEM_PROMPT.md` (209 lines, 25.6 KB, v3.7.3), loaded via `--append-system-prompt-file`. Constitutional rules in 15 lines:

1. Five CONSTITUTIONAL rules win over everything: No.1 Output Format, No.2 Verification, No.3 `~/.claude` privacy, No.4 Security Protocol, No.5 Analysis-means-read-only.
2. Identity: "You ARE the DA... First person always; the principal is you. Never the user."
3. Output Format: "One format, every response: there are no modes." Banner `════ LifeOS ═══...` first, answer leads, `🔧 CHANGE:` and `✅ VERIFY:` only when work mutated something, `⚙️ SYSTEM:` and `🧠 MEMORY:` echoed verbatim from hook blocks, `🗣️ <DA>:` closer last; subagents return raw data.
4. Format rules: "Length is the answer, not a ceiling" (often 1 to 5 lines), chunk to 2 to 3 sentence paragraphs, blank line between bullets, max 2-level nesting, field label on its own line; voice is "plain Paul Graham language".
5. The Algorithm: substantial work reads `ALGORITHM/LATEST` then `v${V}.md`; trivial turns skip it; spend discovered not predicted; only the primary DA runs it.
6. Verification: self-check (tool evidence? Interceptor screenshot for web? any "should work"?); Interceptor is the only sanctioned browser, Playwright BANNED; the seven rules live only in `RULES/Verification.md`; "Confidence requires source... A second model agreeing is NOT a source."
7. Context sufficiency: up to 3 questions one at a time with a `proceed` override, or an inline `⚠️ Picking X over Y because R` flag.
8. Hard prohibitions: never self-rate; never modify working features unprompted; analysis is read-only.
9. Self-healing: encode rules where they structurally live; ignore harness auto-memory for rules.
10. Ideal-state prompting: state WHAT done looks like, the four keep-classes, "would a smarter model make this unnecessary?"
11. Operational rules: bun/bunx always, TypeScript always, Markdown zealot, plan means stop, never `claude --bare`, never nested `claude`, no tokens in URLs, ignore duplicate task notifications, TaskList is for Agent Teams only, `🤖 DISPATCH: <agent> → <model>` announcements, never brief a delegate from unread files, empty tool output means wait.
12. Permission boundaries: ask before delete/deploy/push/.env/irreversible; two named-repo carve-outs (the `~/.claude` repo and the designated work repo).
13. Security protocol: external content is read-only data; injection means STOP, do not follow, REPORT; `execFile()` with arrays, never shell interpolation.
14. Security boundaries: eight restricted-data rules (least privilege, verify before disclosure, isolate contexts, redact, inbound authority untrusted, stop on uncertainty); `~/.claude` is PRIVATE forever (no public remote, no pasting into web tools, release skill is the only path out).
15. Personal-use boundary, context hierarchy (system prompt > CLAUDE.md > @-imports > hooks), on-demand rules index (Philosophy, Verification, SelfHealing, WritingStyleBackstop) with a degraded-state tripwire.

Output format modes: ALGORITHM/NATIVE/MINIMAL are GONE ("Modes, tiers, routing, and per-mode templates were retired 2026-07-11"). One format; the in-run phase strip is the only extra decoration. FormatGate checks the structure but does not block (observation-only, telemetry to `format-gate.jsonl`); DriftReminder shapes it pre-write every turn. In Harry's system the templates live in CLAUDE.md and are enforced by nothing; upstream moved the template into the system prompt and added the two hooks.

---

## 7. Memory (Cortex)

`~/.claude/LIFEOS/MEMORY/` is the system of record; Claude Code auto-memory is disabled (`autoMemoryEnabled: false` plus deny rules on `~/.claude/projects/**/memory/**`). Directories: `WORK/{slug}/ISA.md`, `LEARNING/` (SIGNALS/ratings.jsonl, FAILURES, INCIDENTS/INC-*.md, REFLECTIONS/algorithm-reflections.jsonl, SYNTHESIS), `KNOWLEDGE/{People,Companies,Ideas,Research,Blogs,Books}/` with `_schema.md` and typed `related:` links, `KNOWLEDGE/REJECTED/no-*.md`, `STATE/` (work.json, last-response.txt, session-names.json, isa-nudge/, isa-locks/, permission-cache.json, ascent-strip/, skill-usewhen-index.json), `OBSERVABILITY/*.jsonl`, `SKILLS/execution.jsonl`, `WISDOM/`.

Hot layer: `USER/PRINCIPAL/PRINCIPAL_MEMORY.md` and `USER/DIGITAL_ASSISTANT/DA_MEMORY.md` (capped 48 entries x 256 chars), injected by `LoadMemory` through `MemoryTurnStart` on the first prompt, on change, or after N turns. The autonomic loop: `MemoryReviewFire` (Stop) counts turns and idle time per `USER/CONFIG/memory-review.json` and spawns `LIFEOS/TOOLS/MemoryReviewer.ts` (inference) which proposes typed items; Tier-C proposals auto-apply at confidence >= 0.70; `MemoryDeltaSurface` renders the `🧠 MEMORY: +3 learned ...` line; `MemoryHealthGate` runs `MemoryHealthCheck.ts`; `KnowledgeWriteGuard` nags off-schema notes. Retrieval: `MemoryRetriever.ts` (BM25 plus LLM compression), `KnowledgeGraph.ts`, `Cortex.ts` CLI (`status search timeline get export rebuild remember propose`, `lifeos-cortex/v1` JSON envelope, `<private>...</private>` spans stripped, `CORTEX_INDEX_POLICY.json` says `no-index-v1`: no vector index, BM25 over canonical files).

Server needed: none. Zero `fetch(`/`localhost` hits in `Cortex.ts`, `CortexAdapter.ts`, `MemoryRetriever.ts`, `MemoryWriter.ts`. The reviewer and retriever call `Inference.ts` (a `claude` subprocess), which is local. Pulse only reads the same files.

---

## 8. Agents and commands

`install/agents/` (each with `voiceId` and ElevenLabs `voice:` block, `persona:`, `color:`):
- `ClaudeResearcher.md`: academic researcher on WebSearch, called by Research workflows ("Ava Sterling").
- `CodexResearcher.md`: "Remy", OpenAI flagship via `codex exec`, reasoning_effort high, web search.
- `Forge.md`: OpenAI cross-vendor agent via `codex exec`; `MODE: build` (writes code) or `MODE: audit` (read-only JSON); shares one personality block with Max.
- `Gemini.md`: "Wren", Gemini Pro via `GeminiSearch.ts --pro`, PUBLIC data only, never a second look.
- `GeminiResearcher.md`: "Alex Rivera", Gemini with Search grounding, 3 to 10 query variations.
- `Grok.md`: "Jax", xAI public-lane runner, non-sensitive tasks only (context-recording incident).
- `Max.md`: Anthropic top-rung read-only scrutiny agent, `model: fable`, Edit/Write denied at the permission layer.
- `PerplexityResearcher.md`: "Ava Chen", Perplexity API investigative analyst.

Harry's Cato, Anvil, Engineer, Architect, Designer, Artist, Pentester, Arthur, Silas, Algorithm agents are not upstream (Cato merged into Forge in 6.19; Claude-persona agents retired in 6.23).

`install/commands/`: `context-search.md` and `cs.md` (thin redirects to Cortex recall), `grill-me.md` (ISA Grill workflow: "relentless checkpointed discovery interview... then hands off to ISA Scaffold"), `isdown.md` (`IsDown.ts`, local probe plus downforeveryoneorjustme, `--deep` check-host sweep), `lu.md` (Upgrade skill), `teach-me.md` and `tm.md` (Teach skill, voice).

---

## 9. Other notable pieces

- **Statusline** `LIFEOS_StatusLine.sh` (2,862 lines of bash, 54 jq/curl references). Four width modes (nano, micro, mini, normal). Lines: branding with location/time/weather, STATE meter of TELOS dimensions toward ideal state, EFFORT scale, DOCTOR delta line, MEMORY line (autonomic health plus hot-layer fill), INTERVIEW due chip, CONTEXT (skills description byte total, startup context estimate), ACCOUNT USAGE (5H and 7D rate limits from the Anthropic OAuth usage endpoint cached by UpdateCounts), ascent chip, AGENTS roster of dispatched models, logged-in account, a quote. Reads `LIFEOS_STATE.json`, work.json `.ascent`, `FreshnessCache.ts` output. Heavy and TELOS/Pulse-flavoured; the CONTEXT and USAGE lines are the only parts a lean system would want, and those are easy to rewrite from scratch.
- **Custom spinner verbs and tips**: `settings.enhancements.json`, synced from `USER/CUSTOMIZATIONS/Spinner/{verbs,icons,colors,anims}.json` by `SyncSpinnerAssets.ts`; tips refreshed by a private `/ut` workflow. Pure `settings.json` keys `spinnerVerbs` and `spinnerTipsOverride`; no server.
- **Tooltips** = the spinner tips above.
- **TimeContext**: see hooks; 44 lines; the cheapest win in the whole payload.
- **The Interview**: two things share the name. `LifeOS/Workflows/Interview.md` is onboarding phase 2 (DA naming plus ElevenLabs voice, principal identity, TELOS current and ideal state, external sources, SeedPulse). `skills/Interview` (1.1.13) is the periodic "evidence-grounded context refresh" that reads TELOS and `CURRENT_STATE/*.md` and `IDEAL_STATE/*.md` (CREATIVE, FREEDOM, HEALTH, INFRASTRUCTURE, MONEY, RELATIONSHIPS, RHYTHMS), pulls Oura, Conduit, work registry, git, expenses, and "opens with the sharpest claim-vs-evidence contradiction". Both are the life-coaching surface Harry does not want; both curl the voice server first.
- **ALGOPREFS.md** (`install/USER/ALGOPREFS.md`, template): depth defaults ("Concise", fast-path for single-verb commands), communication style placeholders, always-on thinking skills, verification posture ("Live probes required: Yes", "Independent second look on high-impact work: Yes (default)", "Cross-vendor audit (Forge): Yes (default)"). Still says "Read at OBSERVE" although OBSERVE no longer exists; nothing in the payload reads this file (no code references found). Vestigial.
- **USER templates**: `install/USER/` ships PRINCIPAL/ (identity, memory, PRONUNCIATIONS, RESUME, WRITINGSTYLE, RHETORICALSTYLE, Quotes.txt), DIGITAL_ASSISTANT/ (DA_IDENTITY with a YAML schema v1 frontmatter: core, voice provider elevenlabs, personality, `autonomy.must_ask: [send, spend, deploy, delete, merge]`; DA_MEMORY; `_presets.yaml`; REFERENCE/WritingStyleBackstop.md), TELOS/ (TELOS.md single source of truth with H2 sections and `<!-- updated: YYYY-MM-DD by:who -->` markers; legacy per-topic files; CURRENT_STATE and IDEAL_STATE dimension dirs; LIFEOS_STATE.json), CONFIG/ (LIFEOS_CONFIG.toml with principal, da, da.voices.main, integrations.cloudflare, paths; OPERATIONAL_RULES.md stub with Trusted channels and Model selection; memory-review.json; CREDENTIALS/, TERMINAL/), CUSTOMIZATIONS/{ARBOL,SKILLS}, SECURITY/, SHARED/Spinner, plus ABOUTME, AI_WRITING_PATTERNS, ARCHITECTURE, BASICINFO, CANONICAL_CONTENT, CONTACTS, DEFINITIONS, FEED, GEAR, OPINIONS, OUR_STORY, PROJECTS, TECHSTACKPREFERENCES. `LIFEOS/USER_TEMPLATES/` has six Pulse page scaffolds (Identity, Beliefs, Books, Goals, Pronunciations) with `provenance: template` or `customized` frontmatter.
- **Release notes** (`Releases/v7.40.4/README.md`, "The Receipts Release"): phase strip, euphoric surprise as meta-ideal-state, blast-radius briefs, ISA verifier classes, 23 release gates plus two audits, 30 community fixes (install no longer bakes one user's name into 121 template files; forked subagents detected; session names no longer word salad), Pulse static export finally shipped, Cortex consolidation with weekly Distill, Helm terminal (kitty config layer) shipped, new skills Novelty / SecurityMarketData / Vitals / Share (Share is not in this payload) / DetectAI upgrades, Hermes zero-token heartbeat, ComplexityRatchet, Bunker docs.
- **`lifeos.ts` launcher**: profile-based MCP loading (`-m bd,ap`), `-s` system prompt, `--resume`, `update`, `version`; wrapper around `claude`. Harry's `pai` alias is the same idea.
- **Doctrine on the hooks themselves** (`RULES/SelfHealing.md`): hooks are for "A checkable property of an artifact, or a gate on an irreversible act... and only these two classes. A hook must not encode how I work". Useful as a filter when choosing what to port.

---

## 10. For myos

Legend: KEEP = take as-is (paths renamed LIFEOS to whatever myos uses); STRIP = keep with voice/Pulse/Kitty removed; DROP.

| Component | Verdict | Reason |
|---|---|---|
| `ALGORITHM/v8.20.2.md` | STRIP | the 16-claim contract is the payload; delete six Pulse/Kitty/cmux sentences and the ascent-strip bullet or keep the strip locally |
| `ALGORITHM/changelog.md`, `eval-guide.md`, archive/ | DROP (read once) | history; the migration recipes reference private tooling |
| `RULES/Verification.md` | KEEP | best single file in the repo; Interceptor mentions become "real browser" |
| `RULES/Philosophy.md`, `RULES/SelfHealing.md` | KEEP trimmed | the keep-class taxonomy and the "where does a rule live" table; drop the autonomic-loop section (private tooling) and the Pulse line |
| `LIFEOS_SYSTEM_PROMPT.md` | STRIP | keep the five constitutional rules, one format, verification, context sufficiency, operational rules, security; remove Pulse URL, Personal Use Boundary, the two `~/.claude` release-skill paragraphs, `⚙️`/`🧠` echo lines unless the hooks come too |
| `CLAUDE.template.md` | KEEP shape | routing-table-only CLAUDE.md with commented identity imports is a good pattern; the 40-row doc table shrinks to what myos has |
| `settings.system.json` | KEEP selectively | copy the harness flags (agent teams, fork subagent, worktree, fileCheckpointing, autoMemory off, plugins), the deny list, the .env ask rules; drop `allowedHttpHookUrls`, `voiceEnabled`, `remoteControlAtStartup`, the wrangler/chrome-devtools allows |
| `settings.enhancements.json` | DROP or cherry-pick | cosmetic |
| MergeSettings / SettingsBackport layering | DROP | solves a public-release problem myos does not have |
| Installer (`Tools/*.ts`, install.sh, Setup/Interview/Update workflows) | DROP | designed for strangers on four harnesses; myos is one machine; `HookHealer` and `Doctor` cover the useful residue |
| Hooks group (a) quality gates | KEEP | TimeContext, HookHealer, LoopDetector, DriftReminder, FormatGate, StopGates + VerificationGate + ISAGate + ISACloseGate, ComplexityRatchet, ModelRungGuard, TaskGovernance; ISAFoldGate with Harry's own mutating-command shapes; SpendAuditor optional; WritingGate only with Pangram |
| Hooks group (b) memory and ISA plumbing | STRIP | ISASync, ISAStaleWriteGuard, CheckpointPerISC, LastResponseCache, LoadContext, EventLogger, AgentInvocation, PostToolObserver, SystemChangeSurface, SessionCleanup (drop the tab call), WorkCompletionLearning; the MemoryTurnStart/LoadMemory/MemoryDeltaSurface/MemoryReviewFire/MemoryHealthGate set only if Harry adopts the hot-layer memory model; ISARenderOnStop and UpdateCounts optional |
| Hooks group (c) security | KEEP selectively | PreToolGuard + PublicPushGate (Harry publishes to github.io) + BashSystemWriteGuard/SystemFileGuard only if myos keeps a public mirror; Safety.hook.ts PermissionRequest classifier is a strong replacement for SmartApprover; EgressClassGuard, CommunicationSkillGuard, DeployRegistrationGate DROP (tool-specific) |
| Hooks group (d) voice/Pulse/Kitty | DROP | VoiceCompletion, VoiceEgressGuard, TabState, KittyEnvPersist, the two HTTP routes, AtlasEventCapture, tab and notification libs; PromptProcessing STRIP to session naming only |
| Hooks group (e) misc | case by case | ContextReduction KEEP (Harry uses rtk); ReminderRouter and VersionDrift DROP |
| `hooks/lib/` | KEEP subset | hook-io, hook-input, transcript-evidence, safety-classifier, subagent, resolve-bin, isa-utils, banned-vocab, learning-utils, work-events; drop tab-*, notification*, containment-zones, egress-class-core, skill-notify-core |
| `TOOLS/models.ts`, `Inference.ts`, `ascent.ts`, `ISAGate.ts`, `Reflect.ts`, `IsaFrontier.ts`, `MemoryHealthCheck.ts`, `Doctor.ts` | KEEP trimmed | local bun scripts the kept hooks import; Doctor loses the cloudflare/voice probes |
| Rest of `TOOLS/` (186 entries, 14 launchd plist templates, Conveyor, healthsync, gmail.ts, OpenRouter, GeminiSearch, GrokQuery, ...) | DROP | services, integrations, private-pipeline helpers |
| `PULSE/`, `ATLAS/`, `HERMES/`, `LIFEOS_StatusLine.sh` | DROP | web server, launchd graph service, second agent, TELOS dashboard bash |
| `DOCUMENTATION/` | DROP except ISA/ISAFormat.md, ISA/ISASystem.md, Algorithm/AlgorithmSystem.md, Hooks/HookSystem.md, Skills/SkillSystem.md, Memory/MemorySystem.md | reference while porting; the rest describes systems not carried |
| Skills: ISA, CreateSkill, Evals, Trim, Interceptor (newer), Upgrade, BitterPillEngineering, Prompting, Hardening | KEEP (strip voice sections) | core to the Algorithm and to keeping myos lean |
| Skills: Loop, Optimize, Novelty, SuggestSkills, HTML, Tldraw, Vitals, DetectAI, BiasCheck | OPTIONAL | prose-only or self-contained; decide by use |
| Skills: Cortex | STRIP or DROP | depends on the memory decision |
| Skills: LifeOS, Teach, CMUX, LocalIntelligence, Telos, Interview, Daemon, SecurityMarketData, USMetrics | DROP | installer, voice, Mac cockpit, Pulse feeders, life coaching, US-only |
| Thinking skills Harry already has (Council, RedTeam, Science, FirstPrinciples, SystemsThinking, IterativeDepth, ApertureOscillation, BeCreative, Ideate, RootCauseAnalysis, WorldThreatModel) | compare versions | mostly small bumps; diff before replacing |
| `agents/` | STRIP | Max (drop the voice block) and Forge are the two the Algorithm names; researchers only if the Research skill comes; every file has an ElevenLabs block to delete |
| `commands/` | DROP except `grill-me` | thin redirects; grill-me is a nice ISA on-ramp |
| `USER/` templates | DROP | Harry has his own USER tree; the `OPERATIONAL_RULES.md § Model selection` stub and `memory-review.json` are the only transferable bits |
| ALGOPREFS.md | DROP | unread by any code |

### Questions for Harry (could not be judged from the payload)

1. Output format: adopt the upstream ONE format (banner, answer, CHANGE/VERIFY, closer) and the DriftReminder + FormatGate pair, or keep his NATIVE/ALGORITHM/MINIMAL templates? Upstream's measured claim is that pre-write contract plus post-write telemetry works and mode banners do not survive.
2. Model pin: does he want `"model"` pinned in settings.json (top rung by config, the whole v8.17.0 argument) so ModelRungGuard has something to compare against, and which alias (opus vs fable)?
3. Verification evidence: VerificationGate's T1 to T3 detectors are Interceptor-shaped. Is Interceptor going to be repaired and kept as the sanctioned browser, or should the evidence detectors accept Claude-in-Chrome screenshots?
4. Memory model: adopt the Cortex hot-layer files (`PRINCIPAL_MEMORY.md`, `DA_MEMORY.md`) with the autonomic reviewer spawning inference at Stop, or keep his current WORK/LEARNING/KNOWLEDGE hooks (WorkCompletionLearning, SatisfactionCapture) without the reviewer? This decides five hooks and the 🧠 line.
5. Public/private split: does myos keep a public mirror (then SystemFileGuard, BashSystemWriteGuard, containment zones, `_ALLCAPS` private skills matter) or is it private-only (then all of that is dead weight and only PublicPushGate for github.io pushes remains)?
6. ISA discipline level: keep ISACloseGate/ISAGate/ISAFoldGate blocking at Stop (they re-emit the response on block), or run them log-only first? Upstream shipped them armed after real fabrications; Harry's tolerance for doubled output is unknown.
7. Which of his mutating actions should ISAFoldGate treat as "prod mutated" (`~/bin/publish`, `git push`, launchctl, crontab, Grist writes)?
8. Second looks: keep Forge (codex is still not installed on his machine per PROJECTS.md) and add Max as the in-family non-forked reviewer, or drop cross-vendor entirely?
9. Evals: adopt the Evals skill plus ConfigEvalFire (a behavioural suite fires whenever CLAUDE.md, the system prompt, identity or a hook changes; costs inference), or skip?
10. rtk: still installed and wanted (ContextReduction.hook.sh)?
11. Session naming: keep the Haiku call in PromptProcessing for session names (his SessionAutoName equivalent) once the Kitty tab half is cut?
12. Statusline: replace his current one with a small rewrite (context estimate plus usage line), or none?
13. Telemetry: does he want the `MEMORY/OBSERVABILITY/*.jsonl` streams (EventLogger, AgentInvocation, format-gate, spend-audit) at all, given no Pulse reads them? They are what LoopDetector, SpendAuditor and SatisfactionCapture feed on, and nothing rotates them ("observability JSONLs are NOT auto-rotated today").
14. Skills to port beyond the core set (Loop, Optimize, Trim, Novelty, HTML, SuggestSkills, DetectAI): which does he actually use?
15. Does he want the ISA format to move to v2.21 (fog section, `(after:)` edges, verifier classes, no Changelog section) given his existing ISAs are v2.7 twelve-section with Changelog? ISAGate hard rules assume the new shape.
