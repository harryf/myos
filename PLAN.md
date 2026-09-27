# myos: plan of action

Status: DRAFT FOR REVIEW, 2026-09-27. Nothing is built yet. Read section 1 (the verdict), section 8 (questions), then the phases in section 9. The detail behind every claim is in `docs/research/` (four reports, about 3,000 lines).

myos is the lean successor to two forks of Daniel Miessler's PAI that Harry runs today: the personal install at `~/.claude-personal` (PAI 5.0.0, Algorithm v6.3.0, symlinked from `~/.claude`) and the work port at `~/.pmai` (pmai 0.32.0, source repo `~/Code/gigs/pmai/pmai`). Upstream has become LifeOS (v7.40.4, Algorithm v8.20.2). myos takes the intelligence and the skills, none of the voice, notifications, dashboards or servers.

## 1. The verdict in one page

**What the evidence says Harry uses.** Over 83 sessions from 2026-05-27 to 2026-09-27 (29,605 tool calls logged in `tool-activity.jsonl`), the skills invoked were:

| Skill | Invocations | Skill | Invocations |
|---|---|---|---|
| ISA | 69 | Science | 7 |
| Interceptor | 27 | ContextSearch | 4 |
| FirstPrinciples | 27 | RootCauseAnalysis | 4 |
| BeCreative | 17 | BitterPillEngineering | 2 |
| SystemsThinking | 16 | AudioEditor | 2 |
| IterativeDepth | 13 | Council, Remotion, Thinking, xlsx | 1 to 2 each |

Fourteen skills out of 54 installed. Agents: 190 dispatches, all general purpose (no custom agent type was ever passed; Designer and Engineer critiques ran through general agents by prompt). Browser: 3,888 Claude-in-Chrome MCP calls against 27 Interceptor skill runs, because the Interceptor extension is usually disconnected. Bash 12,004, Edit 6,283, Read 3,327, WebFetch 1,122, WebSearch 826.

**What the mode classifier did.** 1,004 prompts classified: ALGORITHM 850 (85 percent), NATIVE 143, MINIMAL 11. Tiers: E1 88, E2 316, E3 415, E4 31. Each classification cost a Sonnet subprocess call (3 to 8 seconds per prompt) to choose an output template. LifeOS retired modes, tiers and the classifier on 2026-07-10 and 2026-07-11 after a 1,117-run audit. pmai never had them.

**What the pai hooks do.** 24 registered hooks, of which 15 exist for voice, kitty tabs, ratings, Cloudflare sync or Pulse. 21 more hook files sit on disk unregistered (dead), including the ones the docs describe as live (ISASync, CheckpointPerISC, ContainmentGuard). Pulse is not running on this machine; every voice curl in the Algorithm and in 50 skill files fails silently. Nothing in crontab or launchd depends on the PAI tree.

**What is real in pai.** `PAI/USER/PROJECTS/PROJECTS.md` (74 KB, the live handover notes), 122 `MEMORY/WORK/*/ISA.md` files (1.5 MB, the decision record since May), 9 KNOWLEDGE notes, the SecurityPipeline deny list (tuned, but with a false positive that blocked two writes during this very run), the ContextReduction rtk hook, and the reasoning skills above. Everything in `PAI/USER/` apart from PROJECTS.md is a bootstrap placeholder (name "User", timezone America/Los_Angeles).

**What pmai got right.** A launcher that isolates via `CLAUDE_CONFIG_DIR`, a 27-hook set with zero voice, Pulse or kitty coupling (a `ContrabandCheck` gate keeps it that way), `TokenLog` plus `GigsTokens` (575 sessions logged, reports, dashboard, per-session review), the `Writing` skill with `StyleCheck.ts` (the em dash fix), per-skill semver bumped by `SkillVersionBump.ts`, an install manifest with sha256 per file and an `UpgradePlan.ts` that classifies every file before touching it, `Release.ts` with CI gates, 48 tagged releases, about 1,000 tests. Its Algorithm v8.4.0 is the same lean outcome contract LifeOS now ships.

**What LifeOS adds that neither fork has.** The 16-claim Algorithm v8.20.2 (100 lines, no phases, no tiers, no voice in the doctrine text). Deterministic "teeth" hooks: `VerificationGate` (evidence from the transcript, not the message), `StopGates`, `ISAGate`, `ISACloseGate`, `ISAStaleWriteGuard`, `DriftReminder` plus `FormatGate` (LifeOS's own measurement of its format contract, not Harry's: 0 percent violations across 168 turns while the Stop gate blocked, 61 to 91 percent a day across 2,608 turns once it only logged; they answered with the pre write reminder rather than re arming the block, because a block re emits the whole response), `LoopDetector`, `HookHealer`, `TimeContext`, `ModelRungGuard`, `PublicPushGate` (a deny scan before any push to a public GitHub repo, relevant to harryf.github.io), `Safety.hook.ts` (PermissionRequest classifier that makes `defaultMode: auto` usable). `RULES/Verification.md` (seven incident-derived rules) is the best single file in the repo. LifeOS ships zero tests in its payload.

