# Claude Code 2.1.x reference for a lean personal harness

Compiled 2026-09-27 by the claude-code-guide agent from code.claude.com/docs. Treat as a pointer list, not gospel: two details disagree with the live install and must be checked during implementation. `statusLine` in the live settings.json is a command object (`{type: "command", command: ...}`), not a boolean. Model IDs in the live environment are `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`; the `[1m]` suffix is accepted by the live install (`model: fable[1m]` in both pai and pmai settings) even though the reference below says it is not a settings value.

## 1. Hooks: events, inputs, blocking

https://code.claude.com/docs/en/hooks.md

| Event category | Event names | Blocking (exit 2) | JSON input fields | HTTP support |
|---|---|---|---|---|
| Session | SessionStart, Setup, SessionEnd | SessionStart blocks startup | session_id, cwd, transcript_path, effort.level, agent_id, agent_type | Yes: `type: http`, URL, headers, `allowedEnvVars` |
| Per turn | UserPromptSubmit, UserPromptExpansion, Stop, StopFailure | UserPromptSubmit blocks the prompt (30 s timeout), Stop continues the conversation | prompt_id, permission_mode | Response parsed as JSON output format |
| Tool execution | PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, PostToolBatch | PreToolUse blocks the tool call; PermissionRequest can deny | tool_name, tool_input, tool_use_id | Per event timeout: default 600 s; PermissionRequest 30 s |
| Subagent | SubagentStart, SubagentStop, TaskCreated, TaskCompleted | None blocking by default | agent_id, agent_type | HTTP hooks apply to all |
| Context | InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, TeammateIdle | ConfigChange blocks if the hook denies | varies; ConfigChange has config_path | Not documented for all events |
| Compaction | PreCompact, PostCompact | None | compaction_trigger (manual or auto) | Yes |
| Model | PreModelSwitch, PostModelSwitch | PreModelSwitch blocks, 30 s timeout | model_name | Yes |
| Worktree | WorktreeCreate, WorktreeRemove | Any non zero exit blocks | varies | Yes |
| MCP | Elicitation, ElicitationResult | None blocking by default | event specific | Yes |

Exit codes: 0 success (JSON output parsed for control), 2 always blocks, others non blocking. Output format: `hookSpecificOutput.permissionDecision: allow/deny/auto`, `additionalContext`, `updatedInput`, `retry`, `systemMessage`. Matcher syntax: tool name, regex, `mcp__<server>__<tool>`, session type (startup, resume, clear, compact, fork), agent type, notification type. Handler types: command, http, mcp_tool, prompt, agent. Path placeholders: `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`.

## 2. Skills: frontmatter, locations, triggering

https://code.claude.com/docs/en/skills.md

| Frontmatter field | Purpose | Example |
|---|---|---|
| `name` | Command name (invoked as /name) | `name: deploy` |
| `description` | Triggering: Claude matches this to decide when to load | `"Deploy app to production"` |
| `disable-model-invocation` | Only the user can invoke | `disable-model-invocation: true` |
| `user-invocable` | Only Claude can invoke | `user-invocable: false` |
| `allowed-tools` | Pre approve tools for this turn only | `allowed-tools: Bash(git *)` |
| `context` | Run in an isolated subagent | `context: fork` |
| `agent` | Subagent type | `agent: Explore` |
| `paths` | Limit to matching file patterns | `paths: "*.ts,*.tsx"` |
| `argument-hint` | Expected args in autocomplete | `argument-hint: "[issue-number]"` |
| `arguments` | Named args for `$name` substitution | `arguments: [issue, branch]` |

