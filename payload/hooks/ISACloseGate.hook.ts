#!/usr/bin/env bun
/**
 * ISACloseGate.hook.ts (Stop, via StopGates): a completion claim on an active
 * run whose ISA the work has outrun.
 *
 * Fails when ALL hold:
 *   1. the session is bound to an active run in work.json (phase not complete)
 *      and its ISA is not legacy
 *   2. the final message claims completion in a claimable unit
 *   3. the message does not address the ISA ("ISA updated", "no ISA delta needed")
 *   4. the ISA was not written this turn and no subagent ran (it may own the fold)
 *   5. at least ISACLOSEGATE_THRESHOLD (default 10) tool calls happened in the
 *      session since the last ISA write, counted from the transcript
 * Blocks once per run, and only when armed; log mode writes no latch.
 * Log: MEMORY/OBSERVABILITY/isa-gates.jsonl with gate "ISACloseGate".
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gateBlocking, gateLog, type GateOutcome } from "./lib/gates";
import { activeIsa, COMPLETION_RE, ISA_ADDRESSED_RE, ISA_LOG, isaEditedIn, toolCallsSinceIsaWrite } from "./lib/isa-gates";
import { myosPath } from "./lib/paths";
import { runStandalone, type GateContext } from "./lib/stop-context";
import { spawnedAgent } from "./lib/transcript-evidence";
import { splitIntoUnits, stripNoise, unitIsClaimable } from "./VerificationGate.hook";

export const GATE = "ISACloseGate";
export const LOG_FILE = ISA_LOG;
const DEFAULT_THRESHOLD = 10;
const latchPath = () => myosPath("MEMORY", "STATE", "isa-close-gate-blocked.json");

export function completionUnit(message: string): string | null {
  for (const u of splitIntoUnits(stripNoise(message)).filter((u) => unitIsClaimable(u))) {
    if (/^\s*(then|and\s+then|after\s+that|so\s+that)\b/i.test(u)) continue;
    if (COMPLETION_RE.test(u)) return u;
  }
  return null;
}

function fp(session: string, slug: string): string {
  return createHash("sha256").update(`${session}|${slug}`).digest("hex").slice(0, 16);
}
function latched(f: string): boolean {
  try { return existsSync(latchPath()) && (JSON.parse(readFileSync(latchPath(), "utf8")) as string[]).includes(f); } catch { return false; }
}
function latch(f: string): void {
  try {
    mkdirSync(dirname(latchPath()), { recursive: true });
    let arr: string[] = [];
    try { arr = JSON.parse(readFileSync(latchPath(), "utf8")); } catch { arr = []; }
    arr.push(f);
    writeFileSync(latchPath(), JSON.stringify(arr.slice(-400)));
  } catch { /* best effort */ }
}

export async function run(ctx: GateContext): Promise<GateOutcome | null> {
  try {
    const session = ctx.input.session_id;
    if (!ctx.message.trim() || !session) return null;
    const isa = activeIsa(session);
    if (!isa) return null;
    if ((isa.frontmatter.phase ?? "").toLowerCase() === "complete") return null;
    const unit = completionUnit(ctx.message);
    if (!unit) return null;
    const log = (rec: Record<string, unknown>) => { if (!ctx.recovery) gateLog(LOG_FILE, { gate: GATE, session, slug: isa.slug, verdict: "pass", ...rec } as any); };

    if (isa.legacy) { log({ verdict: "skip", reason: "legacy ISA" }); return null; }
    if (ISA_ADDRESSED_RE.test(stripNoise(ctx.message))) { log({ decision: "pass-isa-addressed" }); return null; }
    if (isaEditedIn(ctx.turnEvents)) { log({ decision: "pass-isa-edited" }); return null; }
    if (spawnedAgent(ctx.turnEvents)) { log({ decision: "pass-subagent" }); return null; }

    const threshold = Number(process.env.ISACLOSEGATE_THRESHOLD) || DEFAULT_THRESHOLD;
    const stale = toolCallsSinceIsaWrite(ctx.sessionEvents());
    if (stale < threshold) { log({ decision: "pass-fresh", stale }); return null; }

    const reason =
      `ISA BEHIND THE WORK [ISACloseGate]. You declared work complete ("${unit}") on '${isa.slug}', but its ISA has not been written in ${stale} tool calls and was not touched this turn. ` +
      `Close the finished claims with evidence, record decisions, update phase and progress in ${isa.path}, then restate; or say why no ISA delta is needed.`;
    if (ctx.recovery) return { gate: GATE, fail: true, reason };
    if (gateBlocking()) {
      const f = fp(session, isa.slug);
      if (latched(f)) { log({ decision: "pass-dedupe" }); return null; }
      latch(f);
      gateLog(LOG_FILE, { gate: GATE, verdict: "fail", reason, session, slug: isa.slug, stale, blocked: true });
      return { gate: GATE, fail: true, reason, block: true };
    }
    gateLog(LOG_FILE, { gate: GATE, verdict: "fail", reason, session, slug: isa.slug, stale, would_block: true });
    return { gate: GATE, fail: true, reason, block: false };
  } catch {
    return null;
  }
}

if (import.meta.main) runStandalone(run).finally(() => process.exit(0));
