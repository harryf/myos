/**
 * TrialClock prints the trial day and any overdue review. Every branch:
 * missing file, both done, before due, gate due, doctrine due, one done.
 */
import { describe, expect, test } from "bun:test";

import { myosHome, runHook } from "./harness.ts";

const HOOK = "payload/hooks/TrialClock.hook.ts";
const TRIAL = ".myos/MYOS/USER/CONFIG/trial.json";
const base = { started: "2026-09-28", gate_review_due: "2026-10-12", doctrine_review_due: "2026-10-19", gate_review_done: false, doctrine_review_done: false };

async function run(name: string, trial: object | null, now: string) {
  using home = myosHome(name, trial ? { [TRIAL]: JSON.stringify(trial) } : {});
  return await runHook(HOOK, { home, stdin: { hook_event_name: "SessionStart" }, env: { MYOS_NOW: now } });
}

describe("TrialClock", () => {
  test("missing file: silent", async () => {
    const r = await run("trial-missing", null, "2026-10-01T08:00:00Z");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("before any due date: the day only", async () => {
    const r = await run("trial-day", base, "2026-10-01T08:00:00Z");
    expect(r.stdout.trim()).toBe("myos trial day 4");
  });

  test("gate review due and not done", async () => {
    const r = await run("trial-gate", base, "2026-10-12T08:00:00Z");
    expect(r.stdout).toContain("myos trial day 15");
    expect(r.stdout).toContain("Gate arming review due: run `bun MYOS/TOOLS/GateReview.ts report`");
    expect(r.stdout).not.toContain("Doctrine");
  });

  test("both due", async () => {
    const r = await run("trial-both", base, "2026-10-20T08:00:00Z");
    expect(r.stdout).toContain("Gate arming review due");
    expect(r.stdout).toContain("Doctrine and Evals review due (see PLAN.md phase 6)");
  });

  test("gate review done: only the doctrine line", async () => {
    const r = await run("trial-gate-done", { ...base, gate_review_done: true }, "2026-10-20T08:00:00Z");
    expect(r.stdout).not.toContain("Gate arming");
    expect(r.stdout).toContain("Doctrine and Evals review due");
  });

  test("both done: silent", async () => {
    const r = await run("trial-done", { ...base, gate_review_done: true, doctrine_review_done: true }, "2026-10-20T08:00:00Z");
    expect(r.stdout).toBe("");
  });

  test("Anti: a corrupt file is silent, exit 0", async () => {
    using home = myosHome("trial-corrupt", { [TRIAL]: "{nope" });
    const r = await runHook(HOOK, { home, stdin: {} });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });
});
