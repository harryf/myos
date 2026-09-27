/**
 * StopGates: one stdin read, one transcript parse, five gates in a fixed
 * order, first block wins. The kill switch exits before anything else, and
 * the recovery pass never blocks but records whether the block was fixed.
 */
import { describe, expect, test } from "bun:test";

import { assistantToolUse, events, myosHome, runHook, toolResult, transcript, userText } from "./harness.ts";
import { GATES } from "../../payload/hooks/StopGates.hook.ts";

const HOOK = "payload/hooks/StopGates.hook.ts";
const OBS = ".myos/MYOS/MEMORY/OBSERVABILITY";
type Home = ReturnType<typeof myosHome>;
const rows = async (home: Home, file: string) =>
  (await Bun.file(home.join(`${OBS}/${file}`)).exists())
    ? (await Bun.file(home.join(`${OBS}/${file}`)).text()).trim().split("\n").map((l) => JSON.parse(l))
    : [];

function deployTurn(home: Home): string {
  return home.write("tx.jsonl", transcript(
    userText("publish"),
    assistantToolUse("Bash", { command: "~/bin/publish site/a.html a --private -y" }, "d1"),
    toolResult("d1", "Pushed"),
  ));
}
const CLAIM = "════ myos ═══\nThe page is live at https://example.github.io/private/a.html.\n🗣️ myos: live";

describe("dispatch", () => {
  test("the order is FormatGate, VerificationGate, ISACloseGate, ISAFoldGate, ISAGate", () => {
    expect(GATES.map((g) => g.GATE)).toEqual(["FormatGate", "VerificationGate", "ISACloseGate", "ISAFoldGate", "ISAGate"]);
  });

  test("an unverified deploy blocks through the dispatcher; FormatGate still logged first", async () => {
    using home = myosHome("stopgates-block");
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: deployTurn(home), last_assistant_message: CLAIM }) });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("VerificationGate/T1");
    expect((await rows(home, "format-gate.jsonl")).length).toBe(1);
  });

  test("the recovery pass never blocks and logs recovery-still-failing for the blocker", async () => {
    using home = myosHome("stopgates-recovery");
    const tx = deployTurn(home);
    await runHook(HOOK, { home, stdin: events.stop({ transcript_path: tx, last_assistant_message: CLAIM }) });
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: tx, last_assistant_message: CLAIM, stop_hook_active: true }) });
    expect(r.exitCode).toBe(0);
    expect((await rows(home, "verification-gate.jsonl")).at(-1).decision).toBe("recovery-still-failing");
  });

  test("a recovery turn that downgraded honestly logs recovery-fixed", async () => {
    using home = myosHome("stopgates-fixed");
    const tx = deployTurn(home);
    await runHook(HOOK, { home, stdin: events.stop({ transcript_path: tx, last_assistant_message: CLAIM }) });
    const r = await runHook(HOOK, {
      home,
      stdin: events.stop({ transcript_path: tx, last_assistant_message: "Published, not verified live yet.", stop_hook_active: true }),
    });
    expect(r.exitCode).toBe(0);
    expect((await rows(home, "verification-gate.jsonl")).at(-1).decision).toBe("recovery-fixed");
  });
});

describe("Anti", () => {
  test("Anti: MYOS_GATES=off exits 0 with empty stdout and writes no log", async () => {
    using home = myosHome("stopgates-off");
    const r = await runHook(HOOK, {
      home,
      stdin: events.stop({ transcript_path: deployTurn(home), last_assistant_message: CLAIM }),
      env: { MYOS_GATES: "off" },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    expect(await rows(home, "format-gate.jsonl")).toEqual([]);
  });

  test("Anti: empty stdin exits 0", async () => {
    using home = myosHome("stopgates-empty");
    const r = await runHook(HOOK, { home });
    expect(r.exitCode).toBe(0);
  });
});
