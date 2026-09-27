#!/usr/bin/env bun
/**
 * StopGates.hook.ts (Stop): the one dispatcher for the Stop gates.
 *
 * Order: FormatGate, VerificationGate, ISACloseGate, ISAFoldGate, ISAGate.
 * stdin is read once and the transcript parsed once into a GateContext that
 * every gate's run() receives. The first gate that decides to block wins
 * (exit 2, reason on stderr); the rest are not evaluated after a block.
 *
 * Recovery (stop_hook_active true, the Stop right after a block): every
 * verdict is computed, nothing blocks, and the gate that blocked last time
 * logs `recovery-fixed` or `recovery-still-failing`.
 *
 * MYOS_GATES=off: exit 0 with empty stdout before reading anything.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { blockDecision, gateLog, gatesOff, type GateOutcome } from "./lib/gates";
import { readHookInput } from "./lib/hook-io";
import { myosPath } from "./lib/paths";
import { buildContext, type GateRun } from "./lib/stop-context";
import * as formatGate from "./FormatGate.hook";
import * as verificationGate from "./VerificationGate.hook";
import * as isaCloseGate from "./ISACloseGate.hook";
import * as isaFoldGate from "./ISAFoldGate.hook";
import * as isaGate from "./ISAGate.hook";

interface GateModule { GATE: string; LOG_FILE: string; run: GateRun }

export const GATES: GateModule[] = [formatGate, verificationGate, isaCloseGate, isaFoldGate, isaGate];

const lastBlockPath = () => myosPath("MEMORY", "STATE", "stop-gates-last-block.json");

function rememberBlock(session: string, gate: string): void {
  try {
    mkdirSync(dirname(lastBlockPath()), { recursive: true });
    writeFileSync(lastBlockPath(), JSON.stringify({ session, gate }));
  } catch { /* best effort */ }
}

function takeLastBlock(session: string): string | null {
  try {
    if (!existsSync(lastBlockPath())) return null;
    const rec = JSON.parse(readFileSync(lastBlockPath(), "utf8"));
    rmSync(lastBlockPath(), { force: true });
    return rec?.session === session ? String(rec.gate) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (gatesOff()) return;
  const input = await readHookInput();
  if (!input) return;
  const ctx = buildContext(input);
  const session = input.session_id ?? "";

  if (ctx.recovery) {
    const blocker = takeLastBlock(session);
    for (const g of GATES) {
      let out: GateOutcome | null = null;
      try { out = await g.run(ctx); } catch { out = null; }
      if (g.GATE === blocker) {
        gateLog(g.LOG_FILE, {
          gate: g.GATE,
          verdict: out?.fail ? "fail" : "pass",
          decision: out?.fail ? "recovery-still-failing" : "recovery-fixed",
          reason: out?.reason,
          session,
        });
      }
    }
    return;
  }

  for (const g of GATES) {
    let out: GateOutcome | null = null;
    try { out = await g.run(ctx); } catch { out = null; }
    if (out?.block && out.reason) {
      rememberBlock(session, g.GATE);
      blockDecision(out.reason);
    }
  }
}

if (import.meta.main) {
  main()
    .catch(() => { /* a gate must never be why a Stop breaks */ })
    .finally(() => process.exit(0));
}
