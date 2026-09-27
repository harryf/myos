/**
 * TaskGovernance is a BLOCKING hook (TaskCreated): exit 0 allows the task,
 * exit 2 blocks it with stderr fed back to the model. Its two rules: no
 * empty descriptions, max 50 tasks per session: are cheap insurance against
 * runaway subagent spawning, so both the allow and both block paths are
 * pinned, plus the fail-open contract on garbage stdin (a parse crash used to
 * exit 1, which is neither allow nor block).
 *
 * The session counter lives at a FIXED /tmp path keyed by ppid, so this file
 * saves and restores whatever a live session may have there.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { myosHome, runHook } from "./harness.ts";

const HOOK = "payload/hooks/TaskGovernance.hook.ts";
const TRACK_FILE = "/tmp/myos-task-governance.json";

let saved: string | null = null;

beforeAll(() => {
  saved = existsSync(TRACK_FILE) ? readFileSync(TRACK_FILE, "utf8") : null;
});

afterAll(() => {
  if (saved === null) rmSync(TRACK_FILE, { force: true });
  else writeFileSync(TRACK_FILE, saved);
});

/** The hook counts per parent pid; children spawned here see this process. */
const OUR_PPID = String(process.pid);

describe("governance", () => {
  test("a meaningful description is allowed", async () => {
    using home = myosHome("taskgov-allow");
    writeFileSync(TRACK_FILE, JSON.stringify({ ppid: OUR_PPID, count: 0 }));

    const result = await runHook(HOOK, {
      home,
      stdin: { task_description: "Investigate the failing statusline probe" },
    });
    expect(result.exitCode).toBe(0);

    const track = JSON.parse(readFileSync(TRACK_FILE, "utf8"));
    expect(track).toEqual({ ppid: OUR_PPID, count: 1 });
  });

  test("a too-short description is blocked with actionable feedback", async () => {
    using home = myosHome("taskgov-short");
    const result = await runHook(HOOK, { home, stdin: { task_description: "fix it" } });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("description too short");
  });

  test("the 50-task session cap blocks task 51", async () => {
    using home = myosHome("taskgov-cap");
    writeFileSync(TRACK_FILE, JSON.stringify({ ppid: OUR_PPID, count: 50 }));

    const result = await runHook(HOOK, {
      home,
      stdin: { task_description: "A perfectly good description of real work" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("session limit of 50 tasks");
  });

  test("a different parent pid reads as a new session: the counter resets", async () => {
    using home = myosHome("taskgov-newsession");
    writeFileSync(TRACK_FILE, JSON.stringify({ ppid: "999999", count: 50 }));

    const result = await runHook(HOOK, {
      home,
      stdin: { task_description: "First task of a brand new session" },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(TRACK_FILE, "utf8"))).toEqual({ ppid: OUR_PPID, count: 1 });
  });
});

describe("Anti", () => {
  test("Anti: unparseable stdin allows (exit 0): a blocking hook fails open, never exit 1", async () => {
    using home = myosHome("taskgov-badstdin");
    const result = await runHook(HOOK, { home, stdin: "{not json" });
    expect(result.exitCode).toBe(0);
  });

  test("Anti: empty stdin allows too", async () => {
    using home = myosHome("taskgov-empty");
    const result = await runHook(HOOK, { home });
    expect(result.exitCode).toBe(0);
  });
});
