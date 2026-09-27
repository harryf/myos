/**
 * TaskGovernance is a BLOCKING hook (TaskCreated): exit 0 allows, exit 2
 * blocks with stderr fed back to the model. Rules: no near-empty
 * descriptions, at most 50 tasks per session. The counter lives under the
 * sandbox MEMORY/STATE, keyed by session_id, so tests never touch /tmp.
 */
import { describe, expect, test } from "bun:test";

import { myosHome, runHook, SESSION_ID } from "./harness.ts";

const HOOK = "payload/hooks/TaskGovernance.hook.ts";
const COUNTER = (id = SESSION_ID) => `.myos/MYOS/MEMORY/STATE/task-governance/${id}.json`;
const task = (task_description: string, session_id = SESSION_ID) => ({ session_id, hook_event_name: "TaskCreated", task_description });

describe("governance", () => {
  test("a meaningful description is allowed and counted for its session", async () => {
    using home = myosHome("taskgov-allow");
    const r = await runHook(HOOK, { home, stdin: task("Investigate the failing statusline probe") });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(await Bun.file(home.join(COUNTER())).text())).toEqual({ count: 1 });
  });

  test("a too-short description is blocked with actionable feedback", async () => {
    using home = myosHome("taskgov-short");
    const r = await runHook(HOOK, { home, stdin: task("fix it") });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("description too short");
  });

  test("the 50-task session cap blocks task 51", async () => {
    using home = myosHome("taskgov-cap", { [COUNTER()]: JSON.stringify({ count: 50 }) });
    const r = await runHook(HOOK, { home, stdin: task("A perfectly good description of real work") });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("session limit of 50 tasks");
  });

  test("another session has its own counter", async () => {
    using home = myosHome("taskgov-other", { [COUNTER()]: JSON.stringify({ count: 50 }) });
    const r = await runHook(HOOK, { home, stdin: task("First task of a different session", "other-session") });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(await Bun.file(home.join(COUNTER("other-session"))).text())).toEqual({ count: 1 });
  });
});

describe("Anti", () => {
  test("Anti: unparseable stdin allows (exit 0): a blocking hook fails open", async () => {
    using home = myosHome("taskgov-badstdin");
    expect((await runHook(HOOK, { home, stdin: "{not json" })).exitCode).toBe(0);
  });

  test("Anti: empty stdin allows too", async () => {
    using home = myosHome("taskgov-empty");
    expect((await runHook(HOOK, { home })).exitCode).toBe(0);
  });
});
