# Changelog

Newest first. Each release is a `## X.Y.Z` heading followed by what changed; the release workflow reads the entry for the tag it publishes.

## 0.1.0

First release. myos is the lean successor to Harry's two PAI forks (the personal install at `~/.claude-personal` and the work port pmai), built from the pmai repo skeleton and the LifeOS Algorithm.

- Launcher `myos`: a standalone Claude Code config dir at `~/.myos` (`CLAUDE_CONFIG_DIR`), the myos system prompt appended, a settings sources shield when started from `$HOME` or another install's directory, `myos --version`.
- Installer: fresh and upgrade modes from a sha256 manifest, `--dry-run`, `--reset`, `--from-pai` (one time memory migration), user owned `MYOS/USER` and `MYOS/MEMORY` never overwritten, `~/.local/bin/myos` link.
- Hooks (26): the pmai core (context reduction through rtk, event logging with rotation, ISA sync, per ISC checkpoints, loop detection, session naming without a model call, safety classifier for auto mode, token logging) plus the LifeOS teeth (TimeContext, DriftReminder, FormatGate, VerificationGate with Interceptor and Claude-in-Chrome evidence, ISAGate, ISACloseGate, ISAFoldGate, ISAStaleWriteGuard, PublicPushGate, ModelRungGuard) behind one dispatcher (StopGates) and one kill switch (`MYOS_GATES=off|log|block`). ISA gates ship log only; TrialClock reminds at session start when the two week arming review and the one month doctrine review fall due; `GateReview.ts` prints the numbers.
- Doctrine: Algorithm v1.0.0 (LifeOS v8.20.2 with the Pulse, Kitty, cmux and Bunker sentences removed), a 6 KB system prompt with the single output format, a 6 KB CLAUDE.md routing table with Harry's rules, RULES (Verification, SelfHealing, Prompting), the myos ISA format v1 (LifeOS v2.21 without the Changelog section; legacy twelve section ISAs stay readable and are exempt from the gates).
- Skills (20): ISA, Interceptor, FirstPrinciples, BeCreative, SystemsThinking, IterativeDepth, Science, ContextSearch, RootCauseAnalysis, BitterPillEngineering, Writing (StyleCheck: the em dash gate), MyTokens (renamed from GigsTokens), Council, RedTeam, CreateSkill, CreateCLI, Trim, Remotion, Fabric, Scheduler (launchd jobs that run myos; no notifications). Agents Designer, Engineer, Max.
- Memory: `MigrateMemory.ts --from-pai` copies the WORK ISAs, KNOWLEDGE, work.json and session names from pai and splits the 74 KB PROJECTS.md into a 6 KB always loaded index plus one file per project (`SplitProjects.ts`). Claude Code auto memory is off.
- Gates and CI: ContrabandCheck (no voice, notifications, servers, TELOS, Telegram, kitty), TestCoverageCheck (tool and test parity), PermissionRulesCheck, StyleCheck in three profiles, BudgetCheck, an em dash grep over every tracked file (also a pre commit hook), install smoke, idempotency and upgrade tests, hook import sweep.
- Not shipped, by decision: voice, notifications, Pulse and every local server, TELOS and life coaching, kitty tabs, Cloudflare sync, the Sonnet mode classifier and the three output modes, effort tiers, Forge and Cato (codex not installed), Research (no Perplexity key), every Gigs skill except the renamed MyTokens.