Locations (load order): enterprise managed, then user (`~/.claude/skills/NAME/SKILL.md`, or the CLAUDE_CONFIG_DIR equivalent), then project (`.claude/skills/NAME/SKILL.md`), then plugin. Triggering: Claude reads `description` and invokes when contextually relevant; `version:` is not a field Claude Code reads (it is a pmai convention). Dynamic content: `` !`command` `` blocks inject shell output; synced skills from claude.ai do not execute them. Substitutions: `$ARGUMENTS`, `$0/$1/$2`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`.

## 3. Settings

https://code.claude.com/docs/en/settings.md and https://code.claude.com/docs/en/settings-reference

Precedence (highest first): managed settings, command line `--settings`, project local `.claude/settings.local.json`, shared project `.claude/settings.json`, user `settings.json` in the config dir. Lists merge; model lists have special rules.

| Setting key | Values | Scope |
|---|---|---|
| `permissions.defaultMode` | `plan`, `ask`, `auto`, `dontAsk`, `bypassPermissions` | User or managed only |
| `permissions.allow` / `deny` / `ask` | Tool rules such as `Bash(git *)`, `Edit(~/Code/**)` | Merge across scopes |
| `postCompactRestore.fullFiles` | File paths reloaded after compaction | User, project, local, managed |
| `model` | Model id or alias; mid session via `/model` | User, project, managed |
| `modelSettings` | Per model effort and thinking | Highest precedence file wins |
| `effortLevel` | Low, Medium, High, XHigh, Max; mid session via `/effort` | User, project, managed |
| `statusLine` | Command object in the live install | User, project, local |
| `enabledPlugins` | Plugin ids | Project files can set |
| `env` | Environment variables | Some restricted from project files |

Auto mode: `permissions.defaultMode: auto` enables a server side classifier (Claude API and Enterprise users; opt out with `CLAUDE_CODE_AUTO_MODE_SERVER=0`). `CLAUDE_CONFIG_DIR` relocates the whole config dir (settings, sessions, plugins). `--setting-sources user,managed` limits which scopes load. `--append-system-prompt-file` appends a system prompt at launch.

## 4. Model leverage

https://code.claude.com/docs/en/agents.md, https://code.claude.com/docs/en/agent-view, https://code.claude.com/docs/en/agent-teams

| Feature | Configuration | Details |
|---|---|---|
| Effort and thinking | `effortLevel` or `/effort`; `modelSettings.{model}.effort` | Thinking auto enabled at higher efforts on newer models |
| Agent tool | `Agent(subagent_type, model, isolation)` | Custom agents from `agents/` in the config dir |
| Model field | `model` on the Agent call | Overrides the session default for that agent |
| Worktree isolation | `isolation: "worktree"` | Isolated git checkout per agent |
| Background agents | `run_in_background: true` | Non blocking; `/agents`, `/tasks` |
| Agent teams | `TeamCreate`, teammates with role and expertise, shared task list | Experimental; `teammateMode` setting |
| Workflow tool | `Workflow(script or name)` | Multi agent script with phases; `/workflows` |
| Monitor | `Monitor(...)` | Stream events from background processes |
| ScheduleWakeup and routines | `/loop`, `/schedule` | Routines run in the cloud, not on the machine |
| Forks | `/fork` or `context: fork` | Fork inherits full parent context |

## 5. Memory

https://code.claude.com/docs/en/memory.md

| Component | Details |
|---|---|
| Auto memory directory | `<config dir>/projects/<PROJECT>/memory/`; `autoMemoryDirectory` setting to relocate |
| MEMORY.md | Index, first 200 lines or 25 KB loaded at session start; topic files loaded on demand |
| Enable or disable | `/memory`, `autoMemoryEnabled: false`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` |
| @-imports in CLAUDE.md | `@path` syntax, relative to the importing file, four hop limit, imports outside the working directory prompt for approval |
| CLAUDE.md locations | Managed, user (config dir), project, project local (`CLAUDE.local.md`) |
| Path scoped rules | `.claude/rules/*.md` with `paths:` frontmatter |
| `/context` | Shows which instruction files loaded |

Size guidance from the docs: CLAUDE.md under 200 lines; auto memory index under 200 lines or 25 KB.

## 6. Changelog highlights, July to September 2026

https://code.claude.com/docs/en/changelog.md

| Feature | Version | Relevance |
|---|---|---|
| AGENTS.md read natively when no CLAUDE.md | v2.1.277 | Projects can carry AGENTS.md; `pluginConfigs."agents-md@builtin".options.instructionFiles` controls it |
| `/doctor prompt-audit` | v2.1.276+ | Audits CLAUDE.md for outdated patterns; useful when trimming |
| Server side auto mode classifier default | v2.1.276+ | Non billable; opt out with `CLAUDE_CODE_AUTO_MODE_SERVER=0` |
| Prompt cache fix on model switch, resume fixes, better `rm` validation | v2.1.276+ | Fewer surprises for hooks that switch models |
| Managed model controls (`availableModelsMatch`, `deniedModels`) | v2.1.276+ | Not needed for a single user |
| MCP URL mode elicitation | v2.1.276+ | Only if MCP servers are used |

Not documented (per the agent): Workflow tool MCP filtering, Monitor polling intervals, plugin eval and `/skill-doctor` specifics.
