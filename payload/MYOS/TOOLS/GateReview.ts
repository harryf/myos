#!/usr/bin/env bun
/**
 * GateReview: the two week gate trial, read back from the logs.
 *
 * The Stop gates and the ISA guards run log only during the trial and write
 * every verdict to MEMORY/OBSERVABILITY. This tool counts them so the arming
 * decision is made on numbers:
 *
 *   bun GateReview.ts report [--days N] [--dir <MYOS dir>]
 *   bun GateReview.ts mark gate-review-done | doctrine-review-done [--dir <MYOS dir>]
 *
 * report reads format-gate.jsonl, verification-gate.jsonl and isa-gates.jsonl,
 * prints rows per gate and per reason, and dedupes would-block rows by their
 * fingerprint or, without one, by (session, reason). Whether a would-block
 * row was a false positive is not in the log: read the rows. The rule of
 * thumb from LifeOS: arm ISACloseGate first if its would-block sessions are
 * under 5 percent of all sessions.
 *
 * mark flips the matching done flag in USER/CONFIG/trial.json (TrialClock
 * stops reminding once both are done).
 *
 * The MYOS dir is --dir, else $MYOS_DIR, else ~/.myos/MYOS.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LOG_FILES = ["format-gate.jsonl", "verification-gate.jsonl", "isa-gates.jsonl"] as const;
export const ARM_FIRST_THRESHOLD_PCT = 5;

export interface Row {
  ts?: string;
  gate?: string;
  verdict?: string;
  decision?: string;
  reason?: string;
  session?: string;
  fingerprint?: string;
  type?: string;
  would_block?: boolean;
  blocked?: boolean;
  [k: string]: unknown;
}

export interface GateSummary {
  gate: string;
  rows: number;
  pass: number;
  fail: number;
  skip: number;
  wouldBlock: number;
  blocked: number;
  wouldBlockSessions: number;
  reasons: Record<string, number>;
}

export interface Report {
  days: number;
  sessions: number;
  gates: GateSummary[];
}

export function myosDir(argv: string[]): string {
  const i = argv.indexOf("--dir");
  if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
  return process.env.MYOS_DIR || join(homedir(), ".myos", "MYOS");
}

export function readRows(dir: string): Row[] {
  const rows: Row[] = [];
  for (const f of LOG_FILES) {
    const p = join(dir, "MEMORY", "OBSERVABILITY", f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as Row;
        if (!r.gate && f === "verification-gate.jsonl") r.gate = "VerificationGate";
        if (!r.gate && f === "format-gate.jsonl") r.gate = "FormatGate";
        rows.push(r);
      } catch {
        /* a torn line is skipped */
      }
    }
  }
  return rows;
}

/** A short, stable label for grouping: the claim type, else the first line of the reason. */
export function reasonKey(r: Row): string {
  if (r.type) return String(r.type);
  const first = String(r.reason ?? r.decision ?? r.verdict ?? "none").split("\n")[0]!;
  return first.length > 80 ? first.slice(0, 77) + "..." : first;
}

