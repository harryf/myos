#!/usr/bin/env bun
/**
 * ISAFoldGate.hook.ts (Stop, via StopGates): live state changed this turn,
 * the active run's ISA did not.
 *
 * Fails when ALL hold:
 *   1. the session is bound to an active, non legacy run (phase not complete)
 *   2. the turn made at least one successful prod mutation (shapes below)
 *   3. the ISA was not written this turn and the reply does not address it
 *   4. no subagent ran (else logged as pass-delegated with the
 *      would_block_without_subagent counterfactual)
 * No latch: every mutating turn owes its fold.
 * Log: MEMORY/OBSERVABILITY/isa-gates.jsonl with gate "ISAFoldGate".
 */
import { gateBlocking, gateLog, type GateOutcome } from "./lib/gates";
import { activeIsa, ISA_ADDRESSED_RE, ISA_LOG, isaEditedIn } from "./lib/isa-gates";
import { runStandalone, type GateContext } from "./lib/stop-context";
import { spawnedAgent, type TxEvent } from "./lib/transcript-evidence";

export const GATE = "ISAFoldGate";
export const LOG_FILE = ISA_LOG;

/** Command shapes that change something outside this machine or its scheduler. */
export const PROD_MUTATION_RES: RegExp[] = [
  /~\/bin\/publish\b|\/bin\/publish\s/, // Harry's site publisher
  /\bgit\b[^\n;&|]*\bpush\b/,
  /\blaunchctl\s+(?!(list|print|help|version)\b)\w/,
  /\bcrontab\b(?![^\n;&|]*\s-l\b)/,
  /\s--(apply|activate)\b/, // the write flag of Harry's scripts (Meta ads, sync tools)
];
const GRIST_URL = /getgrist\.com/i;
const CURL_WRITE = /\bcurl\b[^\n]*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|--request[=\s]+(POST|PUT|PATCH|DELETE)\b|\s--data(-\w+)?\b|\s-d\s|--json\b)/i;

// A lone search or display command names these strings without running them.
const READ_ONLY_CMD_RE = /^\s*(rg|grep|egrep|fgrep|ag|ack|cat|head|tail|ls|wc|echo)\b/;
const SHELL_CHAIN_RE = /[;&|`\n]|\$\(/;
const EXEC_FLAG_RE = /--(pre|pre-glob|hostname-bin|pager)\b/;

export function isProdMutation(command: string): boolean {
  if (!command) return false;
  if (READ_ONLY_CMD_RE.test(command) && !SHELL_CHAIN_RE.test(command) && !EXEC_FLAG_RE.test(command)) return false;
  if (GRIST_URL.test(command) && CURL_WRITE.test(command)) return true;
  return PROD_MUTATION_RES.some((re) => re.test(command));
}

export function prodMutations(ev: TxEvent[]): TxEvent[] {
  return ev.filter((e) => e.tool === "Bash" && !e.isError && isProdMutation(e.command ?? e.target));
}

export async function run(ctx: GateContext): Promise<GateOutcome | null> {
  try {
    const session = ctx.input.session_id;
    const isa = activeIsa(session);
    if (!isa || (isa.frontmatter.phase ?? "").toLowerCase() === "complete") return null;
    const mutations = prodMutations(ctx.turnEvents);
    if (mutations.length === 0) return null;
    const log = (rec: Record<string, unknown>) => { if (!ctx.recovery) gateLog(LOG_FILE, { gate: GATE, session, slug: isa.slug, verdict: "pass", ...rec } as any); };

    if (isa.legacy) { log({ verdict: "skip", reason: "legacy ISA" }); return null; }
    if (isaEditedIn(ctx.turnEvents)) { log({ decision: "pass-isa-edited", mutations: mutations.length }); return null; }
    if (ISA_ADDRESSED_RE.test(ctx.message)) { log({ decision: "pass-isa-addressed" }); return null; }
    if (spawnedAgent(ctx.turnEvents)) {
      log({ decision: "pass-delegated", would_block_without_subagent: true, mutations: mutations.length });
      return null;
    }

    const sample = mutations.slice(0, 3).map((m) => (m.command ?? m.target).slice(0, 60)).join(" | ");
    const reason =
      `ISA FOLD MISSING [ISAFoldGate]. This turn changed live state (${mutations.length} call(s): ${sample}) on '${isa.slug}', ` +
      `but the ISA was not touched and the reply does not mention it. Fold the new state into ${isa.path} (evidence on the affected claims, progress and phase), then restate; or say why no ISA delta is needed.`;
    if (ctx.recovery) return { gate: GATE, fail: true, reason };
    if (gateBlocking()) {
      gateLog(LOG_FILE, { gate: GATE, verdict: "fail", reason, session, slug: isa.slug, blocked: true });
      return { gate: GATE, fail: true, reason, block: true };
    }
    gateLog(LOG_FILE, { gate: GATE, verdict: "fail", reason, session, slug: isa.slug, would_block: true });
    return { gate: GATE, fail: true, reason, block: false };
  } catch {
    return null;
  }
}

if (import.meta.main) runStandalone(run).finally(() => process.exit(0));
