/**
 * FormatGate grades the stdin message against the myos format and logs it.
 * It never blocks, even with MYOS_GATES=block.
 */
import { describe, expect, test } from "bun:test";

import { events, myosHome, runHook } from "./harness.ts";
import { breaks, measure } from "../../payload/hooks/lib/format-contract.ts";

const HOOK = "payload/hooks/FormatGate.hook.ts";
const LOG = ".myos/MYOS/MEMORY/OBSERVABILITY/format-gate.jsonl";
const DASH = "\u2014";
const GOOD = "════ myos ═══════════\nThe answer, first.\n🗣️ myos: done and clean";

const last = async (home: ReturnType<typeof myosHome>) =>
  JSON.parse((await Bun.file(home.join(LOG)).text()).trim().split("\n").at(-1)!);

describe("measure (pure)", () => {
  test("a clean answer breaks nothing", () => {
    expect(breaks(measure(GOOD))).toEqual([]);
  });
  test("banner, closer, em dash and banned word are each caught", () => {
    const bad = `Answer first ${DASH} with a robust plan.\nno closer`;
    const b = breaks(measure(bad));
    expect(b).toContain("no banner on the first line");
    expect(b).toContain("no closer on the last line");
    expect(b).toContain("1 em dash");
    expect(b).toContain("banned word 'robust'");
  });
  test("em dashes inside code do not count", () => {
    expect(measure(`${GOOD}\n\`\`\`\na ${DASH} b\n\`\`\`\n🗣️ myos: x`).emDashes).toBe(0);
  });
});

describe("the gate", () => {
  test("a clean message logs a pass with the line count", async () => {
    using home = myosHome("fmt-pass");
    const r = await runHook(HOOK, { home, stdin: events.stop({ last_assistant_message: GOOD }) });
    expect(r.exitCode).toBe(0);
    expect(await last(home)).toMatchObject({ gate: "FormatGate", verdict: "pass", lines: 3, emDashes: 0 });
  });

  test("a broken message logs a fail and still never blocks, even armed", async () => {
    using home = myosHome("fmt-fail");
    const r = await runHook(HOOK, {
      home,
      stdin: events.stop({ last_assistant_message: `Plain ${DASH} answer` }),
      env: { MYOS_GATES: "block" },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    const row = await last(home);
    expect(row.verdict).toBe("fail");
    expect(row.reason).toContain("em dash");
  });

  test("Anti: MYOS_GATES=off writes nothing (positive control: log mode writes one row)", async () => {
    using control = myosHome("fmt-off-control");
    await runHook(HOOK, { home: control, stdin: events.stop({ last_assistant_message: "x" }), env: { MYOS_GATES: "log" } });
    expect((await Bun.file(control.join(LOG)).text()).trim().split("\n")).toHaveLength(1);
    using home = myosHome("fmt-off");
    await runHook(HOOK, { home, stdin: events.stop({ last_assistant_message: "x" }), env: { MYOS_GATES: "off" } });
    expect(await Bun.file(home.join(LOG)).exists()).toBe(false);
  });
});
