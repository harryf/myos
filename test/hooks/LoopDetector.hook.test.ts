/**
 * LoopDetector watches PostToolUse for the three stuck-agent shapes: exact
 * repeat, a-b-a-b oscillation, failure hammering: and injects one LOOP
 * DETECTED context line per episode. The dedupe and cooldown matter as much
 * as the detection: an alert that re-fires every tool call trains the model
 * to ignore it.
 */

import { describe, expect, test } from "bun:test";

import { events, myosHome, runHook, type HookResult } from "./harness.ts";

const HOOK = "payload/hooks/LoopDetector.hook.ts";

function contextOf(result: HookResult): string | null {
  if (!result.stdout.trim()) return null;
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

function readCall(home: any, file: string) {
  return runHook(HOOK, {
    home,
    stdin: events.postToolUse("Read", { file_path: file }),
  });
}

describe("detection", () => {
  test("the third identical call trips the exact-repeat alarm, once", async () => {
    using home = myosHome("loop-repeat");
    expect(contextOf(await readCall(home, "a.ts"))).toBeNull();
    expect(contextOf(await readCall(home, "a.ts"))).toBeNull();

    const third = await readCall(home, "a.ts");
    expect(contextOf(third)).toContain("[LOOP DETECTED]");
    expect(contextOf(third)).toContain("Read");

    // Same episode, immediately after: deduped.
    expect(contextOf(await readCall(home, "a.ts"))).toBeNull();
  });

  test("varied inputs never trip anything", async () => {
    using home = myosHome("loop-varied");
    for (let i = 0; i < 6; i++) {
      const result = await runHook(HOOK, {
        home,
        stdin: events.postToolUse(`Tool${i}`, { index: i }),
      });
      expect(contextOf(result)).toBeNull();
    }
  });

  test("a-b-a-b oscillation trips on the fourth call", async () => {
    using home = myosHome("loop-osc");
    const a = () => runHook(HOOK, { home, stdin: events.postToolUse("Read", { f: "a" }) });
    const b = () => runHook(HOOK, { home, stdin: events.postToolUse("Edit", { f: "b" }) });

    await a();
    await b();
    await a();
    const fourth = await b();
    expect(contextOf(fourth)).toContain("flip-flopping");
  });

  test("repeated failures of one tool read as hammering", async () => {
    using home = myosHome("loop-hammer");
    let alert: string | null = null;
    for (let i = 0; i < 5; i++) {
      const result = await runHook(HOOK, {
        home,
        stdin: events.postToolUse("Bash", { command: `run ${i}` }, undefined, {
          error: "command not found",
        }),
      });
      alert = contextOf(result) ?? alert;
    }
    expect(alert).toContain("[LOOP DETECTED]");
    expect(alert).toContain("failed");
  });

  test("state is per-session: another session's window starts clean", async () => {
    using home = myosHome("loop-sessions");
    await readCall(home, "a.ts");
    await readCall(home, "a.ts");
    const otherSession = await runHook(HOOK, {
      home,
      stdin: events.postToolUse("Read", { file_path: "a.ts" }, undefined, {
        session_id: "someone-else",
      }),
    });
    expect(contextOf(otherSession)).toBeNull();
  });
});

describe("self-test", () => {
  test("the built-in --selftest passes", async () => {
    using home = myosHome("loop-selftest");
    // The selftest scratches under TMPDIR || cwd; point it at the sandbox.
    const result = await runHook(HOOK, { home, args: ["--selftest"], env: { TMPDIR: home.path } });
    expect(result.stdout).toContain("SELFTEST: PASS");
    expect(result.exitCode).toBe(0);
  });
});

describe("Anti", () => {
  test("Anti: malformed stdin exits 0 with no output", async () => {
    using home = myosHome("loop-badstdin");
    const result = await runHook(HOOK, { home, stdin: "{not json" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
