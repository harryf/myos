/**
 * ISAStaleWriteGuard: a whole file Write over an ISA that moved on disk since
 * this session last saw it. PostToolUse records the view, PreToolUse checks.
 * Mode follows lib/gates.ts; legacy ISAs are exempt.
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { events, myosHome, runHook } from "./harness.ts";
import { CURRENT, LEGACY } from "./isa-fixtures.ts";

const HOOK = "payload/hooks/ISAStaleWriteGuard.hook.ts";
const LOG = ".myos/MYOS/MEMORY/OBSERVABILITY/isa-gates.jsonl";
type Home = ReturnType<typeof myosHome>;

/** Session reads the ISA, then another writer changes it. */
async function movedIsa(home: Home, content: string): Promise<string> {
  const isa = home.write("Code/tool/ISA.md", content);
  await runHook(HOOK, { home, stdin: events.postToolUse("Read", { file_path: isa }) });
  writeFileSync(isa, content + "\n- 2026-09-28 10:00: another session closed C2.\n");
  return isa;
}
const write = (isa: string) => events.preToolUse("Write", { file_path: isa, content: "whole file" });

describe("modes", () => {
  test("block: a Write over a moved ISA exits 2", async () => {
    using home = myosHome("stale-block");
    const isa = await movedIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: write(isa), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("STALE ISA WRITE");
  });

  test("log (the default): would-block row, exit 0", async () => {
    using home = myosHome("stale-log");
    const isa = await movedIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: write(isa) });
    expect(r.exitCode).toBe(0);
    const row = JSON.parse((await Bun.file(home.join(LOG)).text()).trim());
    expect(row).toMatchObject({ gate: "ISAStaleWriteGuard", verdict: "fail", would_block: true });
  });

  test("off: passes silently", async () => {
    using home = myosHome("stale-off");
    const isa = await movedIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: write(isa), env: { MYOS_GATES: "off" } });
    expect(r.exitCode).toBe(0);
    expect(await Bun.file(home.join(LOG)).exists()).toBe(false);
  });
});

describe("what passes", () => {
  test("a Write after re-reading the moved ISA passes", async () => {
    using home = myosHome("stale-reread");
    const isa = await movedIsa(home, CURRENT);
    await runHook(HOOK, { home, stdin: events.postToolUse("Read", { file_path: isa }) });
    const r = await runHook(HOOK, { home, stdin: write(isa), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
  });

  test("Edit is never blocked (it keeps other changes by construction)", async () => {
    using home = myosHome("stale-edit");
    const isa = await movedIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: events.preToolUse("Edit", { file_path: isa }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
  });

  test("a legacy ISA is exempt", async () => {
    using home = myosHome("stale-legacy");
    const isa = await movedIsa(home, LEGACY);
    const r = await runHook(HOOK, { home, stdin: write(isa), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
  });

  test("Anti: never seen in this session means no view, so it fails open", async () => {
    using home = myosHome("stale-unseen");
    const isa = home.write("Code/tool/ISA.md", CURRENT);
    const r = await runHook(HOOK, { home, stdin: write(isa), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
  });
});