**Recommendation.** Build myos on the pmai repo skeleton (proven install, upgrade, release and test machinery), adopt the LifeOS Algorithm v8.20.2 and system prompt structure with voice and Pulse sentences removed, port a curated hook set (pmai's core plus about ten LifeOS teeth), carry 14 evidence-backed skills plus the Writing skill and MyTokens, and migrate only PROJECTS.md, the WORK ISAs and KNOWLEDGE from pai. Target: about 20 registered hooks (from 24 plus 21 dead), about 20 skills (from 54), CLAUDE.md under 6 KB (from 9.8 KB plus a 6 KB system prompt with unrendered placeholders), zero background processes, and hooks that leave the machine only for `gh` visibility checks (PublicPushGate) and, if Harry opts in, one Anthropic usage readout per session; the only `claude` subprocess a hook spawns is the optional session namer (question 11). Safety.hook.ts is rule based (checked: no Inference, fetch or claude call in the hook or its classifier).

**Work profile.** pmai keeps running for Gigs work; its 332 logged sessions used Writing 55 times and the Gigs skills for the rest. myos drops the Gigs skills because Harry said so and because pmai still serves that work, not because they are unused there.

## 2. Scope

In: a private GitHub repo `harryf/myos`, installed to `~/.myos`, launched with `myos`. Hooks, skills, the Algorithm and ISA, house style enforcement, token reports, install and release tooling, migration of Harry's real data.

Out: voice services (ElevenLabs, VoiceCompletion, the `/notify` curls in skills), notifications (Pulse notify, ntfy, Telegram, iMessage, Discord, macOS notifications), any locally running server or daemon (Pulse, Observability UI, Arbol, Hermes, Atlas, LocalModel llama server), life coaching and TELOS, kitty tab plumbing, every Gigs* skill except GigsTokens, Cloudflare KV sync, the PAI installer, the PAI documentation tree.

## 3. Source verdicts

Legend: KEEP = copy with path renames; ADAPT = copy and change as noted; DROP = do not port. Sources: pai = `~/.claude-personal`, pmai = `~/Code/gigs/pmai/pmai/payload`, LifeOS = the v7.40.4 payload `LifeOS/install`.

### 3.1 Foundation and tooling (from pmai unless noted)

| Component | Verdict | Notes |
|---|---|---|
| `bin/pmai` launcher | ADAPT | Rename `myos`; `MYOS_HOME=~/.myos`; `--append-system-prompt-file`; the settings sources shield (passes `--setting-sources user` when cwd is `$HOME` or under `~/.claude*`); `myos --version`; bash 3.2 guards |
| `install.sh` (865 lines) | ADAPT | Keep marker based fresh vs upgrade detection, `--dry-run`, `--reset` with the Claude Code state file deny list, the login state assertion, narrated `install.log`. Drop step 10 (pai co-install offers), `--with-creative-deps`, `--native-command`. Add `--from-pai` that calls the memory migration once |
| `Tools/UpgradePlan.ts`, `.install-manifest.json` | KEEP | sha256 per file, create / release / unchanged / userEdited / userAdded / orphan / kept, backups to `upgrade-backups/` |
| `Tools/MergeSettings.ts --upgrade` | KEEP | Additive settings fold, prunes stale hook registrations and unknown tool names, byte identical when nothing changed |
| `Tools/Release.ts`, `.github/workflows/{ci,release}.yml`, CHANGELOG re-head | KEEP | Tag equals VERSION gate, install smoke test, hook import sweep, `gh release create` from CHANGELOG. Point at `harryf/myos` |
| `Tools/SkillVersionBump.ts` | KEEP | Minor bump on added files, patch on modifications, since the last tag; fixes the stale "no tooling does this" sentence in SkillSystem.md |
| `Tools/ContrabandCheck.ts` | ADAPT | New deny list: `localhost:31337`, `voice_enabled`, `VoiceNotification`, `ntfy`, `osascript -e 'display notification'`, `PULSE`, `Bun.serve(`, `.listen(`, `launchctl load` in shipped code. This is the mechanical guarantee of "no voice, no notifications, no servers" |
| `Tools/TestCoverageCheck.ts`, `test/harness.ts`, `test/corpus.ts` | KEEP | A tool exists iff it has a test row; hooks run as real subprocesses with a sandbox HOME |
| `Tools/BudgetCheck.ts`, `context-budgets.json`, Trim skill | KEEP | CLAUDE.md 6,000 bytes, system prompt 6,000, total 30,000. "Budgets are ceilings, not targets" |
| `Tools/Doctor.ts`, `DependencyAudit.ts` | ADAPT | Probe list: bun, rg, git, jq, gh, claude, rtk, interceptor, ffmpeg, whisper; drop codex, cloudflare, voice |
| `Tools/PmaiConfig.ts` + `PMAI_CONFIG.toml.example` | ADAPT | `MyosConfig.ts`, `MYOS_CONFIG.toml`; sections `[principal]`, `[paths]`, `[learning]`, `[tokens]` |
| `Tools/models.ts`, `Tools/Inference.ts` | ADAPT | Tier aliases (fable, opus, sonnet, haiku), `--level low\|medium\|high\|max`, `verifyExecutedModel`, the API key env scrub; drop CROSS_VENDOR and the data class routing table unless Forge is kept (question 8) |
| `PMAI/statusline.ts` (79 lines) | KEEP | `myos v0.1.0 │ model │ ctx 34% │ ~/cwd │ ctx-files`. Replaces pai's 1,399 line weather and kitty statusline |
| `Tools/MigrateMemory.ts` | ADAPT | Source `~/.claude-personal/PAI/MEMORY` layout PAI; categories WORK, KNOWLEDGE; run once from `install.sh --from-pai` |
| `Tools/PaiToggle.ts` | DROP | pmai specific |
| `commands/pmai.md` | ADAPT | `/myos` for use inside a bare `claude` session, optional |
| LifeOS installer (`Tools/*.ts`, InstallEngine, OverlaySystem, Setup and Interview workflows) | DROP | Built for strangers on four harnesses; pmai's installer is tested and fits one machine |
| LifeOS `MergeSettings`/`SettingsBackport` layering | DROP | Solves a public release problem myos does not have |
| pai `PAI-Install/` (255 MB), `PAI/Tools` (72 files), Banners, `pai.ts`, `algorithm.ts` | DROP | Nothing in Harry's automation calls them |

### 3.2 Doctrine (Algorithm, system prompt, CLAUDE.md, rules)

| Component | Verdict | Notes |
|---|---|---|
| LifeOS `ALGORITHM/v8.20.2.md` | ADAPT | Adopt as `MYOS/ALGORITHM/v1.0.0.md` (myos numbering starts fresh, provenance noted). Remove about six sentences: Pulse in claim 13, the cmux fleet, the Kitty tab, the `<lifeos-ascent-delta>` strip, Bunker. Keep the 16 claims, the nudge table (if AlgorithmNudge is ported, see hooks), Spend, the smart zone rule, delegate liveness |
| pai `ALGORITHM/v6.3.0.md` and `capabilities.md`, `mode-detection.md` | DROP | Tiers, floors, classifier, phase headers, voice, all retired upstream; kept in git history of pai only |
| pmai `ALGORITHM/v8.4.0.md` | reference | Same lineage as LifeOS v8.20.2 (15 claims then, 16 now; the changelog between them is 8.4.1 to 8.20.2: claim 16 restore parity, evals on the menu, Max agent, the model pin by config, the smart zone rule, the frontier tool, the phase strip). Read for the "admission test" paragraph. Version numbers of the Algorithm and of LifeOS are independent: the v7.40.4 tree ships `ALGORITHM/LATEST` = 8.20.2, checked in the clone |
| LifeOS `RULES/Verification.md` | KEEP | Seven rules: modality fidelity, unavailable verifier means DEFER, appearance is not existence, reproduce before fixing, temporal fidelity, restore parity, cache fidelity |
| LifeOS `RULES/SelfHealing.md`, `RULES/Philosophy.md` | KEEP trimmed | The "where does a rule live" table and the four keep classes; drop the autonomic loop section and the Pulse line |
| pmai `RULES/Prompting.md` | KEEP | Ideal state prompting |
| System prompt | ADAPT | Base: pmai's 40 line `PMAI_SYSTEM_PROMPT.md` (6,000 byte budget, no placeholders). Add from LifeOS: the five constitutional rules, context sufficiency (three questions or an inline flag), "confidence requires source", the operational rules block. Output format per question 1 |
| `CLAUDE.md` | ADAPT | Shape from LifeOS `CLAUDE.template.md` (routing table only) plus pmai's "How myos writes" block. Harry's own rules carried verbatim: no em dashes anywhere (2026-08-20 directive), bun and bunx always, TypeScript always, build over ask for reversible actions, reproduce before fixing, real browser verification, plan means stop. Add the publish recipe (`~/bin/publish <file> <name> --private -y`) and the Grist conventions as a routing row to a USER file. Drop: the three mode templates, the voice curl, the Life OS preamble, the routing rows to files that do not exist, the Forge auto include rule (codex is not installed) |
| pai `PAI_SYSTEM_PROMPT.md` | DROP | Upstream text with unrendered `{{DA_NAME}}` placeholders and another person's biography |
| ISA format | question 15 | Harry's 122 ISAs are twelve section with Changelog; LifeOS v2.21 drops Changelog ("the changelog is git"), adds fog and `(after:)` edges; ISAGate assumes the new shape |

### 3.3 Hooks

Registered pai hooks (24) with verdicts. Dead pai hooks (21 files, not in settings.json): AgentExecutionGuard, AgentInvocation, CheckpointPerISC, ConfigAudit, ContainmentGuard, ElicitationHandler, FileChanged, ISASync, InstructionsLoadedHandler, PRDSync, RatingCapture, RestoreContext, SecurityValidator, SessionAutoName, SkillGuard, SmartApprover, StopFailureHandler, TaskGovernance, TeammateIdle, ToolFailureTracker, UpdateTabTitle. All DROP as files; where the idea survives it comes from the pmai or LifeOS version below.

| pai hook | Verdict | Successor in myos |
|---|---|---|
| SecurityPipeline (Pattern, Egress, Rules inspectors, PATTERNS.yaml) | DROP as is, ADAPT the deny list | Native `permissions.deny` for the destructive list (recursive deletes of home and config dirs, downloader piped to shell, force push to main, keychain dumps, ssh and aws key reads), plus LifeOS `Safety.hook.ts`. The root deletion regex that matched inside heredocs and "confirm" is not carried; the deny rules match the first token of a command |
| ContextReduction.hook.sh | KEEP (pmai version, 218 lines) | Rewrites build and VCS commands to rtk; never read path commands; inert without rtk (question 10) |
| ContentScanner (PostToolUse WebFetch, WebSearch; fires twice today) | DROP | `Safety.hook.ts` PostToolUse tags external content as data with an injection marker |
| PromptGuard | DROP | Blocks Harry's own prompts on phrases like "forget everything"; single user system |
| RepeatDetection | DROP | LifeOS `LoopDetector` covers repeats, oscillation and hammering |
| PromptProcessing (Sonnet classifier, tab title, session name, voice) | ADAPT | pmai version: session naming only, one Haiku call per session (question 11). Classifier gone |
| SatisfactionCapture, LastResponseCache, FailureCapture | DROP | The rating loop filled 652 MB of transcript copies. LastResponseCache returns only if DriftReminder is adopted (it measures the previous response) |
| SetQuestionTab, QuestionAnswered, KittyEnvPersist, ResponseTabReset | DROP | Kitty |
| VoiceCompletion | DROP | Voice |
| TelosSummarySync, RelationshipMemory | DROP | Life coaching |
| ToolActivityTracker | ADAPT | pmai `EventLogger` (tool activity, skill execution, failures, config changes, ISA heartbeat) with `lib/log-rotation.ts` added |
| PreCompact, RestoreContext | DROP | LifeOS decision: compaction handover is the harness's job; `postCompactRestore.fullFiles` re-injects PROJECTS.md |
| WorkCompletionLearning | question 4 | pmai version writes a learning file per session; keep only if the LEARNING dir is read by something |
| SessionCleanup | KEEP (pmai) | Marks work.json rows complete; no tab call |
| UpdateCounts | DROP or optional | One HTTPS call to the Anthropic usage endpoint per session end; only useful if the statusline shows rate limits |
| IntegrityCheck, DocIntegrity | DROP | Self editing docs on Stop with inference |
| KVSync | DROP | Pushes work.json to Cloudflare KV, but only with a token from `~/.claude/.env`, which does not exist in the personal profile; the hook exits at line 22 today, so nothing leaves the machine and nothing is lost |
| LoadContext | ADAPT | pmai version: active work summary (last 48 h from work.json) only |
| HTTP hooks to `localhost:31337/hooks/skill-guard` and `agent-guard` | DROP | Dead network calls on every Skill and Agent call today |

pmai hooks carried (already voice free): AgentInvocation (subagent events log), CheckpointPerISC (git commit per ISC close in opted in repos), ContextReduction, EventLogger, HookHealer, ISASync (frontmatter to work.json), LoadContext, LoopDetector, PromptProcessing (naming only), Safety (PermissionRequest classifier plus external content tagging), SessionCleanup, TaskGovernance, TokenLog, VerificationGate (pmai 243 line version or LifeOS 482 line version, see below), plus `lib/paths.ts`, `hook-io.ts`, `time.ts`, `isa-utils.ts`, `transcript-evidence.ts`, `safety-classifier.ts`. Dropped from pmai: EgressClassGuard and PreToolGuard's egress branch (codex, Perplexity), UpdateCounts, IntegrityCheck, ISARenderOnStop (HTML mirror, optional), the memory loop (MemoryTurnStart, LoadMemory, MemoryDeltaSurface, MemoryReviewFire, MemoryFreshnessRefresh) pending question 4, SatisfactionCapture, WorkCompletionLearning pending question 4.

LifeOS hooks to add, in priority order:

| Hook | Lines | Why | Coupling to strip |
|---|---|---|---|
| TimeContext | 44 | Live wall clock per turn; the harness date is frozen at session start; Zürich timezone from config | none |
| StopGates + VerificationGate (LifeOS v1.0.6) | 91 + 482 | One Stop dispatcher; the gate detects claims in the message and evidence in the transcript; blocks web deploy, interactive flow and appearance claims without a probe. Evidence detectors need Claude-in-Chrome added (question 3) | none |
| DriftReminder + FormatGate | 253 + 195 | Pre write format and vocabulary contract each turn (line budget, banner, closer, em dash cap, banned words) and post write telemetry. This is the runtime half of the em dash rule that pmai lacks | none |
| ISAGate + ISACloseGate + ISAStaleWriteGuard | 75 + 176 + 198 | Structural gate at `phase: complete`, stale ISA at a completion claim, whole file Write over a moved ISA | none; blocking level per question 6 |
| PublicPushGate | 187 | Deny scan of HEAD and history before any push to a public GitHub remote; harryf.github.io and inyourfacecomedy are public | needs `gh`; fail open when visibility unknown |
| ModelRungGuard | 201 | Reports when the session runs below the pinned model; never switches | needs a `model` pin (question 2) |
| ComplexityRatchet | 247 | Advisory complexity drift meter on writes | none; optional |
| ISAFoldGate | 143 | Prod mutated, ISA untouched. Command shapes must become Harry's (`publish`, `git push`, `launchctl`, Grist writes), question 7 | none |
| AlgorithmNudge | 916 | Skill routing against a USE WHEN index, late ISA, stale ISA, exec delegation rows; advisory only | imports `ascent.ts` (pure TS); one regex names 31337 as a capability id. Large; port in a later phase after the gates prove themselves |
| SpendAuditor | 419 | Detached inference judging underspend | optional, costs a low tier call per trigger |

LifeOS hooks dropped: VoiceCompletion, VoiceEgressGuard, TabState, KittyEnvPersist, AtlasEventCapture, DeployRegistrationGate, CommunicationSkillGuard, EgressClassGuard, SystemFileGuard and BashSystemWriteGuard (only matter with a public mirror, question 5), ReminderRouter, VersionDrift, WritingGate (Pangram API), ConfigEvalFire (pending question 9), KnowledgeWriteGuard, MemoryHealthGate, the two HTTP routes.

Target registration table (about 20 hooks):

| Event | Hooks |
|---|---|
| SessionStart | HookHealer, LoadContext |
| UserPromptSubmit | TimeContext, DriftReminder, PromptProcessing (naming, async), ModelRungGuard (async) |
| PreToolUse Bash | ContextReduction, PreToolGuard (PublicPushGate) |
| PreToolUse Write | PreToolGuard (ISAStaleWriteGuard) |
| PreToolUse and PostToolUse Agent | AgentInvocation |
| PostToolUse Write, Edit, MultiEdit | ISASync, CheckpointPerISC, ISAStaleWriteGuard, ComplexityRatchet (optional) |
| PostToolUse (all) | LoopDetector, EventLogger (async) |
| PostToolUse WebFetch, WebSearch | Safety (content tagging) |
| PostToolUseFailure | EventLogger, LoopDetector |
| PermissionRequest Bash, Write, Edit | Safety |
| TaskCreated | TaskGovernance |
| Stop | StopGates (FormatGate, VerificationGate, ISACloseGate, ISAGate, ISAFoldGate), LastResponseCache |
| SessionEnd | SessionCleanup, TokenLog (async) |

Rule for admitting a hook (from LifeOS SelfHealing.md): a hook checks a property of an artifact or gates an irreversible act, and nothing else. A hook must not encode how the model works.

### 3.4 Skills

Core (evidence of use, or the mechanism Harry asked for). Every skill loses its "Voice Notification" section and its `~/.claude` paths; the pmai copies are the cleanest source since ContrabandCheck already stripped them.

| Skill | Source copy | Evidence | Notes |
|---|---|---|---|
| ISA | LifeOS 1.1.2 or pmai 1.0.14 | 69 uses | Workflows Scaffold, Interview, Grill, CheckCompleteness, Reconcile, Seed, Append. Format version per question 15 |
| Interceptor | LifeOS 4.3.18 (newest) or pmai 4.4.0 | 27 uses | Paths rewritten to `~/bin/interceptor`; the extension is usually disconnected, so the SKILL.md must say what to do when it is (question 3) |
| FirstPrinciples | pmai 1.1.15 | 27 | |
| BeCreative | pmai 1.1.19 | 17 | |
| SystemsThinking | pmai 1.0.6 | 16 | |
| IterativeDepth | pmai 1.1.16 | 13 | |
| Science | pmai 1.1.18 | 7 | |
| ContextSearch | pmai 1.1.8 | 4 | Reads work.json and WORK dir names; `/cs` command |
| RootCauseAnalysis | pmai 1.0.6 | 4 | |
| BitterPillEngineering | pmai 1.0.9 | 2 | Used for exactly this kind of audit |
| Writing + `Tools/StyleCheck.ts` | pmai 1.0.1 | Harry's em dash rule | See 3.6 |
| MyTokens (from GigsTokens) | pmai 1.0.3 | Harry's request | See 3.5 |
| Council, RedTeam | pmai | 1 and 0 uses | Keep: prose only, and RedTeam is the adversarial pass the plan review process wants |
| CreateSkill | pmai 1.1.25 | 0 direct uses, but every new skill goes through it | Keep the frontmatter and versioning conventions; drop the "hand editing is forbidden" rule (pai `skills/CLAUDE.md`) |
| CreateCLI | pmai 1.1.19 | Harry builds bun CLIs in every project | |
| Trim | LifeOS 1.0.4 | new | Human gated shrink of always on files; pairs with BudgetCheck |
| Remotion | pai or pmai | 1 use, but the Double Shot reels and the IYF video pipeline are Remotion | Keep the 31 `Ref-*.md` pattern files; drop `Render.ts` and `Theme.ts` (projects have their own) |

Optional (Harry decides, question 14): AudioEditor (2 uses; `~/bin/transcribe` does the job), Research (needs Perplexity, Gemini, Grok keys Harry does not have configured), Fabric (240 patterns, plain markdown, zero uses via Skill but `fabric` is on PATH), Loop, Optimize, Novelty, HTML, SuggestSkills, DetectAI, Evals (question 9), Hardening, Prompting, ApertureOscillation (3 uses per the pmai audit), Ideate, ExtractWisdom, Knowledge or Cortex (question 4), Upgrade (mines Claude Code changelogs), Vitals, Webdesign, Art (needs keys).

Dropped: all Gigs* skills except GigsTokens (Gigs3GPPTelecomsExpert, GigsAssistant, GigsCalendar, GigsCodeAnalyser, GigsDailyBrief, GigsDashboardBuilder, GigsDataAnalyser, GigsDesign, GigsGranola, GigsLinear, GigsMarketplace, GigsMarketplacePluginCreator, GigsMeetings, GigsMuesli, GigsNotion, GigsPRD, GigsPartner, GigsProject, GigsScheduler, GigsSlack, GigsUsageMBR, _GIGSPM); pai routers (Agents, ContentAnalysis, Investigation, Media, Scraping, Security, Thinking, Utilities with its 513 files); voice wired (Interview, Migrate, Daemon, Telos, Teach); key gated and unused (Apify, BrightData, USMetrics, Sales, Aphorisms, ArXiv, PrivateInvestigator, WorldThreatModel, WriteStory, SecurityMarketData, LocalIntelligence); Browser (superseded by Interceptor); PAIUpgrade; Delegation (native harness); CMUX, Tldraw, LifeOS, LocalModel.

Not ported and nothing to do: `skills/synced/` is Claude Code's own claude.ai sync bucket (anthropic-skills plus Harry's `eventfrog-ticket-downloader` and `harry-writing-style`); it comes with any config dir.

