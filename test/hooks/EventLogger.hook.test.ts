/**
 * EventLogger is the unified observability appender: the log it writes is
 * how usage audits (the thing that built this toolkit) stay possible. One
 * process, four dispatch paths keyed on hook_event_name; every path is
 * fail-open. The tests pin each path's file and the ground-truth capture that
 * makes tool-activity.jsonl an audit rather than a tally.
 */

import { describe, expect, test } from "bun:test";

import { events, myosHome, runHook, SESSION_ID } from "./harness.ts";

const HOOK = "payload/hooks/EventLogger.hook.ts";
const OBS = ".myos/MYOS/MEMORY/OBSERVABILITY";

async function rows(home: { join(...p: string[]): string }, rel: string): Promise<any[]> {
  const file = Bun.file(home.join(rel));
  if (!(await file.exists())) return [];
  return (await file.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("PostToolUse → tool-activity", () => {
  test("every tool call lands one audit row", async () => {
    using home = myosHome("eventlog-activity");
    const result = await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: events.postToolUse("Read", { file_path: "/tmp/notes.md" }),
    });
    expect(result.exitCode).toBe(0);

    const [row] = await rows(home, `${OBS}/tool-activity.jsonl`);
    expect(row.event).toBe("tool_use");
    expect(row.tool_name).toBe("Read");
    expect(row.session_id).toBe(SESSION_ID);
    expect(row.tool_input_preview).toContain("notes.md");
  });

  test("a Bash call captures command + stdout preview as ground truth", async () => {
    using home = myosHome("eventlog-bash");
    await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: events.postToolUse(
        "Bash",
        { command: "bun test" },
        { stdout: "42 pass\n0 fail\n", stderr: "", exit_code: 0 },
      ),
    });

    const [row] = await rows(home, `${OBS}/tool-activity.jsonl`);
    expect(row.ground_truth.command).toBe("bun test");
    expect(row.ground_truth.stdout_preview).toContain("42 pass");
    expect(row.ground_truth.exit_code).toBe(0);
  });

  test("an Edit captures the bounded before/after diff", async () => {
    using home = myosHome("eventlog-edit");
    await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: events.postToolUse("Edit", {
        file_path: home.join("some/file.ts"),
        old_string: "const a = 1;",
        new_string: "const a = 2;",
      }),
    });

    const [row] = await rows(home, `${OBS}/tool-activity.jsonl`);
    expect(row.ground_truth.diff).toEqual({ removed: "const a = 1;", added: "const a = 2;" });
  });

  test("a Skill call ADDITIONALLY lands in the skill execution log", async () => {
    using home = myosHome("eventlog-skill");
    await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: events.postToolUse("Skill", { skill: "Writing", args: "audit README.md" }),
    });

    expect(await rows(home, `${OBS}/tool-activity.jsonl`)).toHaveLength(1);
    const [exec] = await rows(home, ".myos/MYOS/MEMORY/SKILLS/execution.jsonl");
    expect(exec.skill).toBe("Writing");
    expect(exec.args).toBe("audit README.md");
    expect(exec.source).toBe("hook");
  });
});

