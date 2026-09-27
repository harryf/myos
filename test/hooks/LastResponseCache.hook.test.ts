/**
 * LastResponseCache bridges Stop to the next UserPromptSubmit: it caches the
 * final assistant text so DriftReminder can measure what the previous response
 * broke. Contract: prefer the stdin field, fall back to the transcript, keep
 * the FULL text, never block a Stop.
 */

import { describe, expect, test } from "bun:test";

import { assistantText, events, myosHome, runHook, SESSION_ID, transcript, userText } from "./harness.ts";

const HOOK = "payload/hooks/LastResponseCache.hook.ts";
const CACHE = `.myos/MYOS/MEMORY/STATE/last-response/${SESSION_ID}.txt`;
const UNKEYED = ".myos/MYOS/MEMORY/STATE/last-response.txt";

describe("caching", () => {
  test("last_assistant_message from stdin is cached verbatim", async () => {
    using home = myosHome("lastresp-stdin");
    const result = await runHook(HOOK, {
      home,
      stdin: events.stop({ last_assistant_message: "Here is the answer you asked for." }),
    });

    expect(result.exitCode).toBe(0);
    expect(await Bun.file(home.join(CACHE)).text()).toBe("Here is the answer you asked for.");
  });

  test("without the stdin field, the transcript's last assistant text is used", async () => {
    using home = myosHome("lastresp-transcript");
    const tx = home.write(
      "transcript.jsonl",
      transcript(
        userText("do the thing"),
        assistantText("First draft."),
        assistantText("Final answer from the transcript."),
      ),
    );
    await runHook(HOOK, { home, stdin: events.stop({ transcript_path: tx }) });

    expect(await Bun.file(home.join(CACHE)).text()).toBe("Final answer from the transcript.");
  });

  test("the full text is cached: DriftReminder measures the closer at the end", async () => {
    using home = myosHome("lastresp-full");
    const long = "x".repeat(5000) + "\n🗣️ myos: done";
    await runHook(HOOK, {
      home,
      stdin: events.stop({ last_assistant_message: long }),
    });
    expect(await Bun.file(home.join(CACHE)).text()).toBe(long);
  });
});

describe("per session", () => {
  test("two sessions keep separate files; no session id falls back to the unkeyed name", async () => {
    using home = myosHome("lastresp-sessions");
    await runHook(HOOK, { home, stdin: events.stop({ last_assistant_message: "mine" }) });
    await runHook(HOOK, { home, stdin: events.stop({ session_id: "other", last_assistant_message: "theirs" }) });
    await runHook(HOOK, { home, stdin: events.stop({ session_id: undefined, last_assistant_message: "anon" }) });
    expect(await Bun.file(home.join(CACHE)).text()).toBe("mine");
    expect(await Bun.file(home.join(".myos/MYOS/MEMORY/STATE/last-response/other.txt")).text()).toBe("theirs");
    expect(await Bun.file(home.join(UNKEYED)).text()).toBe("anon");
  });
});

describe("Anti", () => {
  test("Anti: empty stdin exits 0 and writes nothing", async () => {
    using home = myosHome("lastresp-empty");
    const result = await runHook(HOOK, { home });
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(home.join(CACHE)).exists()).toBe(false);
  });

  test("Anti: a missing transcript is a no-op, not a crash", async () => {
    using home = myosHome("lastresp-notranscript");
    const result = await runHook(HOOK, {
      home,
      stdin: events.stop({ transcript_path: home.join("nope.jsonl") }),
    });
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(home.join(CACHE)).exists()).toBe(false);
  });
});
