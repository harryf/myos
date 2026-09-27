/**
 * DriftReminder states the format contract every turn and reports what the
 * previous answer broke, measured from last-response.txt. Under 12 lines.
 */
import { describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";

import { events, myosHome, runHook, SESSION_ID } from "./harness.ts";

const HOOK = "payload/hooks/DriftReminder.hook.ts";
const CACHE = `.myos/MYOS/MEMORY/STATE/last-response/${SESSION_ID}.txt`;
const DASH = "\u2014";

describe("DriftReminder", () => {
  test("with no cache: the contract only, under 12 lines", async () => {
    using home = myosHome("drift-none");
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("hi") });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines.length).toBeLessThan(12);
    expect(r.stdout).toContain("════ myos ═══");
    expect(r.stdout).toContain("🗣️ myos:");
    expect(r.stdout).toContain("em dashes: zero");
    expect(r.stdout).toContain("CHANGE");
    expect(r.stdout).not.toContain("Last response");
  });

  test("the previous answer's breaks are named", async () => {
    using home = myosHome("drift-broke", { [CACHE]: `Plain answer ${DASH} a robust one.\n` });
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("next") });
    expect(r.stdout).toContain("Last response broke:");
    expect(r.stdout).toContain("no banner");
    expect(r.stdout).toContain("1 em dash");
    expect(r.stdout).toContain("'robust'");
    expect(r.stdout.trim().split("\n").length).toBeLessThan(12);
  });

  test("a clean previous answer is reported clean", async () => {
    using home = myosHome("drift-clean", { [CACHE]: "════ myos ═══\nAnswer.\n🗣️ myos: done" });
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("next") });
    expect(r.stdout).toContain("Last response was clean");
  });

  test("Anti: another session's answer is never measured", async () => {
    using home = myosHome("drift-other", { ".myos/MYOS/MEMORY/STATE/last-response/other.txt": "broken" });
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("next") });
    expect(r.stdout).not.toContain("Last response");
  });

  test("Anti: a cache older than 30 minutes belongs to another session and is ignored", async () => {
    using home = myosHome("drift-stale", { [CACHE]: "broken" });
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(home.join(CACHE), old, old);
    const r = await runHook(HOOK, { home, stdin: events.userPrompt("next") });
    expect(r.stdout).not.toContain("Last response");
  });
});
