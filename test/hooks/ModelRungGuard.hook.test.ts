/**
 * ModelRungGuard reports a session running below the settings.json pin and
 * never switches. The live model comes from the transcript tail; subagent
 * rows are ignored.
 */
import { describe, expect, test } from "bun:test";

import { events, myosHome, runHook } from "./harness.ts";

const HOOK = "payload/hooks/ModelRungGuard.hook.ts";
const row = (model: string, sidechain = false) =>
  JSON.stringify({ type: "assistant", isSidechain: sidechain, message: { role: "assistant", model, content: [{ type: "text", text: "x" }] } });

function setup(name: string, pin: string | null, lines: string[]) {
  const home = myosHome(name, pin === null ? {} : { ".myos/settings.json": JSON.stringify({ model: pin }) });
  const tx = home.write("tx.jsonl", lines.join("\n") + "\n");
  return { home, tx };
}

describe("ModelRungGuard", () => {
  test("below the pin: one report line", async () => {
    const { home, tx } = setup("rung-below", "fable[1m]", [row("claude-sonnet-4-5")]);
    using _h = home;
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("hi", { transcript_path: tx }) });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    expect(r.stdout).toContain("2 rungs below the 'fable[1m]' pin");
  });

  test("on the pin: silent", async () => {
    const { home, tx } = setup("rung-on", "fable[1m]", [row("claude-fable-5")]);
    using _h = home;
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("hi", { transcript_path: tx }) });
    expect(r.stdout).toBe("");
  });

  test("a subagent's lower model is not the session's", async () => {
    const { home, tx } = setup("rung-sidechain", "opus", [row("claude-opus-4-7"), row("claude-haiku-4-5", true)]);
    using _h = home;
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("hi", { transcript_path: tx }) });
    expect(r.stdout).toBe("");
  });

  test("no pin or no transcript: silent, exit 0", async () => {
    const { home, tx } = setup("rung-nopin", null, [row("claude-haiku-4-5")]);
    using _h = home;
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("hi", { transcript_path: tx }) });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    const r2 = await runHook(HOOK, { home, stdin: events.userPrompt("hi") });
    expect(r2.stdout).toBe("");
  });
});
