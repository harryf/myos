/**
 * TimeContext prints one live clock line per prompt, in the configured
 * timezone (Europe/Zurich by default). MYOS_NOW pins the clock.
 */
import { describe, expect, test } from "bun:test";

import { events, myosHome, runHook } from "./harness.ts";

const HOOK = "payload/hooks/TimeContext.hook.ts";
const NOW = "2026-09-28T07:30:00Z"; // 09:30 in Zurich (CEST)

describe("TimeContext", () => {
  test("defaults to Europe/Zurich", async () => {
    using home = myosHome("time-default");
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("hi"), env: { MYOS_NOW: NOW } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("2026-09-28 09:30");
    expect(r.stdout).toContain("Europe/Zurich");
    expect(r.stdout).toContain("morning");
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });

  test("[principal] timezone in MYOS_CONFIG.toml wins", async () => {
    using home = myosHome("time-config", {
      ".myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml": '[principal]\nname = "Harry"\ntimezone = "America/New_York"\n',
    });
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("hi"), env: { MYOS_NOW: NOW } });
    expect(r.stdout).toContain("2026-09-28 03:30");
    expect(r.stdout).toContain("America/New_York");
  });

  test("Anti: an invalid timezone falls back to Zurich, never crashes", async () => {
    using home = myosHome("time-bad", { ".myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml": '[principal]\ntimezone = "Mars/Olympus"\n' });
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("hi"), env: { MYOS_NOW: NOW } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Europe/Zurich");
  });
});