export function summarize(rows: Row[], days: number, now = Date.now()): Report {
  const since = now - days * 24 * 60 * 60 * 1000;
  const inWindow = rows.filter((r) => !r.ts || Date.parse(r.ts) >= since);
  const sessions = new Set(inWindow.map((r) => r.session).filter(Boolean));
  const byGate = new Map<string, Row[]>();
  for (const r of inWindow) {
    const g = r.gate ?? "unknown";
    if (!byGate.has(g)) byGate.set(g, []);
    byGate.get(g)!.push(r);
  }
  const gates: GateSummary[] = [];
  for (const [gate, list] of [...byGate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const seen = new Set<string>();
    const wb: Row[] = [];
    for (const r of list.filter((r) => r.would_block === true)) {
      const key = r.fingerprint ? `fp:${r.fingerprint}` : `sr:${r.session}|${r.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wb.push(r);
    }
    const reasons: Record<string, number> = {};
    // Reasons count each would-block once (deduped) plus every other failing row.
    const failing = [...list.filter((r) => r.verdict === "fail" && r.would_block !== true), ...wb];
    for (const r of failing) reasons[reasonKey(r)] = (reasons[reasonKey(r)] ?? 0) + 1;
    gates.push({
      gate,
      rows: list.length,
      pass: list.filter((r) => r.verdict === "pass").length,
      fail: list.filter((r) => r.verdict === "fail").length,
      skip: list.filter((r) => r.verdict === "skip").length,
      wouldBlock: wb.length,
      blocked: list.filter((r) => r.blocked === true).length,
      wouldBlockSessions: new Set(wb.map((r) => r.session).filter(Boolean)).size,
      reasons,
    });
  }
  return { days, sessions: sessions.size, gates };
}

export function recommendation(g: GateSummary, sessions: number): string {
  if (g.gate === "FormatGate") return "log only by design (a Stop block would print the answer twice)";
  if (sessions === 0) return "no sessions in the window: nothing to decide yet";
  const pct = (100 * g.wouldBlockSessions) / sessions;
  const share = `would block in ${g.wouldBlockSessions} of ${sessions} sessions (${pct.toFixed(1)}%)`;
  if (g.gate === "ISACloseGate" && pct < ARM_FIRST_THRESHOLD_PCT) {
    return `${share}; under ${ARM_FIRST_THRESHOLD_PCT}%: arm this one first once the rows read as real misses`;
  }
  return `${share}; read the rows: false positives are not in the log`;
}

export function render(rep: Report): string {
  const out: string[] = [];
  out.push(`Gate review, last ${rep.days} days, ${rep.sessions} session(s)`);
  if (rep.gates.length === 0) {
    out.push("No gate rows yet.");
    return out.join("\n");
  }
  for (const g of rep.gates) {
    out.push("");
    out.push(`${g.gate}: ${g.rows} rows, pass ${g.pass}, fail ${g.fail}, skip ${g.skip}, would-block ${g.wouldBlock} (deduped), blocked ${g.blocked}`);
    for (const [reason, n] of Object.entries(g.reasons).sort((a, b) => b[1] - a[1])) out.push(`  ${n} x ${reason}`);
    out.push(`  -> ${recommendation(g, rep.sessions)}`);
  }
  return out.join("\n");
}

export const FLAGS: Record<string, string> = {
  "gate-review-done": "gate_review_done",
  "doctrine-review-done": "doctrine_review_done",
};

export function markDone(dir: string, which: string): string {
  const key = FLAGS[which];
  if (!key) throw new Error(`unknown flag '${which}' (use ${Object.keys(FLAGS).join(" or ")})`);
  const p = join(dir, "USER", "CONFIG", "trial.json");
  let trial: Record<string, unknown> = {};
  if (existsSync(p)) trial = JSON.parse(readFileSync(p, "utf8"));
  trial[key] = true;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(trial, null, 2) + "\n");
  return p;
}

function usage(): string {
  return "usage: bun GateReview.ts report [--days N] [--dir <MYOS dir>]\n       bun GateReview.ts mark gate-review-done|doctrine-review-done [--dir <MYOS dir>]";
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const dir = myosDir(argv);
  try {
    if (cmd === "report") {
      const i = argv.indexOf("--days");
      const days = i >= 0 ? Number(argv[i + 1]) : 14;
      if (!Number.isFinite(days) || days <= 0) throw new Error("--days wants a positive number");
      console.log(render(summarize(readRows(dir), days)));
    } else if (cmd === "mark") {
      const p = markDone(dir, argv[1] ?? "");
      console.log(`${argv[1]} set in ${p}`);
    } else {
      console.error(usage());
      process.exit(cmd === "--help" || cmd === "-h" ? 0 : 1);
    }
  } catch (err) {
    console.error(`GateReview: ${(err as Error).message}`);
    process.exit(1);
  }
}
