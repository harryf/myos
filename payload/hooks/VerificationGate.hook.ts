#!/usr/bin/env bun
/**
 * VerificationGate.hook.ts (Stop, via StopGates): the message is a claim, the
 * transcript is the evidence.
 *
 * Claims are read from the final message; evidence only from the transcript's
 * real tool calls, so rewording never passes it and a terse message backed by
 * a real probe never fails it. A claim fails when ALL hold:
 *   1. a claim of a known type survives the guards (negation, question,
 *      intent, conditional, quote, narration, honest downgrade)
 *   2. act then claim: this turn did mutating work of that type
 *   3. the type's evidence is absent after the last mutation
 *   4. no subagent ran this turn (it may hold the evidence; the would-block
 *      counterfactual is still logged)
 *
 * Types: T1 web deploy, T2 interactive flow, T3 appearance (these three
 * block), T4 code logic, T5 publicity, TF completion over a failed final
 * command (these three log only). Browser evidence is Interceptor or Claude
 * in Chrome, see lib/transcript-evidence.ts.
 *
 * Mode: lib/gates.ts verificationMode(). Default block; MYOS_GATES=log logs
 * `would-block` with the full reason and writes no latch; MYOS_GATES=off is
 * silent. Per type: VERIFGATE_T1=0 (and T2, T3) demote that type to log.
 * Log: MEMORY/OBSERVABILITY/verification-gate.jsonl. Fails open everywhere.
 *
 * Ported from LifeOS 7.40.4 VerificationGate 1.0.6
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gateLog, verificationMode, type GateOutcome } from "./lib/gates";
import { myosPath } from "./lib/paths";
import { runStandalone, type GateContext } from "./lib/stop-context";
import {
  flowExercised, hadCodeEdit, hadDeploy, hadFlowEdit, hadFrontendEdit, pixelViewed,
  probedAfterDeploy, spawnedAgent, testPassedAfterEdit, type TxEvent,
} from "./lib/transcript-evidence";

export const GATE = "VerificationGate";
export const LOG_FILE = "verification-gate.jsonl";
const latchPath = () => myosPath("MEMORY", "STATE", "verification-gate-blocked.json");

// Claim units

/** Splits on sentence and clause marks, but never inside a dotted number. */
export function splitIntoUnits(text: string): string[] {
  return text
    .split(/\n+|(?<!\d)[.!?;,]+|[.!?;,]+(?!\d)/)
    .map((u) => (u ?? "").trim())
    .filter(Boolean);
}

/** Code, inline code and blockquotes are examples, not claims. */
export function stripNoise(msg: string): string {
  return msg
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s*>.*$/gm, " ");
}