GigsScheduler: the mechanism (launchd plists calling `Scheduler.ts run <name>`, `command` and `prompt` job kinds, headless `-p` runs are read only by construction) is generic. Harry's automation runs on cron and one launchd agent today and needs nothing from it. Listed under question 19.

### 3.5 MyTokens (from GigsTokens)

Mechanism: `hooks/TokenLog.hook.ts` (30 lines, SessionEnd, async) imports `sync()` from `skills/MyTokens/Tools/TokenLog.ts` (812 lines). `sync()` folds `<config dir>/projects/<project>/<session>.jsonl` plus `subagents/agent-*.jsonl` into `MEMORY/OBSERVABILITY/TOKENS/sessions.json` (per session, per turn, per model buckets of fresh input, cache write, cache read, output; skills attributed per turn; subagent share; tool histogram), incrementally via `cursor.json`, deduped by message id. Commands: `sync`, `report [--days N] [--json]`, `session <prefix>`, `dashboard`. No dollar figures by design. Folds in `rtk gain` when rtk is on PATH.

Rename list (13 "Gigs" hits plus pmai strings), from the pmai audit section 3: `SKILL.md` name, title, description (drop the Hex clause), four tool paths; `Workflows/Report.md` path; `Workflows/Dashboard.md` path and the two GigsDesign paragraphs (keep the `theme.css` mechanism); `Workflows/Review.md` path, skill mapping examples, the GUIDES path; `Workflows/Advise.md` lever 7 (Hex sizing, drop); `Tools/TokenLog.ts:736` how to text plus the `.pmai/projects`, `TOKENS`, `session-names.json`, `local-inference.jsonl` paths, the `pmai-release-probe` exclusion (becomes `myos-release-probe`), `pmai --resume` text, the dashboard title; env overrides `PMAI_TOKENLOG_*` become `MYOS_TOKENLOG_*`; the hook import path; `test/hooks/TokenLog.hook.test.ts` and its `corpus.ts` row.

