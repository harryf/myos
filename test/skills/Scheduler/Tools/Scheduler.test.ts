/**
 * Scheduler.ts: launchd jobs that fire myos. Two layers:
 *
 *   1. pure functions (schedules, plists, registry, heartbeats, the argv a job runs)
 *   2. the CLI in a subprocess against a sandbox HOME, with a stub `launchctl`
 *      and a stub `myos` on a sparse PATH. The real launchctl is never reached:
 *      the stub records its arguments and the test reads them back.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bunExe, repoPath, run, tempDir, tempHome } from "../../../harness.ts";
import {
  appendHeartbeat,
  buildCalendarIntervals,
  buildPlist,
  commandFor,
  defaultPaths,
  jobLabel,
  loadRegistry,
  parseDays,
  parseTime,
  plistPath,
  readHeartbeats,
  saveRegistry,
  validateJob,
  type Job,
  type Paths,
} from "../../../../payload/skills/Scheduler/Tools/Scheduler.ts";

const TOOL = repoPath("payload/skills/Scheduler/Tools/Scheduler.ts");

const dir = tempDir("scheduler");
const paths: Paths = {
  home: join(dir.path, "home"),
  stateDir: join(dir.path, "state"),
  logDir: join(dir.path, "logs"),
  agentsDir: join(dir.path, "agents"),
  schedulerScript: "/fake/Scheduler.ts",
  bun: "/fake/bun",
  myos: "/fake/home/.myos/bin/myos",
};

const promptJob: Job = {
  name: "morning-review",
  kind: "prompt",
  description: "read yesterday's ISAs and list open items",
  schedule: { time: "07:30", days: "weekdays" },
  prompt: "List the open items in yesterday's ISAs.",
  created: "2026-09-27T00:00:00Z",
};

afterAll(() => dir[Symbol.dispose]());

describe("schedule parsing", () => {
  test("parses valid time and rejects garbage", () => {
    expect(parseTime("07:30")).toEqual({ hour: 7, minute: 30 });
    expect(() => parseTime("25:00")).toThrow(/out of range/);
    expect(() => parseTime("7pm")).toThrow(/HH:MM/);
  });

  test("parses day words and rejects unknown days", () => {
    expect(parseDays("weekdays")).toBe("weekdays");
    expect(parseDays("mon,fri")).toEqual(["mon", "fri"]);
    expect(() => parseDays("monday")).toThrow(/unknown day/);
  });

  test("weekdays expand to five launchd intervals, daily to one", () => {
    const weekday = buildCalendarIntervals({ time: "07:30", days: "weekdays" });
    expect(weekday).toHaveLength(5);
    expect(weekday[0]).toEqual({ Hour: 7, Minute: 30, Weekday: 1 });
    expect(buildCalendarIntervals({ time: "17:00", days: "daily" })).toEqual([{ Hour: 17, Minute: 0 }]);
    expect(buildCalendarIntervals({ time: "17:00", days: ["fri"] })).toEqual([{ Hour: 17, Minute: 0, Weekday: 5 }]);
  });
});

describe("validation", () => {
  test("accepts a prompt job with inline text or a prompt file", () => {
    expect(() => validateJob(promptJob)).not.toThrow();
    expect(() => validateJob({ ...promptJob, prompt: undefined, promptFile: "/x.md" })).not.toThrow();
  });

  test("rejects non-kebab names, missing payloads, missing description, bad kind", () => {
    expect(() => validateJob({ ...promptJob, name: "Morning Review" })).toThrow(/kebab/);
    expect(() => validateJob({ ...promptJob, prompt: undefined })).toThrow(/--prompt/);
    expect(() => validateJob({ ...promptJob, kind: "command" })).toThrow(/--command/);
    expect(() => validateJob({ ...promptJob, description: "" })).toThrow(/description/);
    expect(() => validateJob({ ...promptJob, kind: "shell" as never })).toThrow(/kind/);
    expect(() => validateJob({ ...promptJob, timeoutMinutes: 0 })).toThrow(/timeout/);
  });
});

describe("what a job runs", () => {
  test("a prompt job is a headless myos run with text output, read only", () => {
    const argv = commandFor(promptJob, paths);
    expect(argv.slice(0, 5)).toEqual([paths.myos, "-p", promptJob.prompt!, "--output-format", "text"]);
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(argv[argv.indexOf("--disallowedTools") + 1]).toContain("Write");
  });

  test("a command job is a plain shell command", () => {
    expect(commandFor({ ...promptJob, kind: "command", command: "echo hi" }, paths)).toEqual(["/bin/sh", "-c", "echo hi"]);
  });
});

describe("plist generation", () => {
  test("plist calls the runner, never the work itself", () => {
    const xml = buildPlist(promptJob, paths);
    expect(xml).toContain("<string>com.myos.morning-review</string>");
    expect(xml).toContain("<string>/fake/bun</string>");
    expect(xml).toContain("<string>/fake/Scheduler.ts</string>");
    expect(xml).toContain("<string>run</string>");
    expect(xml).not.toContain("open items"); // the prompt stays in the registry
    expect(xml).toContain("<key>Weekday</key><integer>5</integer>");
    expect(xml).toContain("<key>RunAtLoad</key><false/>");
    expect(xml).toContain(join(paths.logDir, "launchd", "morning-review.err.log"));
  });

  test("plist PATH includes the bun dir, and the label prefix is com.myos.", () => {
    expect(buildPlist(promptJob, paths)).toContain("/fake:");
    expect(plistPath("morning-review", paths)).toBe(join(paths.agentsDir, "com.myos.morning-review.plist"));
    expect(jobLabel("x")).toBe("com.myos.x");
  });

  test("default paths put logs under MEMORY/OBSERVABILITY/scheduler", () => {
    const p = defaultPaths({ HOME: "/h" }, "/h");
    expect(p.logDir).toBe("/h/.myos/MYOS/MEMORY/OBSERVABILITY/scheduler");
    expect(p.myos).toBe("/h/.myos/bin/myos");
    expect(p.agentsDir).toBe("/h/Library/LaunchAgents");
  });
});

describe("registry and heartbeats", () => {
  test("registry round-trips jobs and starts empty", () => {
    expect(loadRegistry(paths).jobs).toEqual([]);
    saveRegistry({ version: 1, jobs: [promptJob] }, paths);
    expect(loadRegistry(paths).jobs[0]!.name).toBe("morning-review");
  });

  test("heartbeats append as JSONL and filter by job", () => {
    appendHeartbeat({ ts: "2026-09-27T07:30:00Z", job: "morning-review", event: "start" }, paths);
    appendHeartbeat({ ts: "2026-09-27T07:31:00Z", job: "morning-review", event: "end", exit: 0, ms: 60000 }, paths);
    appendHeartbeat({ ts: "2026-09-27T17:30:00Z", job: "other", event: "start" }, paths);
    expect(readHeartbeats(paths)).toHaveLength(3);
    expect(readHeartbeats(paths, "morning-review")[1]!.exit).toBe(0);
  });
});

/** A sandbox HOME with stub launchctl and myos on a sparse PATH. */
function sandbox(name: string) {
  const home = tempHome(`scheduler-${name}`);
  const bin = home.mkdir("stubbin");
  const stub = (file: string, body: string) => {
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  };
  // launchctl: record every call; `print` says "not loaded".
  stub(join(bin, "launchctl"), `echo "$@" >> "$HOME/launchctl.calls"\n[ "$1" = "print" ] && exit 113\nexit 0`);
  mkdirSync(join(home.myos, "bin"), { recursive: true });
  stub(join(home.myos, "bin", "myos"), `for a in "$@"; do echo "ARG:$a"; done`);
  const env = home.env({ PATH: bin });
  const cli = (...args: string[]) => run([bunExe(), TOOL, ...args], { env });
  const calls = () => (existsSync(home.join("launchctl.calls")) ? readFileSync(home.join("launchctl.calls"), "utf8") : "");
  return Object.assign(home, { cli, calls });
}

