/**
 * ISAFoldGate: live state changed this turn, the active run's ISA did not.
 * Each of Harry's mutation shapes is tested, plus the read-only exemption,
 * the subagent counterfactual and the legacy skip.
 */
import { describe, expect, test } from "bun:test";

import { assistantToolUse, events, myosHome, runHook, toolResult, transcript, userText } from "./harness.ts";
import { bindIsa, CURRENT, LEGACY } from "./isa-fixtures.ts";
import { isProdMutation } from "../../payload/hooks/ISAFoldGate.hook.ts";

const HOOK = "payload/hooks/ISAFoldGate.hook.ts";
const LOG = ".myos/MYOS/MEMORY/OBSERVABILITY/isa-gates.jsonl";
type Home = ReturnType<typeof myosHome>;

const rows = async (home: Home) =>
  (await Bun.file(home.join(LOG)).exists())
    ? (await Bun.file(home.join(LOG)).text()).trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.gate === "ISAFoldGate")
    : [];

describe("mutation shapes (pure)", () => {
  const yes = [
    "~/bin/publish site/index.html masha-map --private -y",
    "cd site && /Users/harry/bin/publish page.html x",
    "git push origin main",
    "git -C ~/Code/site push",
    "launchctl kickstart -k gui/501/ch.example.job",
    "crontab /tmp/newtab",
    "curl -X POST https://docs.getgrist.com/api/docs/abc/tables/Flats/records -d @rows.json",
    "curl --request PATCH https://docs.getgrist.com/api/docs/abc/tables/T/records --data '{}'",
    "curl https://docs.getgrist.com/api/docs/abc/tables/T/records -d '{\"records\":[]}'",
    "bun script/meta-adsets.ts --apply",
    "bun script/meta-bank.ts --push --activate",
  ];
  const no = [
    "curl https://docs.getgrist.com/api/docs/abc/tables/T/records",
    "curl -X POST https://example.com/api -d x",
    "launchctl list",
    "crontab -l",
    "git status",
    "rg -n '~/bin/publish' docs",
    "bun script/meta-adsets.ts --dry-run",
  ];
  for (const c of yes) test(`mutation: ${c}`, () => expect(isProdMutation(c)).toBe(true));
  for (const c of no) test(`not a mutation: ${c}`, () => expect(isProdMutation(c)).toBe(false));
});

function turn(home: Home, command: string, extra: string[] = []): string {
  return home.write("tx.jsonl", transcript(
    userText("ship it"),
    assistantToolUse("Bash", { command }, "b1"),
    toolResult("b1", "ok"),
    ...extra,
  ));
}

describe("the gate", () => {
  test("a publish with the ISA untouched logs would-block by default", async () => {
    using home = myosHome("foldgate-log");
    await bindIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: turn(home, "~/bin/publish site/a.html a --private -y"), last_assistant_message: "Published." }) });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1)).toMatchObject({ verdict: "fail", would_block: true });
  });

  test("armed, the same turn blocks", async () => {
    using home = myosHome("foldgate-block");
    await bindIsa(home, CURRENT);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: turn(home, "git push origin main"), last_assistant_message: "Pushed." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("ISAFoldGate");
  });

  test("an ISA edit in the same turn passes", async () => {
    using home = myosHome("foldgate-folded");
    const isa = await bindIsa(home, CURRENT);
    const tx = turn(home, "git push origin main", [assistantToolUse("Edit", { file_path: isa }, "e1"), toolResult("e1", "ok")]);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: tx, last_assistant_message: "Pushed." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("pass-isa-edited");
  });

  test("a subagent passes, logging would_block_without_subagent", async () => {
    using home = myosHome("foldgate-subagent");
    await bindIsa(home, CURRENT);
    const tx = turn(home, "crontab /tmp/tab", [assistantToolUse("Agent", { description: "review" }, "a1"), toolResult("a1", "ok")]);
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: tx, last_assistant_message: "Installed." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1)).toMatchObject({ decision: "pass-delegated", would_block_without_subagent: true });
  });

  test("a legacy ISA is skipped", async () => {
    using home = myosHome("foldgate-legacy");
    await bindIsa(home, LEGACY.replace("phase: complete", "phase: execute"), "Code/old/ISA.md");
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: turn(home, "git push"), last_assistant_message: "Pushed." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1)).toMatchObject({ verdict: "skip" });
  });
});

describe("Anti", () => {
  test("Anti: a failed mutation changed nothing and is not counted", async () => {
    using home = myosHome("foldgate-failed");
    await bindIsa(home, CURRENT);
    const tx = home.write("tx.jsonl", transcript(userText("push"), assistantToolUse("Bash", { command: "git push" }, "b1"), toolResult("b1", "fatal: exit 128", true)));
    const r = await runHook(HOOK, { home, stdin: events.stop({ transcript_path: tx, last_assistant_message: "Push failed." }), env: { MYOS_GATES: "block" } });
    expect(r.exitCode).toBe(0);
    expect(await rows(home)).toEqual([]);
  });
});
