# myos hooks

Every hook Claude Code runs for myos, what it is for, how to switch it off, and where it writes. Registration lives in `settings.template.json`; `test/hooks/HookContract.test.ts` keeps the two in step. No hook calls a model, talks to a local server or spawns `claude`. The only hook that reaches the network is PublicPushGate, through `gh`, and only on a push.

## Switches

| Switch | Values | Effect |
|---|---|---|
| `MYOS_GATES` | `off` | Every gate and ISA guard exits 0 silently (StopGates reads nothing). |
| | `log` | Gates evaluate and log `would_block` rows; nothing blocks. |
| | `block` | Every gate may block (exit 2, reason on stderr). |
| | unset | ISA gates follow `[gates] blocking` in `MYOS/USER/CONFIG/MYOS_CONFIG.toml` (default false, so log only). VerificationGate follows `[gates] verification` (`block` by default, `log` or `off`). |
| `MYOS_PUSHGATE` | `off` | Skips PublicPushGate. It is a security deny, so `MYOS_GATES` never touches it. |
| `VERIFGATE_OFF=1` | | Disables VerificationGate only. |
| `VERIFGATE_T1=0` (T2, T3, T5, TF) | | Demotes or disables one claim type. |
| `ISACLOSEGATE_THRESHOLD` | number | Tool calls since the last ISA write before ISACloseGate fails (default 10). |

The two week trial: gates run in log mode, `bun MYOS/TOOLS/GateReview.ts report` reads the logs, TrialClock reminds on the due dates in `MYOS/USER/CONFIG/trial.json`.

## Hooks

Logs are under `MYOS/MEMORY/OBSERVABILITY/` unless the path says otherwise.

| Hook | Event (matcher) | Purpose | Switch | Writes |
|---|---|---|---|---|
| HookHealer | SessionStart | chmod +x for registered scripts under `hooks/` that lost their exec bit; never touches content | none | `hook-healer.jsonl` |
| LoadContext | SessionStart | Active work summary from `work.json` (last 48 h) | none | none |
| TrialClock | SessionStart | "myos trial day N" and overdue review reminders from `trial.json` | delete `trial.json` or mark both reviews done | none |
| TimeContext | UserPromptSubmit | One live clock line, timezone from `[principal] timezone` (default Europe/Zurich) | none | none |
| DriftReminder | UserPromptSubmit | The format contract before writing, plus what the previous answer broke | none | none (reads `MEMORY/STATE/last-response.txt`) |
| PromptProcessing | UserPromptSubmit (async) | Session name = first prompt cut to 48 characters | none | `MEMORY/STATE/session-names.json` |
| ModelRungGuard | UserPromptSubmit (async) | One line when the session runs below the `model` pin in settings.json | none | none |
| ContextReduction | PreToolUse (Bash) | Rewrites build and VCS commands through rtk when rtk is installed | uninstall rtk | none |
| PublicPushGate | PreToolUse (Bash) | Deny scan of HEAD and history before a push to a public GitHub repo | `MYOS_PUSHGATE=off` | `MEMORY/STATE/public-push-gate.json` (visibility cache) |
| ISAStaleWriteGuard | PreToolUse (Write\|Edit), PostToolUse (Read\|Write\|Edit\|MultiEdit) | A whole file Write over an ISA that moved since this session saw it | `MYOS_GATES` | `isa-gates.jsonl`, `MEMORY/STATE/isa-session-view/` |
| AgentInvocation | PreToolUse and PostToolUse (Agent) | Subagent start and stop events with type and model | none | `subagent-events.jsonl` |
| ISASync | PostToolUse (Write\|Edit\|MultiEdit) | Mirrors ISA frontmatter and claims into `work.json`; both homes (`<project>/ISA.md`, `MEMORY/WORK/<slug>/ISA.md`) | none | `MEMORY/STATE/work.json` |
| CheckpointPerISC | PostToolUse (Write\|Edit\|MultiEdit) | Git commit per closed claim in repos that opted in | opt in per repo | the repo's git history |
| Safety | PostToolUse (WebFetch\|WebSearch), PermissionRequest (Bash\|Write\|Edit\|MultiEdit) | Tags fetched content as data; rule based permission classifier (no network, no model) | none | `permission-decisions.jsonl` |
| LoopDetector | PostToolUse, PostToolUseFailure | Repeats, oscillation and hammering | none | `MEMORY/STATE/loop-detector/` |
| EventLogger | PostToolUse, PostToolUseFailure, ConfigChange (async) | Tool activity, failures, config changes; rotated at 20 MB, two generations | none | `tool-activity.jsonl`, `tool-failures.jsonl`, `config-changes.jsonl`, `MEMORY/SKILLS/execution.jsonl` |
| TaskGovernance | TaskCreated | Task hygiene checks | none | `/tmp/myos-task-governance.json` (per process count) |
| LastResponseCache | Stop (first) | The final answer in full, for DriftReminder | none | `MEMORY/STATE/last-response.txt` |
| StopGates | Stop (second) | Runs the five gates below on one stdin read and one transcript parse; first block wins; recovery pass never blocks | `MYOS_GATES=off` | `MEMORY/STATE/stop-gates-last-block.json` |
| SessionCleanup | SessionEnd | Marks the session's `work.json` rows complete | none | `MEMORY/STATE/work.json` |
| TokenLog | SessionEnd (async) | Folds the session transcript into the token log (skills/MyTokens) | none | `TOKENS/` |

### Gates run by StopGates (in this order)

| Gate | Fails when | Blocks? | Writes |
|---|---|---|---|
| FormatGate | The answer lacks the `════ myos ═══` banner or the `🗣️ myos:` closer, has an em dash, or uses a banned word | Never (log only by design) | `format-gate.jsonl` |
| VerificationGate | A deploy (T1), flow (T2) or appearance (T3) claim has no matching evidence in the transcript (curl, Interceptor, or Claude in Chrome) | T1 to T3 by default; T4, T5, TF log only | `verification-gate.jsonl`, `MEMORY/STATE/verification-gate-blocked.json` |
| ISACloseGate | "Done" on an active run whose ISA has not been written for 10 or more tool calls | Only when armed; once per run | `isa-gates.jsonl` |
| ISAFoldGate | A publish, git push, launchctl, crontab, Grist write or `--apply`/`--activate` run changed live state and the ISA did not move | Only when armed | `isa-gates.jsonl` |
| ISAGate | An ISA written this turn says `phase: complete` but has open claims, no anti claim, fog, or a progress mismatch | Only when armed | `isa-gates.jsonl` |

Each gate also runs alone (`bun hooks/ISAGate.hook.ts < stop.json`). Legacy ISAs (frontmatter `effort:`) are skipped with a `skip` row.
