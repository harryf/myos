/**
 * ISAGate: an ISA written this turn at `phase: complete` must be structurally
 * complete. Log only by default; MYOS_GATES=block arms it. Legacy ISAs are
 * skipped with a row. Uses the golden fixtures only.
 */
import { describe, expect, test } from "bun:test";

import { assistantToolUse, events, myosHome, runHook, toolResult, transcript, userText } from "./harness.ts";
import { closedCurrent, CURRENT, LEGACY } from "./isa-fixtures.ts";
import { completionViolations } from "../../payload/hooks/lib/isa-structure.ts";

const HOOK = "payload/hooks/ISAGate.hook.ts";
const LOG = ".myos/MYOS/MEMORY/OBSERVABILITY/isa-gates.jsonl";
type Home = ReturnType<typeof myosHome>;

const rows = async (home: Home) =>
  (await Bun.file(home.join(LOG)).exists())
    ? (await Bun.file(home.join(LOG)).text()).trim().split("\n").map((l) => JSON.parse(l))
    : [];

function editedTurn(home: Home, isa: string): string {
  return home.write("tx.jsonl", transcript(userText("close it"), assistantToolUse("Edit", { file_path: isa }, "e1"), toolResult("e1", "ok")));
}

const COMPLETE_BUT_OPEN = CURRENT.replace("phase: climbing", "phase: complete");

describe("structure (pure)", () => {
  test("the closed fixture has no violations", () => {
    expect(completionViolations(closedCurrent())).toEqual([]);
  });
  test("complete with open claims, fog and a stale progress fails on each", () => {
    const codes = completionViolations(COMPLETE_BUT_OPEN).map((v) => v.code);
    expect(codes).toContain("open-claims");
    expect(codes).toContain("fog-at-complete");
    expect(completionViolations(closedCurrent().replace("progress: 4/4", "progress: 3/4")).map((v) => v.code)).toEqual(["progress-mismatch"]);
    expect(completionViolations(closedCurrent().replace(/^- \[x\] A1:.*\n/m, "").replace("4/4", "3/3")).map((v) => v.code)).toEqual(["no-anti"]);
  });
});

describe("the gate", () => {
  test("a clean close passes with a pass row", async () => {
    using home = myosHome("isagate-pass");
    const isa = home.write("Code/tool/ISA.md", closedCurrent());
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: editedTurn(home, isa) }) });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1)).toMatchObject({ gate: "ISAGate", verdict: "pass" });
  });

  test("default mode logs would-block and exits 0", async () => {
    using home = myosHome("isagate-log");
    const isa = home.write("Code/tool/ISA.md", COMPLETE_BUT_OPEN);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: editedTurn(home, isa) }) });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    const last = (await rows(home)).at(-1);
    expect(last).toMatchObject({ gate: "ISAGate", verdict: "fail", would_block: true });
    expect(last.reason).toContain("open-claims");
  });

  test("MYOS_GATES=block blocks with exit 2", async () => {
    using home = myosHome("isagate-block");
    const isa = home.write("Code/tool/ISA.md", COMPLETE_BUT_OPEN);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: editedTurn(home, isa) }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("ISAGate");
  });

  test("[gates] blocking = true in the config arms it too", async () => {
    using home = myosHome("isagate-config", { ".myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml": "[gates]\nblocking = true\n" });
    const isa = home.write("Code/tool/ISA.md", COMPLETE_BUT_OPEN);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: editedTurn(home, isa) }) });
    expect(r.exitCode).toBe(2);
  });

  test("the legacy fixture passes with a skip row", async () => {
    using home = myosHome("isagate-legacy");
    const isa = home.write("Code/old/ISA.md", LEGACY);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: editedTurn(home, isa) }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1)).toMatchObject({ gate: "ISAGate", verdict: "skip", reason: "legacy ISA" });
  });
});

describe("Anti", () => {
  test("Anti: an ISA the turn did not touch is never judged", async () => {
    using home = myosHome("isagate-untouched");
    home.write("Code/tool/ISA.md", COMPLETE_BUT_OPEN);
    const tx = home.write("tx.jsonl", transcript(userText("status?")));
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: tx }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect(await rows(home)).toEqual([]);
  });

  test("Anti: MYOS_GATES=off is silent", async () => {
    using home = myosHome("isagate-off");
    const isa = home.write("Code/tool/ISA.md", COMPLETE_BUT_OPEN);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: editedTurn(home, isa) }), env: { MYOS_GATES: "off" } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
    expect(await rows(home)).toEqual([]);
  });
});