describe("CLI in a sandbox HOME (launchctl stubbed)", () => {
  test("add --dry-run prints the plist and writes nothing", async () => {
    using s = sandbox("dry");
    const r = await s.cli("add", "morning-review", "--description", "d", "--time", "07:30", "--prompt", "hello", "--dry-run");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("<string>com.myos.morning-review</string>");
    expect(existsSync(s.join("Library/LaunchAgents/com.myos.morning-review.plist"))).toBe(false);
    expect(s.calls()).toBe("");
  });

  test("add writes the plist into the sandbox LaunchAgents and bootstraps it", async () => {
    using s = sandbox("add");
    const r = await s.cli("add", "morning-review", "--description", "d", "--time", "07:30", "--days", "mon,fri", "--prompt", "hello");
    expect(r.exitCode).toBe(0);
    const plist = s.join("Library/LaunchAgents/com.myos.morning-review.plist");
    expect(readFileSync(plist, "utf8")).toContain("<key>Weekday</key><integer>1</integer>");
    expect(s.calls()).toMatch(/^bootstrap gui\/\d+ .*com\.myos\.morning-review\.plist$/m);
    expect(s.calls()).not.toMatch(/^load\b/m);
    const registry = JSON.parse(readFileSync(s.join(".myos/MYOS/MEMORY/STATE/scheduler/jobs.json"), "utf8"));
    expect(registry.jobs[0].prompt).toBe("hello");

    const again = await s.cli("add", "morning-review", "--description", "d", "--time", "08:00", "--prompt", "x");
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("--force");

    const list = await s.cli("list");
    expect(list.stdout).toContain("morning-review  [prompt]  07:30 mon,fri  NOT LOADED  never run");
  });

  test("run executes a prompt job through myos -p and logs heartbeats and output", async () => {
    using s = sandbox("run");
    await s.cli("add", "morning-review", "--description", "d", "--time", "07:30", "--prompt", "hello there");
    const dry = await s.cli("run", "morning-review", "--dry-run");
    expect(JSON.parse(dry.stdout)[1]).toBe("-p");

    const r = await s.cli("run", "morning-review");
    expect(r.exitCode).toBe(0);
    const log = s.join(".myos/MYOS/MEMORY/OBSERVABILITY/scheduler");
    const beats = readFileSync(join(log, "runs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(beats.map((b) => b.event)).toEqual(["start", "end"]);
    const output = readFileSync(beats[1].output, "utf8");
    expect(output).toContain("ARG:-p\nARG:hello there\nARG:--output-format\nARG:text");
  });

  test("a command job runs its shell command", async () => {
    using s = sandbox("cmd");
    await s.cli("add", "echo-job", "--description", "d", "--time", "09:00", "--command", "echo from-command");
    expect((await s.cli("run", "echo-job")).exitCode).toBe(0);
    const beats = (await s.cli("runs", "echo-job")).stdout.trim().split("\n").map((l) => JSON.parse(l));
    expect(readFileSync(beats[1].output, "utf8")).toBe("from-command\n");
  });

  test("remove boots the job out, deletes the plist, keeps the logs; --dry-run changes nothing", async () => {
    using s = sandbox("remove");
    await s.cli("add", "morning-review", "--description", "d", "--time", "07:30", "--prompt", "p");
    const plist = s.join("Library/LaunchAgents/com.myos.morning-review.plist");
    await s.cli("remove", "morning-review", "--dry-run");
    expect(existsSync(plist)).toBe(true);
    const r = await s.cli("remove", "morning-review");
    expect(r.exitCode).toBe(0);
    expect(existsSync(plist)).toBe(false);
    expect(s.calls()).toMatch(/^bootout gui\/\d+\/com\.myos\.morning-review$/m);
    expect((await s.cli("remove", "morning-review")).exitCode).toBe(1);
  });

  test("bad input exits 1 with a message, not a stack trace", async () => {
    using s = sandbox("bad");
    const r = await s.cli("add", "x", "--description", "d", "--time", "7pm", "--prompt", "p");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("HH:MM");
    expect((await s.cli("run", "missing")).exitCode).toBe(1);
    expect((await s.cli("frobnicate")).exitCode).toBe(1);
  });
});

describe("Anti", () => {
  test("Anti: no notification code in the tool", () => {
    expect(readFileSync(TOOL, "utf8")).not.toContain("osascript");
  });
});