History: on first install, run `sync` once with `MYOS_TOKENLOG_PROJECTS=~/.claude-personal/projects` so the pai transcripts still on disk (about 30 days) land in the store, then let the hook take over on `~/.myos/projects`.

### 3.6 The em dash mechanism

What pmai has: no runtime hook. Three layers: (1) the always loaded "How pmai writes" block in CLAUDE.md and a § Writing paragraph in the system prompt; (2) `skills/Writing/Tools/StyleCheck.ts` (633 lines, bun, no deps): the em dash is the only auto fix, code spans, fences, URLs and link targets are masked first, `replacementFor()` picks colon, semicolon, comma or parentheses from context, the em dash rule cannot be suppressed, three profiles (prose, docs, dashes), exit 1 on any error; the Rewrite workflow's step 5 says the gate must exit 0 before handing back; (3) CI runs the checker over every shipped markdown file in three profiles, so no release can carry an em dash in prose. Gap: the checker reads `.md` only; hook sources are full of em dashes in comments; nothing checks a response as it is emitted.

What myos does: layers 1 to 3 as they are, plus (4) LifeOS `DriftReminder` on UserPromptSubmit, which tells the model every turn what the previous response broke (measured from `last-response.txt`) and states the em dash cap, and `FormatGate` on Stop, which logs violations to `format-gate.jsonl`; set FormatGate's em dash cap to zero. Plus (5) a CI grep for U+2014 across `.ts`, `.sh`, `.json` and `.md` in the payload (Harry's rule covers code and comments too), and a pre commit hook in the myos repo running the same grep. A Stop hook cannot rewrite the emitted text (LifeOS measured that blocking doubles output), so the runtime enforcement is pre write plus telemetry, and the repo enforcement is absolute.

