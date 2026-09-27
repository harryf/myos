/**
 * ISACloseGate: "done" on an active run whose ISA has not been written for
 * many tool calls. Staleness is counted from the transcript (session window),
 * the run is bound through ISASync exactly as in a live session.
 */
import { describe, expect, test } from "bun:test";

import { assistantToolUse, events, myosHome, runHook, SESSION_ID, toolResult, transcript, userText } from "./harness.ts";
import { bindIsa, busyWork, CURRENT, LEGACY } from "./isa-fixtures.ts";

const HOOK = "payload/hooks/ISACloseGate.hook.ts";
const LOG = ".myos/MYOS/MEMORY/OBSERVABILITY/isa-gates.jsonl";
const LATCH = `.myos/MYOS/MEMORY/STATE/isa-close-gate-blocked/${SESSION_ID}.json`;
type Home = ReturnType<typeof myosHome>;

const rows = async (home: Home) =>
  (await Bun.file(home.join(LOG)).exists())
    ? (await Bun.file(home.join(LOG)).text()).trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.gate === "ISACloseGate")
    : [];

function session(home: Home, isa: string, calls: number): string {
  return home.write("tx.jsonl", transcript(
    userText("start the report flag work"),
    assistantToolUse("Write", { file_path: isa }, "w1"),
    toolResult("w1", "ok"),
    userText("keep going"),
    ...busyWork(calls, assistantToolUse, toolResult),
  ));
}

describe("the gate", () => {
  test("done after 12 calls without an ISA write: logs would-block by default", async () => {
    using home = myosHome("closegate-log");
    const isa = await bindIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: session(home, isa, 12), last_assistant_message: "Done. The flag is implemented." }) });
    expect(r.exitCode).toBe(0);
    const last = (await rows(home)).at(-1);
    expect(last).toMatchObject({ verdict: "fail", would_block: true, stale: 12 });
    expect(await Bun.file(home.join(LATCH)).exists()).toBe(false);
  });

  test("armed, it blocks once per run", async () => {
    using home = myosHome("closegate-block");
    const isa = await bindIsa(home, CURRENT);
    const stdin = events.stop({ transcript_path: session(home, isa, 12), last_assistant_message: "Done." });
    const first = await runHook(HOOK, { home, stdin, env: { MYOS_GATES: "block" } });
    expect(first.exitCode).toBe(2);
    expect(first.stderr).toContain("ISACloseGate");
    const second = await runHook(HOOK, { home, stdin, env: { MYOS_GATES: "block" } });
    expect(second.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("pass-dedupe");
    expect(await Bun.file(home.join(LATCH)).exists()).toBe(true);
  });

  test("a reply that addresses the ISA passes", async () => {
    using home = myosHome("closegate-addressed");
    const isa = await bindIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: session(home, isa, 12), last_assistant_message: "Done. No ISA delta needed." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("pass-isa-addressed");
  });

  test("few calls since the last ISA write is fresh", async () => {
    using home = myosHome("closegate-fresh");
    const isa = await bindIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: session(home, isa, 3), last_assistant_message: "Done." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1)).toMatchObject({ decision: "pass-fresh", stale: 3 });
  });

  test("a legacy ISA on the run is skipped with a row", async () => {
    using home = myosHome("closegate-legacy");
    const isa = await bindIsa(home, LEGACY.replace("phase: complete", "phase: execute"), "Code/old/ISA.md");
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: session(home, isa, 12), last_assistant_message: "Done." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1)).toMatchObject({ verdict: "skip", reason: "legacy ISA" });
  });
});

describe("Anti", () => {
  test("Anti: no active run bound to the session means nothing to judge", async () => {
    using home = myosHome("closegate-norun");
    const isa = home.write("Code/x/ISA.md", CURRENT);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: session(home, isa, 12), last_assistant_message: "Done." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect(await rows(home)).toEqual([]);
  });
});
