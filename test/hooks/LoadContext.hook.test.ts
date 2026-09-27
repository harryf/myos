/**
 * LoadContext injects the dynamic session-start context: the ACTIVE WORK
 * summary of recent WORK/ sessions and tracked projects. The filters are the
 * behavior: completed and stale-out-of-window work must NOT greet every new
 * session, and subagents get nothing.
 */

import { describe, expect, test } from "bun:test";

import { myosHome, runHook } from "./harness.ts";

const HOOK = "payload/hooks/LoadContext.hook.ts";

function stamp(msAgo: number): string {
  const d = new Date(Date.now() - msAgo);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function isaFor(title: string, status: string): string {
  return [
    "---",
    `id: work-${title.toLowerCase().replace(/\s+/g, "-")}`,
    `title: ${title}`,
    `status: ${status}`,
    "verification_summary: 3/7",
    "---",
    "\n## ISC Criteria\n\n- [ ] ISC-1: pending\n",
  ].join("\n");
}

describe("active work summary", () => {
  test("a recent unfinished session shows up with its title, status and ISA progress", async () => {
    using home = myosHome("loadctx-recent");
    home.write(
      `.myos/MYOS/MEMORY/WORK/${stamp(2 * 60 * 60 * 1000)}_hook-suite-work/ISA.md`,
      isaFor("Build the hook test suite", "ACTIVE"),
    );

    const result = await runHook(HOOK, { home, stdin: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("myos session ready");
    expect(result.stdout).toContain("ACTIVE WORK");
    expect(result.stdout).toContain("Build the hook test suite");
    expect(result.stdout).toContain("Status: ACTIVE");
    expect(result.stdout).toContain("3/7");
  });

  test("completed work does not greet the next session", async () => {
    using home = myosHome("loadctx-completed");
    home.write(
      `.myos/MYOS/MEMORY/WORK/${stamp(60 * 60 * 1000)}_done-work/ISA.md`,
      isaFor("Some fully finished work", "COMPLETED"),
    );
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.stdout).not.toContain("ACTIVE WORK");
  });

  test("work older than the 48h window ages out", async () => {
    using home = myosHome("loadctx-old");
    home.write(
      `.myos/MYOS/MEMORY/WORK/${stamp(72 * 60 * 60 * 1000)}_ancient-work/ISA.md`,
      isaFor("Ancient work from last week", "ACTIVE"),
    );
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.stdout).not.toContain("Ancient work");
  });

  test("a clean install prints the ready line and nothing else on stdout", async () => {
    using home = myosHome("loadctx-clean");
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.stdout.trim()).toBe("✅ myos session ready...");
  });
});

describe("tracked projects", () => {
  function progress(updatedMsAgo: number): string {
    return JSON.stringify({
      project: "esim-launch",
      status: "active",
      updated: new Date(Date.now() - updatedMsAgo).toISOString(),
      objectives: ["Ship the EU launch"],
      next_steps: ["Confirm the carrier contract"],
      handoff_notes: "Waiting on legal",
    });
  }

  test("an active project renders objectives, next steps and handoff notes", async () => {
    using home = myosHome("loadctx-project", {
      ".myos/MYOS/MEMORY/STATE/progress/esim-launch-progress.json": progress(60 * 60 * 1000),
    });
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.stdout).toContain("esim-launch");
    expect(result.stdout).toContain("Ship the EU launch");
    expect(result.stdout).toContain("Waiting on legal");
    expect(result.stdout).not.toContain("STALE");
  });

  test("a project untouched for two weeks is flagged stale, not hidden", async () => {
    using home = myosHome("loadctx-stale", {
      ".myos/MYOS/MEMORY/STATE/progress/esim-launch-progress.json": progress(15 * 24 * 60 * 60 * 1000),
    });
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.stdout).toContain("STALE");
  });
});

describe("Anti", () => {
  test("Anti: a subagent session gets no context injection", async () => {
    using home = myosHome("loadctx-subagent");
    home.write(
      `.myos/MYOS/MEMORY/WORK/${stamp(60 * 60 * 1000)}_secret-work/ISA.md`,
      isaFor("Work a subagent must not see", "ACTIVE"),
    );
    const result = await runHook(HOOK, {
      home,
      stdin: {},
      env: { CLAUDE_AGENT_TYPE: "Explore" },
    });
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Subagent session");
  });
});
