#!/usr/bin/env bun
/**
 * Scheduler.ts: launchd jobs that fire myos itself.
 *
 * Harry's rule: crontab stays for plain scripts with no model involved (easier
 * to read and edit). This tool is for jobs that run myos, where launchd's
 * "missed while asleep runs on wake" matters and the run wants a heartbeat.
 *
 * Two job kinds:
 *   command  a shell command (same trust level as a crontab line)
 *   prompt   a headless myos run: `~/.myos/bin/myos -p "<prompt>" --output-format text`,
 *            read only by construction (plan permission mode, write tools
 *            disallowed; in -p mode nothing can be approved interactively)
 *
 * The plist never carries the work: it calls `Scheduler.ts run <name>`, and
 * the runner reads the job from the registry, runs it, and appends start and
 * end heartbeats. Plists are written to ~/Library/LaunchAgents only by `add`,
 * on the user's explicit command, and loaded with `launchctl bootstrap`.
 * No notifications of any kind: the heartbeat log is the record.
 *
 * Layout (config root = $CLAUDE_CONFIG_DIR or ~/.myos, tree = $MYOS_DIR or <root>/MYOS):
 *   <tree>/MEMORY/STATE/scheduler/jobs.json                 the registry
 *   <tree>/MEMORY/OBSERVABILITY/scheduler/runs.jsonl        heartbeats
 *   <tree>/MEMORY/OBSERVABILITY/scheduler/<job>/<stamp>.log each run's output
 *   <tree>/MEMORY/OBSERVABILITY/scheduler/launchd/<job>.{out,err}.log
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type JobKind = "command" | "prompt";

export interface Schedule {
  /** 24h "HH:MM" */
  time: string;
  /** "daily", "weekdays", or explicit day names ["mon", "fri"] */
  days: "daily" | "weekdays" | string[];
}

export interface Job {
  /** kebab-case; becomes the launchd label com.myos.<name> */
  name: string;
  kind: JobKind;
  description: string;
  schedule: Schedule;
  /** command jobs: the shell command */
  command?: string;
  /** prompt jobs: the prompt text */
  prompt?: string;
  /** prompt jobs: or a prompt file, read at run time */
  promptFile?: string;
  /** prompt jobs: optional model override */
  model?: string;
  /** wall-clock limit in minutes (default 30) */
  timeoutMinutes?: number;
  /** ISO timestamp, set by add */
  created: string;
}

export interface Registry {
  version: 1;
  jobs: Job[];
}

export interface Paths {
  home: string;
  /** registry dir */
  stateDir: string;
  /** heartbeats, run outputs, launchd logs */
  logDir: string;
  /** launchd plist directory */
  agentsDir: string;
  /** absolute path of this script, baked into plists */
  schedulerScript: string;
  /** bun binary, baked into plists */
  bun: string;
  /** the myos launcher a prompt job runs */
  myos: string;
}

export const LABEL_PREFIX = "com.myos.";

export function defaultPaths(env: Record<string, string | undefined> = process.env, home: string = env.HOME || homedir()): Paths {
  const root = env.CLAUDE_CONFIG_DIR || join(home, ".myos");
  const tree = env.MYOS_DIR || join(root, "MYOS");
  return {
    home,
    stateDir: join(tree, "MEMORY", "STATE", "scheduler"),
    logDir: join(tree, "MEMORY", "OBSERVABILITY", "scheduler"),
    agentsDir: join(home, "Library", "LaunchAgents"),
    schedulerScript: join(root, "skills", "Scheduler", "Tools", "Scheduler.ts"),
    bun: process.execPath,
    myos: join(root, "bin", "myos"),
  };
}

export function jobLabel(name: string): string {
  return LABEL_PREFIX + name;
}

export function plistPath(name: string, paths: Paths): string {
  return join(paths.agentsDir, jobLabel(name) + ".plist");
}

const DAY_NUMBERS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function parseTime(time: string): { hour: number; minute: number } {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`time must be 24h HH:MM, got "${time}"`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`time out of range: "${time}"`);
  return { hour, minute };
}

export function parseDays(days: string): Schedule["days"] {
  if (days === "daily" || days === "weekdays") return days;
  const names = days.split(",").map((d) => d.trim().toLowerCase());
  for (const n of names) {
    if (!(n in DAY_NUMBERS)) throw new Error(`unknown day "${n}" (use daily, weekdays, or mon..sun comma-separated)`);
  }
  return names;
}

/** launchd StartCalendarInterval entries for a schedule. */
export function buildCalendarIntervals(schedule: Schedule): Array<Record<string, number>> {
  const { hour, minute } = parseTime(schedule.time);
  if (schedule.days === "daily") return [{ Hour: hour, Minute: minute }];
  const dayNums = schedule.days === "weekdays" ? [1, 2, 3, 4, 5] : schedule.days.map((d) => DAY_NUMBERS[d]!);
  return dayNums.map((Weekday) => ({ Hour: hour, Minute: minute, Weekday }));
}

