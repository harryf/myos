/**
 * TokenLog.hook.ts runs at SessionEnd to fold the ending session's transcript
 * into the durable token store. Contract under test: it always exits 0 fast
 * (a bookkeeping hook must never break session teardown), and a transcript in
 * the sandbox HOME lands in the store.
 */

import { describe, expect, test } from "bun:test";

import { myosHome, runHook } from "./harness.ts";

const HOOK = "payload/hooks/TokenLog.hook.ts";
const STORE = ".myos/MYOS/MEMORY/OBSERVABILITY/TOKENS/sessions.json";

const transcript = [
  JSON.stringify({
    type: "user",
    timestamp: new Date().toISOString(),
    sessionId: "tok-hook-session",
    uuid: "u-1",
    message: { role: "user", content: "do the thing" },
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: new Date().toISOString(),
    sessionId: "tok-hook-session",
    uuid: "a-1",
    message: {
      id: "m-1",
      model: "claude-fable-5",
      role: "assistant",
      usage: { input_tokens: 2, cache_creation_input_tokens: 5, cache_read_input_tokens: 7, output_tokens: 42 },
    },
  }),
].join("\n");

describe("TokenLog hook", () => {
  test("no projects dir at all → exit 0, empty store written", async () => {
    using home = myosHome("tokenlog-empty");
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    const store = JSON.parse(await Bun.file(home.join(STORE)).text());
    expect(store.sessions).toEqual({});
  });

  test("a session transcript in HOME lands in the store", async () => {
    using home = myosHome("tokenlog-real");
    home.write(".myos/projects/-Users-t-proj/tok.jsonl", transcript);

    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.exitCode).toBe(0);
    const store = JSON.parse(await Bun.file(home.join(STORE)).text());
    const s = store.sessions["tok-hook-session"];
    expect(s.turns[0].prompt).toBe("do the thing");
    expect(s.turns[0].models["claude-fable-5"].out).toBe(42);
  });
});
