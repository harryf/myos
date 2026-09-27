/**
 * SessionCleanup closes out a session at SessionEnd: the active ISA gets
 * phase: complete, every work.json row owned by the session UUID is marked
 * complete (so dashboards close the row instead of aging it out), and the
 * session-names entry is removed to prevent IDLE ghosts. All three closures
 * are pinned, plus the two absence paths.
 */

import { describe, expect, test } from "bun:test";

import { events, myosHome, runHook, SESSION_ID } from "./harness.ts";

const HOOK = "payload/hooks/SessionCleanup.hook.ts";
const WORK_JSON = ".myos/MYOS/MEMORY/STATE/work.json";
const NAMES = ".myos/MYOS/MEMORY/STATE/session-names.json";
const SLUG = "20260730-090000_wrap-me-up";

function activeHome(name: string) {
  const home = myosHome(name, {
    [WORK_JSON]: JSON.stringify({
      sessions: {
        [SLUG]: {
          slug: SLUG,
          sessionUUID: SESSION_ID,
          phase: "build",
          updatedAt: new Date().toISOString(),
        },
        "someone-elses-work": {
          slug: "someone-elses-work",
          sessionUUID: "other-uuid",
          phase: "build",
          updatedAt: new Date().toISOString(),
        },
      },
    }),
    [NAMES]: JSON.stringify({ [SESSION_ID]: "Build Hook Test Suite Now", other: "Keep Me" }),
    [`.myos/MYOS/MEMORY/WORK/${SLUG}/ISA.md`]: [
      "---",
      `slug: ${SLUG}`,
      "phase: build",
      "status: ACTIVE",
      "updated: 2026-07-30T09:00:00Z",
      "completed_at: null",
      "---",
      "",
      "## ISC Criteria",
      "",
      "- [x] ISC-1: everything finished",
      "",
    ].join("\n"),
  });
  return home;
}

describe("closing out", () => {
  test("the session's ISA, registry rows and name entry all close together", async () => {
    using home = activeHome("cleanup-full");
    const result = await runHook(HOOK, { home, stdin: events.sessionEnd() });

    expect(result.exitCode).toBe(0);

    const isa = await Bun.file(home.join(`.myos/MYOS/MEMORY/WORK/${SLUG}/ISA.md`)).text();
    expect(isa).toContain("phase: complete");
    expect(isa).toContain("status: COMPLETED");
    expect(isa).not.toContain("completed_at: null");

    const registry = JSON.parse(await Bun.file(home.join(WORK_JSON)).text());
    expect(registry.sessions[SLUG].phase).toBe("complete");
    // Another session's rows are untouched.
    expect(registry.sessions["someone-elses-work"].phase).toBe("build");

    const names = JSON.parse(await Bun.file(home.join(NAMES)).text());
    expect(names[SESSION_ID]).toBeUndefined();
    expect(names.other).toBe("Keep Me");
  });

  test("a session with no registered work exits quietly", async () => {
    using home = myosHome("cleanup-nowork");
    const result = await runHook(HOOK, { home, stdin: events.sessionEnd() });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("No active work session");
  });

  test("no session_id at all still exits 0: SessionEnd is never blocked", async () => {
    using home = myosHome("cleanup-noid");
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Session ended");
  });
});

describe("Anti", () => {
  test("Anti: an already-complete row is not re-touched", async () => {
    using home = myosHome("cleanup-alreadydone", {
      [WORK_JSON]: JSON.stringify({
        sessions: {
          done: {
            slug: "done",
            sessionUUID: SESSION_ID,
            phase: "complete",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        },
      }),
    });
    await runHook(HOOK, { home, stdin: events.sessionEnd() });

    const registry = JSON.parse(await Bun.file(home.join(WORK_JSON)).text());
    expect(registry.sessions.done.updatedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});
