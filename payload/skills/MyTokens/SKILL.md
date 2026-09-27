---
name: MyTokens
version: 1.0.0
description: Token consumption tracking for myos. A durable local log of every session's usage (per token class, model and skill), attributed to the prompt that triggered it, logged automatically. Reports over time, an HTML dashboard, per-session reviews naming cheaper routes and missed myos skills, recommendations grounded in your own usage. USE WHEN token report, token consumption, how many tokens, which models did I use, token dashboard, visualize tokens, reduce tokens, review that session, analyse session, what did that session cost, am I wasting tokens. NOT FOR rate-limit questions (the statusline shows those).
---

# MyTokens: know what myos costs, spend less of it

myos should be smart and conservative about token consumption. This skill makes
consumption visible: every session's usage is logged durably, mapped to the model that
produced it and the user prompt (activity) that triggered it, and turned into
recommendations grounded in your own usage rather than generic advice.

## How the data flows

Claude Code writes per-message usage (fresh input, cache write, cache read, output,
model, the attributed myos skill) into the session transcripts under `~/.myos/projects/`,
plus per-session subagent transcripts under `<project>/<session-id>/subagents/`, then
prunes it all after roughly 30 days. `Tools/TokenLog.ts` folds everything into a durable
store at
`~/.myos/MYOS/MEMORY/OBSERVABILITY/TOKENS/` (survives pruning and upgrades); the
`TokenLog.hook.ts` SessionEnd hook keeps the store current automatically, so no setup is
needed and history accumulates from install day. Everything stays on the machine.

```bash
bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts report --days 14   # text report
bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts report --json      # same, for analysis
bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts session <id>       # one session in full
bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts dashboard          # writes HTML, prints path
```

Session ids take any unique prefix; a logged session restarts with
`myos --resume <full-id>` run from its project directory.

## Reading the numbers

- **Output tokens** are the expensive class and the one to optimise first; fresh input
  and cache writes follow; cache reads are the bulk of the volume but the cheapest class.
  There are no dollar figures: transcripts carry `costUSD: null` and myos ships no price
  table to rot. Compare classes and models, not invented currency.
- **Cache efficiency** (reads / (reads + writes)) drops when work is spread across many
  short sessions with gaps beyond the cache TTL; batching related work into one session
  keeps it high.
- **Model matters**: Fable costs roughly twice Opus per token (see
  `MYOS/TOOLS/models.ts`); Haiku/Sonnet via `MYOS/TOOLS/Inference.ts` are the cheap tier
  for mechanical work. The by-model split shows where the expensive models actually go.
- **rtk savings render when rtk is on PATH** (the `rtk gain` summary), silently absent
  otherwise, inside the same `report` output.

## Workflows

| Intent | Workflow | What it does |
|---|---|---|
| "token report", "how many tokens this week", "which models" | `Workflows/Report.md` | totals by day, model and activity, with rtk savings alongside |
| "token dashboard", "visualize my token use" | `Workflows/Dashboard.md` | self-contained HTML dashboard, written locally and opened |
| "review session <id>", "what did that session cost", "analyse that session" | `Workflows/Review.md` | one session dissected: cheaper routes and missed myos skills, takeaways offered to memory |
| "how do I reduce tokens", "am I wasting tokens" | `Workflows/Advise.md` | ranked recommendations, each tied to evidence in your own log |

## Gotchas

- The log starts at the oldest transcript still on disk (~30 days back at first sync);
  history before that is gone. Transcripts from another config dir fold in once with
  `MYOS_TOKENLOG_PROJECTS=<that dir>/projects bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts sync`. From install day onward the SessionEnd hook accumulates
  everything.
- A session that is still running is counted mid-flight; its numbers grow until it ends.
  Exact-to-the-message comparisons only hold for closed sessions.
- Retried API calls repeat a message id inside a transcript; the log deduplicates by
  message id (last wins), so raw line counts exceed message counts.
- Subagent usage lives in separate transcripts (`<session-id>/subagents/agent-*.jsonl`),
  not inline; the log attributes each subagent message to the parent turn active at its
  timestamp and surfaces it as `subMsgs`/`subOut`. Fan-outs multiply output tokens, and
  this is where that shows.
- Skill attribution comes from the transcript's `attributionSkill` field: it records the
  skill Claude Code credits for a message, so turns with no skill loaded show an empty
  skills column (which is itself a Review signal).
- `<synthetic>` model rows are Claude Code internals (zero output); ignore them.
- Installer self-test sessions (`myos-release-probe`) are excluded from the log.
- Token logs contain your prompt snippets. They live in MEMORY like the rest of
  observability and stay local; don't paste them into external services.

## Rules

- The log is append-and-replace bookkeeping, never evidence of quality: it says what was
  spent, not whether it was worth it. Recommendations must weigh both.
- Reports state real numbers from the store; no extrapolation presented as measurement.
- Everything stays local: no token data leaves the machine.