describe("the other three dispatch paths", () => {
  test("PostToolUseFailure → tool-failures with the error preserved", async () => {
    using home = myosHome("eventlog-failure");
    await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: {
        session_id: SESSION_ID,
        hook_event_name: "PostToolUseFailure",
        tool_name: "WebFetch",
        tool_input: { url: "https://example.com" },
        error: "connection refused",
      },
    });

    const [row] = await rows(home, `${OBS}/tool-failures.jsonl`);
    expect(row.event).toBe("tool_failure");
    expect(row.error).toBe("connection refused");
  });

  test("StopFailure → a dated security log", async () => {
    using home = myosHome("eventlog-stopfail");
    await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: { session_id: SESSION_ID, hook_event_name: "StopFailure", error: "API 529" },
    });

    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dir = home.join(`.myos/MYOS/MEMORY/SECURITY/${year}/${month}`);
    const files = (await Array.fromAsync(new Bun.Glob("stop-failures-*.jsonl").scan(dir))).sort();
    expect(files.length).toBe(1);

    const [row] = (await Bun.file(`${dir}/${files[0]}`).text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(row.error_details).toBe("API 529");
  });

  test("ConfigChange → config audit, with the snapshot diff naming what changed", async () => {
    using home = myosHome("eventlog-config", {
      ".myos/settings.json": JSON.stringify({ model: "opus", permissions: { allow: [] } }),
      ".myos/MYOS/MEMORY/STATE/myos-settings-snapshot.json": JSON.stringify({
        model: "sonnet",
        permissions: { allow: [] },
      }),
    });
    await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: { session_id: SESSION_ID, hook_event_name: "ConfigChange", transcript_path: "" },
    });

    const [row] = await rows(home, `${OBS}/config-changes.jsonl`);
    expect(row.event).toBe("config_change");
    expect(row.config_key).toBe("model");
    expect(row.change_summary).toContain("model");

    // The snapshot advanced, so the next diff has a fresh baseline.
    const snap = JSON.parse(
      await Bun.file(home.join(".myos/MYOS/MEMORY/STATE/myos-settings-snapshot.json")).text(),
    );
    expect(snap.model).toBe("opus");
  });
});

describe("Anti", () => {
  test("Anti: an unknown event name is a no-op: nothing written, exit 0", async () => {
    using home = myosHome("eventlog-unknown");
    const result = await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: { session_id: SESSION_ID, hook_event_name: "SomethingNew" },
    });
    expect(result.exitCode).toBe(0);
    expect(await rows(home, `${OBS}/tool-activity.jsonl`)).toEqual([]);
  });

  test("Anti: empty stdin exits 0 without writing", async () => {
    using home = myosHome("eventlog-empty");
    const result = await runHook(HOOK, { home, cwd: home.path });
    expect(result.exitCode).toBe(0);
    expect(await rows(home, `${OBS}/tool-activity.jsonl`)).toEqual([]);
  });
});

describe("rotation (lib/log-rotation.ts)", () => {
  test("at the cap the live file becomes .1, the old .1 becomes .2, the old .2 is dropped", async () => {
    using home = myosHome("eventlog-rotate");
    const live = `${OBS}/tool-activity.jsonl`;
    home.write(live, "x".repeat(200) + "\n");
    home.write(`${OBS}/tool-activity.1.jsonl`, "gen1\n");
    home.write(`${OBS}/tool-activity.2.jsonl`, "gen2\n");
    const result = await runHook(HOOK, {
      home,
      cwd: home.path,
      stdin: events.postToolUse("Read", { file_path: "/tmp/a.md" }),
      env: { MYOS_LOG_ROTATE_BYTES: "100" },
    });
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(home.join(`${OBS}/tool-activity.1.jsonl`)).text()).toBe("x".repeat(200) + "\n");
    expect(await Bun.file(home.join(`${OBS}/tool-activity.2.jsonl`)).text()).toBe("gen1\n");
    expect(await Bun.file(home.join(`${OBS}/tool-activity.3.jsonl`)).exists()).toBe(false);
    expect((await rows(home, live)).length).toBe(1);
  });

  test("under the cap nothing rotates", async () => {
    using home = myosHome("eventlog-norotate");
    const live = `${OBS}/tool-activity.jsonl`;
    home.write(live, JSON.stringify({ event: "old" }) + "\n");
    await runHook(HOOK, { home, cwd: home.path, stdin: events.postToolUse("Read", { file_path: "/tmp/a.md" }) });
    expect((await rows(home, live)).length).toBe(2);
    expect(await Bun.file(home.join(`${OBS}/tool-activity.1.jsonl`)).exists()).toBe(false);
  });
});