const HONEST_DOWNGRADE =
  /\b(DEFERRED[\s-]?VERIFY|not\s+(yet\s+)?(browser[\s-]?|pixel[\s-]?|end[\s-]?to[\s-]?end\s+)?verif\w*|not\s+verified\b|haven'?t\s+(yet\s+)?(browser[\s-]?|actually\s+)?(verif\w*|exercised|tested|looked|driven)|deployed\s+but\s+not\s+\w*\s*verif\w*|flow\s+not\s+exercised|not\s+(yet\s+)?(browser[\s-]?)?tested|pending\s+(browser\s+|live\s+|your\s+)?(verif\w*|tap|test)|your\s+(tap|test)\s+to\s+confirm|verifying\s+(next|now)|verify\s+next|checking\s+now|probing\s+(it\s+)?now|about\s+to\s+(verify|test|check|probe)|running\s+the\s+(check|probe|test|verification)|next[\s:]+verif\w*|couldn'?t\s+(capture|verify|reach)|can'?t\s+(mint|verify|drive))\b/i;
const NONCLAIM =
  /\b(not|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|didn'?t|won'?t|can'?t|cannot|couldn'?t|no\s+longer|still\s+(not|broken|500|failing)|never|needs?\s+to|should\s+be|would\s+be|make\s+sure|please|let'?s|going\s+to|will\s+be|to\s+be|want|hope|expect|if\s|once\s|when\s|after\s|assuming|would|could\s+you|can\s+you)\b/i;
const LEADING_INTERROGATIVE =
  /^\s*(is|are|does|do|did|can|could|should|would|will|has|have|how|why|what|where|when|which|who|isn'?t|aren'?t)\b/i;
const LEADING_IMPERATIVE =
  /^\s*(run|do|execute|try|click|open|deploy|add|set|install|go|check|make|use|call|start|restart|edit|write|create|build|test|verify|ensure|remember\s+to)\b/i;
const RECIPE = /\b(then|and\s+then|after\s+that)\b[^.\n]{0,40}\b(works?|is\s+live|verified|passes?)\b/i;
const ATTRIBUTION =
  /\b(you\s+(said|asked|told|mentioned)|per\s+the|according\s+to|the\s+(ticket|PR|docs?|user|issue|spec)\s+(say|says|said|claims?)|"[^"]*")\b/i;
const NARRATION =
  /\b(earlier|already|previously|in\s+(the\s+)?prior\s+turns?|prior\s+turns?|last\s+turn)\b|\b(in|back\s+in|since|during)\s+(19|20)\d\d\b/i;

export function unitIsClaimable(u: string, opts?: { allowNarration?: boolean }): boolean {
  if (u.includes("?")) return false;
  if (LEADING_INTERROGATIVE.test(u)) return false;
  if (LEADING_IMPERATIVE.test(u)) return false;
  if (RECIPE.test(u)) return false;
  if (NONCLAIM.test(u)) return false;
  if (ATTRIBUTION.test(u)) return false;
  // Publicity opts out: "already published" asserts public state just as hard.
  if (!opts?.allowNarration && NARRATION.test(u)) return false;
  return true;
}

const T1_LIVE = /\b((is|it'?s|site'?s|page'?s|now)\s+live|went\s+live|live\s+(at|on)|deployed\s+(to|at|and\s+(live|working))|deploy\s+(is\s+)?(complete|done|succeeded)|published\s+(to|at))\b/i;
const T1_WEBNOUN = /\b(site|page|web\s*site|url|domain|https?:\/\/|worker|deploy(ment|ed)?|production|prod\b|admin|dashboard|published)\b/i;
const T2_FLOW = /\b(log[\s-]?in|sign[\s-]?in|sign[\s-]?up|auth(entication|orization)?|oauth|sso|checkout|payment|purchase|the\s+(login|sign[\s-]?in|auth|checkout)\s+flow)\b/i;
const T2_WORKS = /\b(works?(\s+(now|end[\s-]?to[\s-]?end|fine|correctly|great))?|working|functional|verified(\s+working)?|confirmed\s+working|succeeds?|can\s+(now\s+)?(log|sign)\s+in|completes?|goes?\s+through)\b/i;
const T3_VISUAL = /\b(logo|image|icon|favicon|thumbnail|hero|banner|button|layout|header|footer|nav(bar)?|wordmark|graphic|background|colou?r|card|flyer)\b/i;
const T3_LOOK = /\b(renders?|rendered|displays?|displayed|looks?\s+(right|correct|good|great|fine)|is\s+(now\s+)?(centered|centred|aligned|transparent|visible|positioned|the\s+(right|correct)\s+colou?r))\b/i;
const T4_CODE = /\b(tests?\s+(pass|green|passing)|\d+\s*\/\s*\d+\s+(pass|green)|all\s+(green|passing)|verified\s+(with|via)\s+a?\s*(run|test)|it\s+works\b)\b/i;
const T5_SURFACE = /\b(public\s+repo|public\s+repository|github|the\s+public|docs\s+site|release[ds]?|published|v?\d+\.\d+\.\d+)\b/i;
const T5_PREDICATE = /\b(is|are|'s|was|were|now|already)\s+(public|live|released|shipped|published|out)\b/i;
const T5_LOCAL = /\b(local(ly)?|staged?|staging|payload|private\s+repo|~\/\.myos|candidate)\b/i;
const PUBLIC_PROBE = /\bgit\s+ls-remote\b|\bgh\s+(api|release|repo|search)\b|github\.com|\bgit\s+fetch\b|\borigin\/main\b/i;

export type ClaimType = "T1" | "T2" | "T3" | "T4" | "T5" | "TF";
const BLOCKING_TYPES = new Set<ClaimType>(["T1", "T2", "T3"]);

export function classifyClaim(message: string): { type: "T1" | "T2" | "T3" | "T4"; unit: string } | null {
  const units = splitIntoUnits(stripNoise(message)).filter((u) => unitIsClaimable(u));
  let t1: string | null = null, t3: string | null = null, t4: string | null = null;
  for (const u of units) {
    // A visual noun makes it a look claim: "the sign-in button works" is T3.
    if (T2_FLOW.test(u) && T2_WORKS.test(u) && !T3_VISUAL.test(u)) return { type: "T2", unit: u };
    if (!t1 && T1_LIVE.test(u) && T1_WEBNOUN.test(u)) t1 = u;
    if (!t3 && T3_VISUAL.test(u) && T3_LOOK.test(u)) t3 = u;
    if (!t4 && T4_CODE.test(u)) t4 = u;
  }
  if (t1) return { type: "T1", unit: t1 };
  if (t3) return { type: "T3", unit: t3 };
  if (t4) return { type: "T4", unit: t4 };
  return null;
}

export function publicityClaimUnit(message: string): string | null {
  for (const u of splitIntoUnits(stripNoise(message)).filter((u) => unitIsClaimable(u, { allowNarration: true }))) {
    if (T5_LOCAL.test(u)) continue;
    if (T5_SURFACE.test(u) && T5_PREDICATE.test(u)) return u;
  }
  return null;
}

const GENERIC_FLOW =
  /\b(live\s+and\s+verified|it\s+works\b|works\s+now|works\s+end[\s-]?to[\s-]?end|confirmed\s+working|fully\s+working|sign[\s-]?in\s+works|login\s+works|working\s+(now|end[\s-]?to[\s-]?end)|both\s+(apps\s+)?(live|working|verified))\b/i;
export function genericFlowClaimUnit(message: string): string | null {
  for (const u of splitIntoUnits(stripNoise(message)).filter((u) => unitIsClaimable(u))) {
    if (GENERIC_FLOW.test(u)) return u;
  }
  return null;
}

const HARD_FAIL =
  /\btraceback\s*\(most recent call last\)|\bcommand not found\b|\bpermission denied\b|\bno such file or directory\b|\bexit(ed)?(\s+with)?(\s+code)?\s+[1-9]\d*\b|\bsegmentation fault\b|\bpanic:\s/i;
const COMPLETION =
  /\b(done|complete(d)?|finished|fixed|resolved|all\s+set|checks?\s+out|success(ful|fully)?|works?\s+(now|fine|correctly)|good\s+to\s+go|everything('?s)?\s+(fine|working|good))\b/i;
const ACKNOWLEDGES_FAILURE =
  /\b(fail(s|ed|ure|ing)?|error(s|ed)?|traceback|exception|broke|broken|didn'?t\s+(work|run|parse)|couldn'?t|hit\s+a\s+(snag|wall)|blocked)\b/i;

/** Completion claimed while the turn's final tool call hard failed. */
export function contradictedCompletionUnit(message: string, evs: TxEvent[]): string | null {
  const last = evs[evs.length - 1];
  if (!last || !last.isToolError || !HARD_FAIL.test(last.resultText)) return null;
  const stripped = stripNoise(message);
  if (ACKNOWLEDGES_FAILURE.test(stripped)) return null;
  for (const u of splitIntoUnits(stripped).filter((u) => unitIsClaimable(u))) if (COMPLETION.test(u)) return u;
  return null;
}

// Latch and evidence

export function fingerprint(session: string, type: string, unit: string): string {
  return createHash("sha256").update(`${session}|${type}|${unit.toLowerCase().replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 16);
}
function latched(fp: string): boolean {
  try {
    return existsSync(latchPath()) && (JSON.parse(readFileSync(latchPath(), "utf8")) as string[]).includes(fp);
  } catch { return false; }
}
function latch(fp: string): void {
  try {
    const p = latchPath();
    mkdirSync(dirname(p), { recursive: true });
    let arr: string[] = [];
    try { arr = JSON.parse(readFileSync(p, "utf8")); } catch { arr = []; }
    arr.push(fp);
    writeFileSync(p, JSON.stringify(arr.slice(-400)));
  } catch { /* best effort */ }
}

function evaluate(type: "T1" | "T2" | "T3" | "T4", ev: TxEvent[]): { acted: boolean; verified: boolean; gap: string } {
  if (type === "T1") {
    return { acted: hadDeploy(ev), verified: probedAfterDeploy(ev), gap: `${ev.filter((e) => e.kind === "deploy").length} deploy(s), no probe of the deployed origin after the last one` };
  }
  if (type === "T2") {
    const caps = ev.filter((e) => e.kind === "browser-capture").length;
    const inter = ev.filter((e) => e.kind === "browser-interact").length;
    return { acted: hadCodeEdit(ev) || hadDeploy(ev), verified: flowExercised(ev), gap: `${caps} capture(s), ${inter} interaction(s), no successful round trip after the last change` };
  }
  if (type === "T3") {
    return { acted: hadFrontendEdit(ev), verified: pixelViewed(ev), gap: "no screenshot viewed after the last frontend edit" };
  }
  return { acted: hadCodeEdit(ev), verified: testPassedAfterEdit(ev), gap: "no passing test run after the last code edit" };
}

const REASONS: Record<"T1" | "T2" | "T3", (u: string, gap: string) => string> = {
  T1: (u, gap) => `WEB DEPLOY NOT VERIFIED [VerificationGate/T1]. You claimed: "${u}". The transcript shows ${gap}. Deployed is not live. Either probe the live URL now (curl with a 2xx/3xx, Interceptor, or Claude in Chrome navigate or screenshot) and restate, or downgrade honestly ("deployed, not verified live"). This gate reads tool calls, not wording.`,
  T2: (u, gap) => `FLOW NOT EXERCISED [VerificationGate/T2]. You claimed: "${u}". The transcript shows ${gap}. A screenshot proves a page painted, not that the flow works. Drive the flow (navigate, interact, read the result) or hit the endpoint and show the 2xx/3xx, then restate; or downgrade ("flow not exercised"). This gate reads tool calls, not wording.`,
  T3: (u, gap) => `APPEARANCE NOT VIEWED [VerificationGate/T3]. You claimed: "${u}". The transcript shows ${gap}. A DOM read proves an element exists; only viewed pixels prove it looks right. Take a screenshot (Claude in Chrome, or Interceptor plus Read of the image), then restate; or downgrade ("placed, not pixel viewed").`,
};

// The gate

export async function run(ctx: GateContext): Promise<GateOutcome | null> {
  try {
    const mode = verificationMode();
    if (mode === "off" || process.env.VERIFGATE_OFF === "1") return null;
    const session = ctx.input.session_id ?? "unknown";
    const message = ctx.message;
    if (!message.trim()) return null;
    const log = (rec: Record<string, unknown>) => {
      if (!ctx.recovery) gateLog(LOG_FILE, { gate: GATE, session, mode, verdict: "pass", ...rec } as any);
    };
    const pass = (decision: string, extra: Record<string, unknown> = {}): null => { log({ decision, ...extra }); return null; };

    if (HONEST_DOWNGRADE.test(stripNoise(message))) return pass("pass-honest-downgrade");
    const ev = ctx.turnEvents;

    // A failing verdict: block, would-block, or (on recovery) just report.
    const fail = (type: ClaimType, unit: string, reason: string, extra: Record<string, unknown> = {}): GateOutcome | null => {
      const fp = fingerprint(session, type, unit);
      if (ctx.recovery) return { gate: GATE, fail: true, reason };
      const armed = mode === "block" && BLOCKING_TYPES.has(type) && process.env[`VERIFGATE_${type}`] !== "0";
      if (armed && latched(fp)) return pass("pass-dedupe", { type });
      if (!armed) {
        log({ verdict: "fail", decision: "would-block", type, unit, reason, fingerprint: fp, would_block: true, ...extra });
        return { gate: GATE, fail: true, reason, block: false };
      }
      latch(fp);
      log({ verdict: "fail", decision: "block", type, unit, reason, fingerprint: fp, blocked: true, ...extra });
      return { gate: GATE, fail: true, reason, block: true };
    };

    if (process.env.VERIFGATE_TF !== "0" && !spawnedAgent(ev)) {
      const tf = contradictedCompletionUnit(message, ev);
      if (tf) {
        return fail("TF", tf, `COMPLETION OVER A FAILURE [VerificationGate/TF]. You claimed: "${tf}", but the turn's final tool call failed and nothing ran after it. Fix and re-run it, or say it failed.`);
      }
    }

    if (process.env.VERIFGATE_T5 !== "0") {
      const pub = publicityClaimUnit(message);
      if (pub && !ctx.sessionEvents().some((e) => PUBLIC_PROBE.test(e.command ?? e.target))) {
        const out = fail("T5", pub, `UNPROBED PUBLICITY CLAIM [VerificationGate/T5]. You asserted: "${pub}", but nothing this session probed the public side (git ls-remote, gh api or repo view, a github.com fetch).`);
        if (out) return out;
      }
    }

    let claim = classifyClaim(message);
    if (!claim || claim.type === "T1") {
      const gu = genericFlowClaimUnit(message);
      if (gu && hadFlowEdit(ev)) claim = { type: "T2", unit: gu };
    }
    if (!claim) return pass("no-claim");

    const { acted, verified, gap } = evaluate(claim.type, ev);
    if (spawnedAgent(ev)) {
      return pass("pass-subagent", { type: claim.type, unit: claim.unit, would_block_without_subagent: acted && !verified });
    }
    if (!acted) return pass("pass-no-activity", { type: claim.type });
    if (verified) return pass("pass-verified", { type: claim.type });

    const reason = claim.type === "T4"
      ? `CODE CLAIM WITHOUT A PASSING TEST [VerificationGate/T4]. You claimed: "${claim.unit}". The transcript shows ${gap}.`
      : REASONS[claim.type](claim.unit, gap);
    return fail(claim.type, claim.unit, reason, { gap });
  } catch {
    return null;
  }
}

if (import.meta.main) runStandalone(run).finally(() => process.exit(0));
