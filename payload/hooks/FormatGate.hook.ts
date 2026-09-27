#!/usr/bin/env bun
/**
 * FormatGate.hook.ts (Stop, via StopGates): measures the final message
 * against the myos format and logs it. It never blocks, in any mode: a Stop
 * hook fires after the text is on screen, so a block forces the whole answer
 * to print twice to fix one line. The runtime teeth are DriftReminder's
 * pre write contract; this is the telemetry that tells us if it works.
 *
 * Contract: banner line starting `════ myos ═══`, closer line starting
 * `🗣️ myos:`, zero em dashes in prose, no banned words; line count recorded.
 * Log: MEMORY/OBSERVABILITY/format-gate.jsonl. Graded on the stdin message.
 */
import { breaks, measure } from "./lib/format-contract";
import { gateLog, type GateOutcome } from "./lib/gates";
import { runStandalone, type GateContext } from "./lib/stop-context";

export const GATE = "FormatGate";
export const LOG_FILE = "format-gate.jsonl";

export async function run(ctx: GateContext): Promise<GateOutcome | null> {
  try {
    const message = ctx.message.trim();
    if (!message) return null;
    const m = measure(message);
    const broke = breaks(m);
    gateLog(LOG_FILE, {
      gate: GATE,
      verdict: broke.length ? "fail" : "pass",
      reason: broke.length ? broke.join(", ") : undefined,
      session: ctx.input.session_id,
      recovery: ctx.recovery || undefined,
      ...m,
    });
    return { gate: GATE, fail: broke.length > 0, reason: broke.join(", ") || undefined, block: false };
  } catch {
    return null;
  }
}

if (import.meta.main) runStandalone(run).finally(() => process.exit(0));