export function validateJob(job: Job): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(job.name ?? "")) throw new Error(`job name must be kebab-case, got "${job.name}"`);
  if (job.kind !== "command" && job.kind !== "prompt") throw new Error(`kind must be command or prompt, got "${job.kind}"`);
  if (job.kind === "command" && !job.command) throw new Error("command jobs need --command");
  if (job.kind === "prompt" && !job.prompt && !job.promptFile) throw new Error("prompt jobs need --prompt or --prompt-file");
  if (!job.description) throw new Error("jobs need --description (shown in list)");
  if (job.timeoutMinutes !== undefined && !(job.timeoutMinutes > 0)) throw new Error("--timeout must be a positive number of minutes");
  buildCalendarIntervals(job.schedule); // throws on bad time or days
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildPlist(job: Job, paths: Paths): string {
  const intervals = buildCalendarIntervals(job.schedule)
    .map(
      (i) =>
        "    <dict>\n" +
        Object.entries(i)
          .map(([k, v]) => `      <key>${k}</key><integer>${v}</integer>`)
          .join("\n") +
        "\n    </dict>",
    )
    .join("\n");
  const launchdLogs = join(paths.logDir, "launchd");
  // launchd's default PATH finds neither bun nor claude: carry an explicit one.
  const path = [dirname(paths.bun), join(paths.home, ".local", "bin"), join(paths.home, "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(jobLabel(job.name))}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(paths.bun)}</string>
    <string>${xmlEscape(paths.schedulerScript)}</string>
    <string>run</string>
    <string>${xmlEscape(job.name)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${intervals}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEscape(path)}</string>
    <key>HOME</key><string>${xmlEscape(paths.home)}</string>
  </dict>
  <key>StandardOutPath</key><string>${xmlEscape(join(launchdLogs, job.name + ".out.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(join(launchdLogs, job.name + ".err.log"))}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
}

export function loadRegistry(paths: Paths): Registry {
  const file = join(paths.stateDir, "jobs.json");
  if (!existsSync(file)) return { version: 1, jobs: [] };
  return JSON.parse(readFileSync(file, "utf8")) as Registry;
}

export function saveRegistry(registry: Registry, paths: Paths): void {
  mkdirSync(paths.stateDir, { recursive: true });
  writeFileSync(join(paths.stateDir, "jobs.json"), JSON.stringify(registry, null, 2) + "\n");
}

export interface Heartbeat {
  ts: string;
  job: string;
  event: "start" | "end";
  exit?: number;
  output?: string;
  ms?: number;
}

export function appendHeartbeat(beat: Heartbeat, paths: Paths): void {
  mkdirSync(paths.logDir, { recursive: true });
  appendFileSync(join(paths.logDir, "runs.jsonl"), JSON.stringify(beat) + "\n");
}

export function readHeartbeats(paths: Paths, jobName?: string): Heartbeat[] {
  const file = join(paths.logDir, "runs.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Heartbeat)
    .filter((b) => !jobName || b.job === jobName);
}

export function promptText(job: Job): string {
  return job.promptFile ? readFileSync(job.promptFile, "utf8") : (job.prompt ?? "");
}

/**
 * The argv a job runs. A prompt job is headless and read only: plan mode plus
 * the write tools disallowed, so no allow rule in settings can turn a
 * scheduled run into a writer.
 */
export function commandFor(job: Job, paths: Paths): string[] {
  if (job.kind === "command") return ["/bin/sh", "-c", job.command!];
  const args = [paths.myos, "-p", promptText(job), "--output-format", "text", "--permission-mode", "plan", "--disallowedTools", "Edit,Write,NotebookEdit"];
  if (job.model) args.push("--model", job.model);
  return args;
}

// ---------------------------------------------------------------------------
// launchctl, resolved on PATH (tests put a stub there and never reach the real one)
// ---------------------------------------------------------------------------

function launchctl(args: string[]): number {
  try {
    return Bun.spawnSync(["launchctl", ...args], { stdout: "ignore", stderr: "ignore" }).exitCode ?? 1;
  } catch {
    return 127; // no launchctl on PATH
  }
}

function domain(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

function isLoaded(name: string): boolean {
  return launchctl(["print", `${domain()}/${jobLabel(name)}`]) === 0;
}

function bootstrap(name: string, paths: Paths): void {
  launchctl(["bootout", `${domain()}/${jobLabel(name)}`]); // idempotent pre-clean
  const code = launchctl(["bootstrap", domain(), plistPath(name, paths)]);
  if (code !== 0) throw new Error(`launchctl bootstrap failed for ${jobLabel(name)} (exit ${code}); the plist is written, retry with add --force`);
}

function stampNow(): string {
  return new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
}

function runJob(job: Job, paths: Paths, dryRun: boolean): number {
  const argv = commandFor(job, paths);
  if (dryRun) {
    console.log(JSON.stringify(argv));
    return 0;
  }
  const outDir = join(paths.logDir, job.name);
  mkdirSync(outDir, { recursive: true });
  const outputFile = join(outDir, `${stampNow()}.log`);
  const started = Date.now();
  appendHeartbeat({ ts: new Date().toISOString(), job: job.name, event: "start" }, paths);
  let exit: number;
  try {
    const proc = Bun.spawnSync(argv, {
      cwd: outDir,
      timeout: (job.timeoutMinutes ?? 30) * 60_000,
      stdout: Bun.file(outputFile),
      stderr: "inherit",
    });
    exit = proc.exitCode ?? 1;
  } catch (err) {
    writeFileSync(outputFile, `could not start ${argv[0]}: ${(err as Error).message}\n`);
    exit = 127;
  }
  appendHeartbeat(
    { ts: new Date().toISOString(), job: job.name, event: "end", exit, output: outputFile, ms: Date.now() - started },
    paths,
  );
  return exit;
}

function fmtSchedule(s: Schedule): string {
  return `${s.time} ${Array.isArray(s.days) ? s.days.join(",") : s.days}`;
}

const USAGE = `usage: Scheduler.ts <command>
  add <name> --description "..." --time HH:MM [--days weekdays|daily|mon,fri]
             (--command '...' | --prompt "..." | --prompt-file <path>) [--model m] [--timeout <min>] [--force] [--dry-run]
  list
  remove <name> [--dry-run]
  run <name> [--dry-run]
  runs [name]            last 20 heartbeats
--dry-run prints what would be written or run and changes nothing.`;

export function cli(argv: string[], paths: Paths = defaultPaths()): number {
  const [cmd, ...rest] = argv;
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const has = (name: string) => rest.includes(`--${name}`);
  const dryRun = has("dry-run");

  try {
    switch (cmd) {
      case "add": {
        const name = rest[0] ?? "";
        const timeout = flag("timeout");
        const job: Job = {
          name,
          kind: (flag("kind") as JobKind) ?? (flag("command") ? "command" : "prompt"),
          description: flag("description") ?? "",
          schedule: { time: flag("time") ?? "", days: parseDays(flag("days") ?? "daily") },
          command: flag("command"),
          prompt: flag("prompt"),
          promptFile: flag("prompt-file"),
          model: flag("model"),
          timeoutMinutes: timeout ? Number(timeout) : undefined,
          created: new Date().toISOString(),
        };
        validateJob(job);
        const registry = loadRegistry(paths);
        if (registry.jobs.some((j) => j.name === name) && !has("force")) {
          console.error(`job "${name}" exists (use --force to replace)`);
          return 1;
        }
        if (dryRun) {
          console.log(`would write ${plistPath(name, paths)} and run launchctl bootstrap ${domain()} on it:\n`);
          console.log(buildPlist(job, paths));
          return 0;
        }
        registry.jobs = registry.jobs.filter((j) => j.name !== name).concat(job);
        saveRegistry(registry, paths);
        mkdirSync(join(paths.logDir, "launchd"), { recursive: true });
        mkdirSync(paths.agentsDir, { recursive: true });
        writeFileSync(plistPath(name, paths), buildPlist(job, paths));
        bootstrap(name, paths);
        console.log(`added ${jobLabel(name)} (${fmtSchedule(job.schedule)}), plist ${plistPath(name, paths)}`);
        return 0;
      }
      case "list": {
        const registry = loadRegistry(paths);
        if (registry.jobs.length === 0) {
          console.log("no scheduled jobs");
          return 0;
        }
        for (const j of registry.jobs) {
          const ends = readHeartbeats(paths, j.name).filter((b) => b.event === "end");
          const last = ends[ends.length - 1];
          const state = isLoaded(j.name) ? "loaded" : "NOT LOADED";
          const lastRun = last ? `last run ${last.ts} exit ${last.exit}` : "never run";
          console.log(`${j.name}  [${j.kind}]  ${fmtSchedule(j.schedule)}  ${state}  ${lastRun}\n  ${j.description}`);
        }
        return 0;
      }
      case "remove": {
        const name = rest[0] ?? "";
        const registry = loadRegistry(paths);
        const known = registry.jobs.some((j) => j.name === name);
        const plist = plistPath(name, paths);
        if (!known && !existsSync(plist)) {
          console.error(`no job "${name}"`);
          return 1;
        }
        if (dryRun) {
          console.log(`would run launchctl bootout ${domain()}/${jobLabel(name)}, delete ${plist} and drop "${name}" from the registry`);
          return 0;
        }
        launchctl(["bootout", `${domain()}/${jobLabel(name)}`]);
        if (existsSync(plist)) rmSync(plist);
        registry.jobs = registry.jobs.filter((j) => j.name !== name);
        saveRegistry(registry, paths);
        console.log(`removed ${jobLabel(name)} (run logs kept in ${join(paths.logDir, name)})`);
        return 0;
      }
      case "run": {
        const job = loadRegistry(paths).jobs.find((j) => j.name === rest[0]);
        if (!job) {
          console.error(`no job "${rest[0]}" in registry`);
          return 1;
        }
        return runJob(job, paths, dryRun);
      }
      case "runs": {
        for (const b of readHeartbeats(paths, rest[0]).slice(-20)) console.log(JSON.stringify(b));
        return 0;
      }
      case undefined:
      case "help":
      case "--help":
        console.log(USAGE);
        return 0;
      default:
        console.error(`unknown command "${cmd}"\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}

if (import.meta.main) process.exit(cli(process.argv.slice(2)));
