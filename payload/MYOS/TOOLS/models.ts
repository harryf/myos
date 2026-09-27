#!/usr/bin/env bun
/**
 * ============================================================================
 * MODELS: single source of truth for model IDs across myos
 * ============================================================================
 *
 * WHY THIS EXISTS:
 * Model IDs pinned in scattered files drift silently on every release. This
 * file is the one place that knows current IDs. Consumers either:
 *   (a) use a tier ALIAS ("opus"/"sonnet"/"haiku"): auto-resolves to latest,
 *       no registry needed (preferred: see Inference.ts), or
 *   (b) import CURRENT[...] from here when they genuinely need a pinned ID
 *       (e.g. a drift-check that must name the expected latest).
 *
 * ON A NEW RELEASE: bump CURRENT below. That is the only edit.

 * Claude only: myos ships no route to any other vendor.
 * ============================================================================
 */

export type ClaudeTier = "opus" | "sonnet" | "haiku" | "fable";

/**
 * ============================================================================
 * EFFORT LEVELS: the four-level abstraction over the Claude lineup
 * ============================================================================
 *
 * Consumers name INTENT (max/high/medium/low), never a model name. Two
 * independent edit points keep the system cohesive across model churn:
 *
 *   Layer 1  EFFORT_MODEL  level → tier   edit when the LINEUP changes
 *                                          (a model enters/exits the
 *                                          subscription, or moves rungs)
 *   Layer 2  CURRENT       tier → ID      edit when a VERSION releases
 *
 * NO ROUTING POLICY LIVES HERE: which level a given piece of work gets is a
 * per-dispatch judgment call: no hook injection, no classifier, no tier
 * rubric. This table is the dial behind `Inference.ts --level` and the display
 * labels (statusline, AgentInvocation logging). `medium`/`low` exist so cheap
 * utility calls (classification, summarization, vision triage) have named rungs.
 */
export type EffortLevel = "max" | "high" | "medium" | "low";

/**
 * Level → tier binding. THIS IS THE SINGLE EDIT POINT on a lineup change.
 * Example: Fable exits the subscription → `max: "opus"` and every consumer
 * follows; no other code changes. Fable is the top rung (~2× Opus cost), so
 * `max` and `high` are distinct models and the Inference.ts max-fallback
 * (fable→opus) is a genuinely real degraded path.
 *
 * BASELINE: model selection is a per-dispatch judgment call. No hook injects
 * models (AgentInvocation v1.3.0 observes only), no classifier routes tiers, no
 * rubric maps work to rungs. Unspecified delegate models inherit the session
 * model (harness behavior).
 *
 * CARRIER REALITY: tool-contract facts, not steering:
 *   - Agent dispatches execute their model FAITHFULLY: explicit `model: fable`
 *     executes claude-fable-5, and bare inheritance from a Fable main loop
 *     executes claude-fable-5. A subagent's self-report is NOT evidence of
 *     which model ran: the transcript is.
 *   - VERIFICATION: Inference.ts reads the executed model back from the JSON
 *     envelope's modelUsage (verifyExecutedModel: filters the background haiku
 *     pass, takes the highest-output model as the answer's author, checks its
 *     family) and logs any downgrade to model-verification.jsonl. The system
 *     reports what RAN, never what it requested.
 */

/** Machine-readable carrier fact: do Agent dispatches execute Fable when asked
 * (explicitly or via inheritance)? The statusline maps fable-labeled and
 * fable-inherited dispatches to the FABLE rung only when true. Flip ONLY on
 * transcript evidence. */
export const DISPATCH_EXECUTES_FABLE = true;
export const EFFORT_MODEL: Record<EffortLevel, ClaudeTier> = {
  max: "fable",   // top rung (~2× Opus)
  high: "opus",
  medium: "sonnet",
  low: "haiku",
};

/**
 * THREE DISTINCT "level" dials: don't conflate (this file maps dials 1↔2):
 *   1. MODEL RUNG (EFFORT_MODEL above): which Claude model runs: max|high|medium|low.
 *   2. REASONING EFFORT (HarnessEffort): how hard a model thinks within itself,
 *      Claude-Code-owned (`/effort`/settings/`--effort`); a hook can read but NOT
 *      set the main loop's value. myos runs UNIFORMLY at `high` and emits no other
 *      level; the statusline still shows the full scale.
 *   3. COMPOSITION (ultracode): whether to fan a task into a multi-agent Workflow , 
 *      not an effort level; rides on `high`, detected via output-style, orthogonal to 1&2.
 */

/** Axis 2: the harness reasoning-effort knob (Claude Code `--effort`). */
export type HarnessEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * MODEL RUNG → REASONING EFFORT (consumed by Inference.ts). Uniformly `high` , 
 * every rung thinks at high; the MODEL rung still varies (EFFORT_MODEL).
 */
export const LEVEL_TO_HARNESS_EFFORT: Record<EffortLevel, HarnessEffort> = {
  max: "high",
  high: "high",
  medium: "high",   // effort uniformly high 2026-07-06 (model rung still varies via EFFORT_MODEL)
  low: "high",
};

/** Auto-tracking alias for an effort level (preferred: never drifts). */
export function modelForEffort(level: EffortLevel): string {
  return ALIAS[EFFORT_MODEL[level]];
}

/** Current pinned ID for an effort level (when an exact ID is required). */
export function pinnedModelForEffort(level: EffortLevel): string {
  return CURRENT[EFFORT_MODEL[level]];
}

/**
 * Current Claude model IDs. THIS IS THE SINGLE EDIT POINT on a model release.
 * Verify the exact string against the models overview / migration guide before
 * bumping.
 */
export const CURRENT: Record<ClaudeTier, string> = {
  fable: "claude-fable-5-1",
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
};

/**
 * Tier aliases. The `claude` CLI and spawnClaude resolve these to the latest
 * model in the tier automatically. Prefer these in consumers that accept a
 * string and don't need a pinned ID: they never drift.
 */
export const ALIAS: Record<ClaudeTier, string> = {
  fable: "fable",
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
};

/** Current pinned ID for a Claude tier. */
export function currentModel(tier: ClaudeTier): string {
  return CURRENT[tier];
}

/** Auto-tracking alias for a Claude tier. */
export function alias(tier: ClaudeTier): string {
  return ALIAS[tier];
}

/** Every current Claude ID, for drift scanning. */
export function allCurrentClaudeIds(): string[] {
  return Object.values(CURRENT);
}

/**
 * Dated/pinned Claude-ID pattern. Matches claude-{tier}-{major}[-{minor}][-date]
 * (the Claude 5 lineup dropped the minor version, e.g. "claude-sonnet-5") and
 * claude-{tier}-{major}-{minor}[-date] (older two-part IDs like "claude-opus-4-8").
 * Used by the drift scanner to find pinned IDs that may be stale.
 */
export const CLAUDE_ID_PATTERN = /claude-(opus|sonnet|haiku|fable)-\d+(?:-\d+)?(?:-\d{8})?/g;

/** True if `id` is a known-current Claude ID. */
export function isCurrent(id: string): boolean {
  return allCurrentClaudeIds().includes(id);
}
