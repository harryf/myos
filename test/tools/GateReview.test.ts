/**
 * GateReview reads the trial's gate logs back: counts per gate and reason,
 * would-block rows deduped by fingerprint or (session, reason), and the arming
 * rule of thumb. `mark` flips the trial flags TrialClock reads. Every run
 * points --dir at a scratch MYOS tree.
 */
import { describe, expect, test } from "bun:test";

import { runTool, tempDir } from "../harness.ts";
import { reasonKey, recommendation, summarize, type Row } from "../../payload/MYOS/TOOLS/GateReview.ts";

const TOOL = "payload/MYOS/TOOLS/GateReview.ts";
const OBS = "MEMORY/OBSERVABILITY";
const now = new Date().toISOString();
const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

const VERIFICATION = [
  { ts: now, gate: "VerificationGate", verdict: "fail", decision: "would-block", type: "T1", reason: "WEB DEPLOY", session: "s1", fingerprint: "aa", would_block: true },
  { ts: now, gate: "VerificationGate", verdict: "fail", decision: "would-block", type: "T1", reason: "WEB DEPLOY", session: "s1", fingerprint: "aa", would_block: true },
  { ts: now, gate: "VerificationGate", verdict: "pass", decision: "pass-verified", session: "s2" },
  { ts: old, gate: "VerificationGate", verdict: "fail", decision: "would-block", type: "T3", session: "s0", fingerprint: "zz", would_block: true },
];
const ISA = [
  { ts: now, gate: "ISACloseGate", verdict: "fail", reason: "ISA BEHIND THE WORK", session: "s3", would_block: true },
  { ts: now, gate: "ISACloseGate", verdict: "fail", reason: "ISA BEHIND THE WORK", session: "s3", would_block: true },
  { ts: now, gate: "ISAGate", verdict: "skip", reason: "legacy ISA", session: "s2" },
];
const FORMAT = Array.from({ length: 30 }, (_, i) => ({ ts: now, gate: "FormatGate", verdict: i % 2 ? "pass" : "fail", reason: "no banner on the first line", session: `f${i}` }));

function fixture(name: string) {
  return tempDir(`gatereview-${name}`, {
    [`${OBS}/verification-gate.jsonl`]: jsonl(VERIFICATION),
    [`${OBS}/isa-gates.jsonl`]: jsonl(ISA) + "{torn line\n",
    [`${OBS}/format-gate.jsonl`]: jsonl(FORMAT),
  });
}

describe("summarize (pure)", () => {
  test("would-block rows dedupe by fingerprint, else by session and reason; the window drops old rows", () => {
    const rep = summarize([...VERIFICATION, ...ISA] as Row[], 14);
    const v = rep.gates.find((g) => g.gate === "VerificationGate")!;
    expect(v.wouldBlock).toBe(1);
    expect(v.rows).toBe(3);
    const c = rep.gates.find((g) => g.gate === "ISACloseGate")!;
    expect(c.wouldBlock).toBe(1);
    expect(c.wouldBlockSessions).toBe(1);
    expect(rep.sessions).toBe(3);
  });

  test("reasons group by claim type, else by the first reason line", () => {
    expect(reasonKey({ type: "T2", reason: "long" })).toBe("T2");
    expect(reasonKey({ reason: "first line\nsecond" })).toBe("first line");
  });

  test("the rule of thumb names ISACloseGate under 5 percent as the first to arm", () => {
    const g = { gate: "ISACloseGate", rows: 1, pass: 0, fail: 1, skip: 0, wouldBlock: 1, blocked: 0, wouldBlockSessions: 1, reasons: {} };
    expect(recommendation(g, 40)).toContain("arm this one first");
    expect(recommendation(g, 10)).not.toContain("arm this one first");
    expect(recommendation({ ...g, gate: "FormatGate" }, 40)).toContain("log only by design");
  });
});

describe("the CLI", () => {
  test("report prints each gate with counts, reasons and a recommendation", async () => {
    using dir = fixture("report");
    const r = await runTool(TOOL, ["report", "--days", "14", "--dir", dir.path]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("session(s)");
    expect(r.stdout).toContain("VerificationGate: 3 rows");
    expect(r.stdout).toContain("would-block 1 (deduped)");
    expect(r.stdout).toContain("1 x T1");
    expect(r.stdout).toContain("15 x no banner on the first line");
    expect(r.stdout).toContain("ISACloseGate");
    expect(r.stdout).toContain("arm this one first");
  });

  test("report on an empty tree says so and exits 0", async () => {
    using dir = tempDir("gatereview-empty");
    const r = await runTool(TOOL, ["report", "--dir", dir.path]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("No gate rows yet.");
  });

  test("mark flips each flag in trial.json and keeps the rest", async () => {
    using dir = tempDir("gatereview-mark", {
      "USER/CONFIG/trial.json": JSON.stringify({ started: "2026-09-28", gate_review_done: false, doctrine_review_done: false }),
    });
    expect((await runTool(TOOL, ["mark", "gate-review-done", "--dir", dir.path])).exitCode).toBe(0);
    let trial = JSON.parse(await Bun.file(`${dir.path}/USER/CONFIG/trial.json`).text());
    expect(trial).toMatchObject({ started: "2026-09-28", gate_review_done: true, doctrine_review_done: false });
    await runTool(TOOL, ["mark", "doctrine-review-done", "--dir", dir.path]);
    trial = JSON.parse(await Bun.file(`${dir.path}/USER/CONFIG/trial.json`).text());
    expect(trial.doctrine_review_done).toBe(true);
  });

  test("Anti: an unknown flag or command exits 1 and writes nothing", async () => {
    using dir = tempDir("gatereview-bad");
    const bad = await runTool(TOOL, ["mark", "nonsense", "--dir", dir.path]);
    expect(bad.exitCode).toBe(1);
    expect(await Bun.file(`${dir.path}/USER/CONFIG/trial.json`).exists()).toBe(false);
    expect((await runTool(TOOL, ["frobnicate"])).exitCode).toBe(1);
  });
});
