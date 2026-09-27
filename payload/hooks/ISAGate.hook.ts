#!/usr/bin/env bun
/**
 * ISAGate.hook.ts (Stop, via StopGates): an ISA written this turn that says
 * `phase: complete` must be structurally complete (lib/isa-structure.ts): a
 * Goal, at least one anti claim, no open claims, progress as M/N matching the
 * claims, no fog left in `## Not yet specified`.
 *
 * Only ISAs this turn touched are judged, so old files are never gated
 * retroactively; legacy ISAs are skipped with a `skip` row. Mode: log only by
 * default ([gates] blocking or MYOS_GATES=block arms it). Log:
 * MEMORY/OBSERVABILITY/isa-gates.jsonl with gate "ISAGate".
 */
import { existsSync, readFileSync } from "node:fs";
import { gateBlocking, gateLog, isLegacyIsa, type GateOutcome } from "./lib/gates";
import { ISA_LOG, isIsaPath } from "./lib/isa-gates";
import { completionViolations } from "./lib/isa-structure";
import { parseFrontmatter } from "./lib/isa-utils";
import { runStandalone, type GateContext } from "./lib/stop-context";

export const GATE = "ISAGate";
export const LOG_FILE = ISA_LOG;

export async function run(ctx: GateContext): Promise<GateOutcome | null> {
  try {
    const session = ctx.input.session_id;
    const paths = [...new Set(ctx.turnEvents.filter((e) => e.kind === "edit" && isIsaPath(e.target)).map((e) => e.target))];
    const offenders: string[] = [];
    for (const p of paths) {
      if (!existsSync(p)) continue;
      const content = readFileSync(p, "utf8");
      const fm = parseFrontmatter(content) ?? {};
      if (isLegacyIsa(fm)) {
        if (!ctx.recovery) gateLog(LOG_FILE, { gate: GATE, verdict: "skip", reason: "legacy ISA", session, isa: p });
        continue;
      }
      if ((fm.phase ?? "").trim().toLowerCase() !== "complete") continue;
      const v = completionViolations(content);
      if (v.length) offenders.push(`${p}\n${v.map((x) => `  [${x.code}] ${x.message}`).join("\n")}`);
      else if (!ctx.recovery) gateLog(LOG_FILE, { gate: GATE, verdict: "pass", session, isa: p });
    }
    if (!offenders.length) return null;

    const reason =
      `ISA NOT READY TO CLOSE [ISAGate]. An ISA set to phase: complete this turn has structural gaps:\n${offenders.join("\n")}\n` +
      `Fix them (close or drop the open claims with evidence, add an anti claim, write progress as M/N, graduate the fog), or set phase back to climbing.`;
    if (ctx.recovery) return { gate: GATE, fail: true, reason };
    if (gateBlocking()) {
      gateLog(LOG_FILE, { gate: GATE, verdict: "fail", reason, session, blocked: true });
      return { gate: GATE, fail: true, reason, block: true };
    }
    gateLog(LOG_FILE, { gate: GATE, verdict: "fail", reason, session, would_block: true });
    return { gate: GATE, fail: true, reason, block: false };
  } catch {
    return null;
  }
}

if (import.meta.main) runStandalone(run).finally(() => process.exit(0));