### 3.7 Agents

| Agent | Verdict | Notes |
|---|---|---|
| Designer, Engineer (pai) | KEEP | Claude only; Harry runs Designer critiques on every page he builds |
| Max (LifeOS) | ADAPT | Read only, top rung, non forked second look; drop the ElevenLabs block. Replaces Cato, which needs codex |
| Forge (LifeOS, `MODE: build` or `audit` via `codex exec`) | question 8 | codex is not installed; the Forge auto include rule in pai CLAUDE.md fires on every E3+ task and is skipped every time |
| Cato, Anvil, Arthur, Artist, Silas, Pentester, Algorithm, Architect, the vendor researchers, the deprecated three | DROP | Keys or CLIs absent, or personas |

### 3.8 Settings

Base: pmai `settings.template.json` with `__MYOS_HOME__` substitution. `env`: `MYOS_DIR`, `MYOS_CONFIG_DIR`, `BASH_DEFAULT_TIMEOUT_MS=600000`, `API_TIMEOUT_MS=1800000`, and from LifeOS `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `CLAUDE_CODE_FORK_SUBAGENT=1`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=20`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=3`. `model: fable[1m]` (pin, question 2). `permissions.defaultMode: auto` with pmai's `autoMode` prose blocks rewritten for `~/Code`, `~/Documents/Comedy`, `~/.myos` (pai trusts `~/Projects`, which Harry does not use). `allow`: read tools, `Bash` prefixes, `Edit(~/Code/**)`, `Edit(~/.myos/**)`, `Edit(~/Documents/**)`, `Agent(Designer)`, `Agent(Engineer)`, `Agent(Max)`, Explore, Plan, general-purpose, claude-code-guide, `EnterWorktree`, `ExitWorktree`, `Monitor`, `ToolSearch`, the claude-in-chrome MCP tools. `deny`: the destructive list from pmai plus reading `~/.myos/.env` and `Read(~/.ssh/id_*)`. `ask`: `git push`, `rm`, `sudo`, `launchctl`, `crontab`, `.env` reads. `postCompactRestore.fullFiles: ["MYOS/USER/PROJECTS.md"]`. `enabledPlugins`: code-review, pr-review-toolkit, typescript-lsp, swift-lsp. `worktree.baseRef: head`, `fileCheckpointingEnabled: true`, `teammateMode: auto`, `includeGitInstructions: false`, `theme: dark-daltonized`, `tui: fullscreen`, `statusLine` command `bun MYOS/statusline.ts`. Dropped: `voiceEnabled`, `notifications`, `observability`, `allowedHttpHookUrls`, `daidentity`, `principal` (moves to the TOML), `counts`, `spinnerVerbs` and `spinnerTipsOverride` (cosmetic, question 12 covers cosmetics), `PROJECTS_DIR`, `autoMemoryEnabled` per question 20.

Known gotcha carried in `_permissionsDocs`: do not write `Write(<path>)` rules, the harness ignores them; `Edit(<path>)` covers all file editing tools; unknown tool names are pruned by MergeSettings.

### 3.9 Memory and data

| Data | Verdict | How |
|---|---|---|
| `PAI/USER/PROJECTS/PROJECTS.md` (74 KB) | MIGRATE and SPLIT | Today the whole 74 KB file is `@` imported by CLAUDE.md into every session and re injected after compaction: about 19,000 tokens of context per session, most of it closed work. Proposal (question 21): `MYOS/USER/PROJECTS.md` keeps a short "Open" index (target under 6 KB, one paragraph per live project with a pointer), the long histories move to `MYOS/USER/PROJECTS/<slug>.md` and load on demand through the routing table; only the index is imported and restored after compaction |
| `PAI/MEMORY/WORK/*/ISA.md` (122 files, 1.5 MB) | MIGRATE | `MigrateMemory.ts` copy only into `~/.myos/MYOS/MEMORY/WORK/`; old format stays readable; ContextSearch indexes them |
| `PAI/MEMORY/KNOWLEDGE/` (9 notes) | MIGRATE | Same tool |
| `PAI/MEMORY/LEARNING/FAILURES/*/*.md` summaries | optional | A few hundred KB of "what went wrong"; the 652 MB of transcript copies stay behind |
| `PAI/MEMORY/STATE/work.json`, `session-names.json` | MIGRATE | So ContextSearch and LoadContext see the last sessions |
| Claude Code auto memory (`projects/-Users-harry--claude-personal/memory/`) | question 20 | Two project memories exist (sulk, IYF flyer maker). Copy if auto memory stays on |
| OBSERVABILITY, SECURITY logs, VOICE, RELATIONSHIP, the stale top level `MEMORY/`, `${HOME}/` (106 MB), `.claude-*.bak` | LEAVE | Residue; deleting anything in `~/.claude-personal` is Harry's call after cutover |
| `~/.claude/checkpoint-repos.txt` | RECREATE | One line `~/.myos` if CheckpointPerISC is registered; add project repos by hand |
| Credentials | NONE | pai has no `.env`; project secrets live in each repo's `.env`; Claude OAuth in the keychain per config dir (the first `myos` launch asks to log in once) |

### 3.10 Outside the config dir

`~/bin/publish`, `~/bin/interceptor`, `~/bin/transcribe`, `~/bin/claude-switch`: untouched, referenced by path from skills. Crontab (11 jobs) and launchd (`ch.inyourfacecomedy.robins-calendar`, four `com.gigs.pmai.*`, `com.pmai.llama-server`): none reference the PAI tree, so no change. `claude-switch` swaps `~/.claude` between personal and work; myos does not use `~/.claude` at all, so the switch keeps working until cutover (question 16).

## 4. Target layout

Repo `/Users/harry/Code/personal/myos` (mirrors pmai's proven shape; `payload/` equals `~/.myos` one to one):

```
myos/
  README.md  PLAN.md  MIGRATION.md  ISA.md  CHANGELOG.md  VERSION  DEVELOPMENT.md
  install.sh                     fresh or upgrade, --dry-run, --reset, --from-pai
  bin/myos                       the launcher (copied to ~/.myos/bin/myos, symlinked to ~/.local/bin)
  payload/
    CLAUDE.md                    routing table plus "How myos writes"
    settings.template.json       __MYOS_HOME__ substituted at install
    hooks/                       *.hook.ts, lib/, handlers/
    skills/                      TitleCase skills; _ prefix is user owned
    agents/                      Designer.md Engineer.md Max.md (Forge.md if kept)
    commands/                    cs.md, grill-me.md, myos.md
    MYOS/
      VERSION  MYOS_SYSTEM_PROMPT.md  statusline.ts
      ALGORITHM/  LATEST, v1.0.0.md
      RULES/      Verification.md SelfHealing.md Prompting.md
      TOOLS/      Inference.ts models.ts Doctor.ts MyosConfig.ts MergeSettings.ts BudgetCheck.ts MigrateMemory.ts ISAGate.ts ...
      DOCUMENTATION/  ISA format, hook system, skill system (short)
      USER/       scaffold only: CONFIG/MYOS_CONFIG.toml.example, PROJECTS.md template
  Tools/                         Release.ts UpgradePlan.ts SkillVersionBump.ts ContrabandCheck.ts TestCoverageCheck.ts ReleaseCheck.ts
  test/                          harness.ts corpus.ts hooks/ tools/ skills/
  docs/research/                 the four reports behind this plan
  .github/workflows/ci.yml release.yml
```

Runtime `~/.myos` (a standalone Claude Code config dir): the payload above plus Claude Code's own state (`.claude.json`, `projects/`, `sessions/`, `plugins/`, `history.jsonl`), `.install-manifest.json`, `install.log`, `upgrade-backups/`, and the two trees the installer never touches: `MYOS/MEMORY/{WORK,KNOWLEDGE,LEARNING,STATE,OBSERVABILITY/TOKENS}` and `MYOS/USER/{CONFIG/MYOS_CONFIG.toml,PROJECTS.md,...}`.

Launcher behaviour: `export CLAUDE_CONFIG_DIR=$MYOS_HOME`; `--append-system-prompt-file $MYOS_HOME/MYOS/MYOS_SYSTEM_PROMPT.md`; when cwd is `$HOME` and `~/.claude/settings.json` exists, or cwd is under `~/.claude*`, pass `--setting-sources user` (otherwise a pai install's CLAUDE.md and settings would load as project config); `MYOS_SETTING_SOURCES` overrides; `myos --version` prints `myos vX.Y.Z` without launching; `exec claude "$@"` so `myos --resume`, `myos -p` and every other flag pass through.

Coexistence: `~/.claude` stays the pai symlink until Harry decides otherwise. myos never writes outside `~/.myos`, the current project, and the repos Harry opts into for checkpoints. Both can run at the same time in different terminals. Rollback at any point: `rm -rf ~/.myos ~/.local/bin/myos`; pai is untouched.

## 5. Claude Code features myos leans on

Grounded in `docs/research/2026-09-27-claude-code-reference.md` and the LifeOS settings.

- Hook events beyond pai's set: `PermissionRequest` (Safety classifier), `PostToolUseFailure` (LoopDetector, EventLogger), `TaskCreated` (TaskGovernance), `ConfigChange` (log). `async: true` and per hook `timeout` on every registration. No HTTP hooks.
- Skills: `description` carries the USE WHEN triggers (1,024 char cap); `context: fork` for skills that should run in a fresh subagent (ISA Grill, Research); `disable-model-invocation` for Loop and Optimize; `allowed-tools` where a skill needs a pre approved Bash prefix.
- Agents: `Agent(model=...)` tier aliases for the downshift on execution legs; `isolation: "worktree"` for parallel write agents; `run_in_background` with the harness notification instead of polling; forks inherit context and therefore never review their own build (Max runs non forked); agent teams and the Workflow tool behind the env flags above; `TaskList` only for teams.
- Model and effort: the session model pinned in settings (top rung by config, so judgment happens inline, not by election); `effortLevel` left to the harness; the 100k token "smart zone" rule: close a work unit and re enter from the ISA rather than pushing through compaction.
- Context: `postCompactRestore.fullFiles` for PROJECTS.md; `@` imports in CLAUDE.md for identity files; `.claude/rules/*.md` with `paths:` for per project rules; `/context` and `/doctor prompt-audit` when trimming; `skillListingBudgetFraction: 0.15`.
- Plugins: code-review, pr-review-toolkit, typescript-lsp, swift-lsp from the official marketplace.
- Auto memory: question 20.

## 6. Size budget

| Measure | pai today | myos target |
|---|---|---|
| Registered hooks | 24 (plus 21 dead files, 2 HTTP) | about 20, zero dead, zero HTTP |
| Hook network calls | Pulse, Cloudflare KV, Anthropic usage, ntfy, ElevenLabs | `gh` visibility (PublicPushGate), optional Anthropic usage |
| Subprocess `claude` calls from hooks | one Sonnet per prompt, Haiku on ambiguous ratings, Opus in DocIntegrity | one Haiku per session (naming, question 11), optional SpendAuditor |
| Skills | 54 (13 routers or voice wired) | about 20 core plus Harry's optional picks |
| CLAUDE.md plus system prompt | 9.8 KB plus 6 KB with placeholders | under 6 KB each, BudgetCheck enforced |
| Algorithm doctrine | 673 lines | about 90 lines |
| Statusline | 1,399 lines, weather, kitty, curl | 79 lines, no network |
| Background processes | Pulse expected on 31337 (not running) | none |
| Config dir size | about 1 GB (652 MB failure transcripts) | tens of MB |
| Tests | none run | pmai suite ported for every carried component |

## 7. Risks

- **VerificationGate evidence shapes.** Both versions expect Interceptor evidence. Harry's sessions verify with Claude-in-Chrome most of the time. Without adding those tool names to `transcript-evidence.ts`, the gate would block honest claims. Fix in phase 2, test with a replayed transcript.
- **Blocking Stop gates re emit the whole response.** LifeOS ships them armed; Harry's tolerance is unknown. Phase 2 ships them log only, phase 6 arms them one at a time (question 6).
- **ISA format drift.** 122 existing ISAs are twelve section; the LifeOS ISAGate expects v2.21. Either port ISAGate's rules to the twelve section shape or adopt v2.21 for new ISAs only (question 15).
- **pmai hook sources contain em dashes in comments.** A CI grep across `.ts` will fail on day one; the first commit runs a one time strip.
- **Two installs on one machine.** A session started in `$HOME` with `~/.claude/settings.json` present loads pai hooks as project config; the launcher shield covers `$HOME` and `~/.claude*` only. Start `myos` inside a project directory.
- **Skill copies differ.** pai, pmai and LifeOS hold three versions of the reasoning skills; diff before choosing (pmai's are voice free and versioned; LifeOS's are newest).
- **Old ISAs meet new gates.** ISAGate, ISAFoldGate and ISAStaleWriteGuard assume the v2.21 shape; the 122 migrated ISAs are twelve section. Exempt old ISAs by format detection (phase 2) so an edit to an old ISA never blocks a Stop.
- **Hidden references outside cron.** A grep of the rc files, `~/bin` and `~/.config` on 2026-09-27 found two: the `pai` alias in `.zshrc` (`bun ~/.claude/PAI/Tools/pai.ts`) and `claude-switch`, which manages the `~/.claude` symlink. Both keep working while pai exists; cutover (phase 7) updates them. No ISA and no line of PROJECTS.md carries an absolute `~/.claude-personal` path (checked), so no path rewrite is needed on migration.
- **The SecurityPipeline is gone.** Native deny rules do not scan heredoc bodies or catch a secret inside a command string. Keep one small PreToolUse Bash check for API key prefixes in a command that also names curl or wget, if Harry wants that layer (it was the one useful Egress rule).

## 8. Questions for Harry

Answers change what gets built. The advisor review split the list: ten questions have a safe default that implementation will take unless Harry objects (2, 3, 8, 9, 10, 11, 12, 13, 15, 19, each marked "default"), and twelve need his answer (1, 4, 5, 6, 7, 14, 16, 17, 18, 20, 21, 22). Defaults taken: pin `fable[1m]`; accept Interceptor and Claude-in-Chrome evidence; Max only, no Forge until codex exists; no Evals in v0.1; keep rtk; deterministic session names (no Haiku call, keeps hooks free of model calls); pmai statusline, no spinner overrides; rotate observability logs at 20 MB; ISA format v2.21 for new ISAs; cron stays, no Scheduler.

1. **Output format.** Adopt the LifeOS one format (banner `════ myos ═══`, answer first, `🔧 CHANGE` and `✅ VERIFY` only when something mutated, `🗣️` closer) enforced by DriftReminder plus FormatGate, and drop the NATIVE / ALGORITHM / MINIMAL headers and the Sonnet classifier? Recommendation: yes. The classifier cost a model call on all 1,004 prompts to pick a template, 85 percent went to ALGORITHM anyway, and upstream measured that the pre write contract works where mode banners did not.
   ANSWER FROM HARRY: Sounds good 👍
3. **Model pin.** Pin `model` in settings (`fable[1m]` today) so ModelRungGuard has a reference, and accept the LifeOS rung rule (judgment inline on the top rung, downshift only for scoped execution legs via `Agent(model=...)`)? Recommendation: yes, pin fable.
   ANSWER FROM HARRY: Sounds good 👍 But also offload work to other models when it makes sense
5. **Browser evidence.** Repair and keep Interceptor as the sanctioned verifier, or teach VerificationGate to accept Claude-in-Chrome screenshots as evidence too? The logs show 3,888 Claude-in-Chrome calls against 27 Interceptor runs. Recommendation: accept both; state Interceptor as preferred when connected.
   ANSWER FROM HARRY: Sounds good 👍
7. **Memory model.** (a) pmai's autonomic loop: a 48 entry `PRINCIPAL_MEMORY.md` hot layer injected per session, curated by a detached reviewer (one medium tier model call every 8 turns or 30 minutes), with the `🧠 MEMORY:` line; (b) just PROJECTS.md plus WORK ISAs plus KNOWLEDGE notes, no reviewer, no per turn injection; (c) Claude Code's own auto memory. Recommendation: (b) first; PROJECTS.md is already the file that works. Revisit after a month of token reports.
   ANSWER FROM HARRY: Sounds good 👍 Make sure to have a mechanism to migrate memories from pai into moos though
9. **Public mirror.** Will myos ever be published publicly? If private only, SystemFileGuard, BashSystemWriteGuard, containment zones and the `_ALLCAPS` private skill convention are dead weight and only PublicPushGate (for github.io and the IYF repo) stays. Recommendation: private only.
    ANSWER FROM HARRY: Yes - private only 👍
11. **ISA gates.** Ship ISAGate, ISACloseGate and ISAFoldGate blocking (a block forces a full re emit of the response) or log only for the first weeks? Recommendation: log only for two weeks, then arm ISACloseGate first.
    ANSWER FROM HARRY: Sounds good 👍 Make sure to implement something that will perform the check later
13. **ISAFoldGate shapes.** Which of Harry's actions count as "prod mutated": `~/bin/publish`, `git push`, `launchctl`, `crontab`, Grist writes via curl, Meta ads `--apply` scripts?
	ANSWER FROM HARRY: Sounds good 👍 These are all good examples
14. **Second looks.** Drop Forge and Cato (codex not installed since at least 2026-09-13) and use Max (Claude, non forked, read only) as the reviewer, or install codex and keep Forge for cross vendor audits? Recommendation: Max only; add Forge back the day codex is installed.
	ANSWER FROM HARRY: Sounds good 👍
15. **Evals.** Port the Evals skill and ConfigEvalFire (a behavioural eval suite runs whenever CLAUDE.md, the system prompt or a hook changes; costs inference)? Recommendation: not in v0.1; the tests cover the hooks deterministically.
	ANSWER FROM HARRY: Sounds good 👍 But make sure to have a review scheduled somehow
16. **rtk.** Still installed and wanted? ContextReduction is inert without it. (Found at `/opt/homebrew/bin/rtk` today.)
	ANSWER FROM HARRY: yes let’s keep it.
17. **Session naming.** Keep one Haiku call per session for a readable session name in `session-names.json` (ContextSearch and MyTokens use it), or use the deterministic fallback (first prompt, 48 chars)?
	ANSWER FROM HARRY: Sounds good 👍
18. **Statusline and cosmetics.** pmai's 79 line statusline (version, model, context percent, cwd, context files)? Keep the sci fi spinner verbs? Recommendation: pmai statusline, no spinner overrides.
	ANSWER FROM HARRY: yes - the pmai status line is perfect. More is just noise
19. **Observability streams.** Keep `tool-activity.jsonl` and friends (they made this audit possible, and LoopDetector and MyTokens read them) with rotation added? Recommendation: yes, rotated at 20 MB.
	ANSWER FROM HARRY: Sounds good 👍
20. **Optional skills.** From the optional list in 3.4, which do you want in v0.1? My guess: Fabric patterns (you have `fabric` installed), Remotion refs, Research only if you add a Perplexity key.
	ANSWER FROM HARRY: Sounds good 👍 I don’t have a perplexity Api key but I use remotion quite often. And fabric we can use
21. **ISA format.** Move new ISAs to LifeOS v2.21 (Not yet specified section, `(after:)` edges, verifier classes, no Changelog section because git is the changelog) while old ISAs stay as they are, or keep the twelve section format everywhere? Recommendation: v2.21 for new ISAs; port ISAGate accordingly.
	ANSWER FROM HARRY: Sounds good 👍
22. **Cutover.** After a trial period, does `~/.claude` become myos (symlink swap, `claude` alias) so tools that assume `~/.claude` see it, or does myos stay a separate command forever? Affects `claude-switch` and the work profile.
	ANSWER FROM HARRY: myos stays a separate command. This effectively makes claude-switch redundant
23. **pai residue.** After cutover, may the 1 GB under `~/.claude-personal` (failure transcripts, `${HOME}/` tree, PAI-Install, backups) be deleted, or archived to a tarball first?
	ANSWER FROM HARRY: it’s OK to delete them if we’ve got all the main memories out of them
24. **Repo creation.** Create `github.com/harryf/myos` as a private repo from here when implementation starts (needs your go per the permission rules), and commit to main only?
    ANSWER FROM HARRY: Sounds good 👍
25. **Scheduler.** Do you want the generic launchd Scheduler from pmai (command jobs and headless `myos -p` prompt jobs, no notifications), or is cron enough as today?
    ANSWER FROM HARRY: the launchd scheduler is better for any jobs that fire myos itself. But for scripts we run, where no llm is involved, I prefer crontab as it’s easier to read and work with.
26. **Auto memory.** Keep Claude Code's built in auto memory on in myos (pai has it on, with two project memories), or off as LifeOS and the self healing rule recommend?
    ANSWER FROM HARRY: Let’s go with LifeOS’s solution.
28. **PROJECTS.md shape.** Split the 74 KB file into a short always loaded "Open" index plus per project history files loaded on demand (see 3.9), or keep importing the whole file every session as today? Recommendation: split; it is the largest single context cost in every pai session.
	ANSWER FROM HARRY: OK let’s split.
29. **Auto mode and Safety.** pai already runs `permissions.defaultMode: auto` with the permission prompts skipped. myos keeps that posture and adds the rule based Safety classifier on PermissionRequest (auto allows read only shapes and trusted paths, stays neutral on anything dangerous, logs every decision). Confirm this is the security posture you want, or name the mode you prefer (`ask` with a curated allow list is the alternative).
    ANSWER FROM HARRY: Sounds good 👍

## 9. Phases

Each phase ends with a verification that a reader can rerun. No phase starts before Harry has answered the questions it depends on.

**Phase 0: decisions.** Harry reviews this plan and answers section 8. Output: answers recorded in `ISA.md` Decisions. Verify: every question has a row.

**Phase 1: repo and launcher (depends on 18).** Copy the pmai repo skeleton (`install.sh`, `bin/`, `Tools/`, `test/harness.ts`, `test/corpus.ts`, CI workflows, `DEVELOPMENT.md`) into `myos/`, rename PMAI to MYOS and pmai to myos throughout, empty the payload of everything but CLAUDE.md, settings template, statusline and VERSION 0.1.0. Update ContrabandCheck's deny list. Create the private GitHub repo. Verify: `./install.sh --dry-run` plans a fresh install; `./install.sh` writes `~/.myos`; `myos --version` prints `myos v0.1.0`; a `myos` session started in `~/Code/personal/myos` shows the statusline and no pai hooks fire (check with `/hooks` and `tool-activity.jsonl` absent from pai); `ci.yml` passes on the first push; ContrabandCheck passes with zero hits.

**Phase 2: hooks (depends on 6, 7, 22; defaults for 2, 3, 10, 11, 13).** Port the pmai core set with its existing tests, then the LifeOS additions in the priority order of 3.3. LifeOS ships no tests, so each of its roughly ten hooks gets a test file written here (synthetic stdin, expected exit code and output; budget about half the phase). Add Claude-in-Chrome evidence shapes to `transcript-evidence.ts`. Stop gates log only. Add log rotation to EventLogger. Kill switches documented in the hooks README: `MYOS_GATES=off` disables every Stop gate at once, plus the per gate switches LifeOS already has (`VERIFGATE_OFF`, `ISAGATE_OFF`). HookHealer may only `chmod +x` files under `~/.myos/hooks`; it never edits content. Old twelve section ISAs (detected by an `effort:` frontmatter key, which v2.21 no longer writes) are exempt from ISAGate and ISAFoldGate. Verify: `bun test` green; hook import sweep; each hook run with synthetic stdin from `test/`; a `myos` session shows TimeContext and DriftReminder lines in context; VerificationGate blocks a replayed deploy claim without evidence and passes one with a screenshot Read; `hooks.json` has no `type: http` entry.

**Phase 3: doctrine (depends on 1, 5, 15).** Write `MYOS_SYSTEM_PROMPT.md` (under 6,000 bytes), `CLAUDE.md` (under 6,000 bytes), `ALGORITHM/v1.0.0.md` from LifeOS v8.20.2 with the Pulse and Kitty sentences removed, `RULES/{Verification,SelfHealing,Prompting}.md`. Verify: `BudgetCheck.ts` exit 0; `StyleCheck.ts --profile prose` exit 0 on all of them; a `myos` session answers a trivial prompt in the agreed format and runs the Algorithm on "build X" by reading LATEST first; `rg` for U+2014 across the payload returns nothing.

**Phase 4: skills (depends on 8, 14).** Copy the core skills from pmai (voice free), diff against LifeOS versions and take newer workflows where they add something, rewrite Interceptor paths to `~/bin/interceptor`, rename GigsTokens to MyTokens per 3.5, port Writing and StyleCheck, add Trim, add agents Designer, Engineer, Max. Verify: `SkillVersionBump.ts --dry-run` shows every skill at a version; `StyleCheck.ts --profile dashes` over `payload/skills` exit 0; every SKILL.md `description` under 1,024 chars; a `myos` session invokes ISA, Interceptor, FirstPrinciples and MyTokens `report --days 7` successfully; `rg 'localhost:31337|Gigs' payload/` returns nothing.

**Phase 5: memory migration (depends on 4, 20).** `install.sh --from-pai`: copy PROJECTS.md into `MYOS/USER/`, WORK ISAs and KNOWLEDGE via MigrateMemory, work.json and session-names.json, TokenLog history from `~/.claude-personal/projects`. Verify: `ls ~/.myos/MYOS/MEMORY/WORK | wc -l` equals 123; `cs sarah` finds the flat finder sessions; MyTokens `report --days 30` shows pai sessions; `~/.claude-personal` mtimes unchanged (`find -newer` against a marker file).

**Phase 6: trial and arming (depends on 6, 16).** Two weeks of real work in `myos` alongside pai and pmai, both of which stay runnable throughout. Weekly: MyTokens report, `format-gate.jsonl` and `verification-gate.jsonl` review, arm one Stop gate at a time. Fix false positives in the repo, release patch versions with `Release.ts`. Exit test before phase 7: at least 20 `myos` sessions completed; zero gate blocks that Harry had to override with a kill switch in the last 10 sessions; FormatGate violations under 5 percent of turns in the last week; MyTokens output tokens per session at or below the pai baseline from the first 30 day report; at least three releases tagged; zero contraband hits. Verify: the numbers above written into ISA.md with the report lines that produced them, and Harry's verdict on the format and the gates recorded there.

**Phase 7: cutover (depends on 16, 17).** If Harry chooses it: `claude-switch` gains a `myos` target or `~/.claude` becomes a symlink to `~/.myos`; pai residue archived or deleted; the work profile untouched. Verify: `claude` bare launches myos hooks; `crontab -l` jobs still run (they never touched PAI); `~/.pmai` untouched.

## 10. What this plan did not do

No file was created outside `~/Code/personal/myos` and the session scratchpad. Nothing under `~/.claude-personal`, `~/.pmai`, `~/Code/gigs/pmai/pmai` or the LifeOS clone was modified. No hook, skill, launcher or settings file exists in myos yet. The four research reports are in `docs/research/`. The project ISA is `ISA.md`.
