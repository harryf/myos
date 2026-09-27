#!/usr/bin/env bun
/**
 * ReleaseCheck: pre-release validation of the INSTALLED myos system.
 *
 * `bun test` proves every tool works in isolation. This runner asks the other
 * question: is myos as a whole working: hooks firing, skills loading, agents
 * dispatching, the Algorithm reachable, model routing landing on the right
 * tier, the memory loop alive? It answers by driving the real installed tree
 * (`~/.myos`): deterministic health checks first, then a handful of live
 * probes through `myos -p` graded on the stream-json transcript, because a
 * model's claim that it invoked a skill is not evidence and the transcript is.
 *
 *   bun Tools/ReleaseCheck.ts                # health + live (needs a logged-in install)
 *   bun Tools/ReleaseCheck.ts --health       # deterministic only: zero tokens
 *   bun Tools/ReleaseCheck.ts --live         # live probes only
 *   bun Tools/ReleaseCheck.ts --probe boot,skill-routing
 *   bun Tools/ReleaseCheck.ts --list
 *   bun Tools/ReleaseCheck.ts --json
 *   bun Tools/ReleaseCheck.ts --home <dir>   # inspect a different HOME (fixtures, tests)
 *
 * Live probes are non-deterministic, so each one runs as trials (Evals-style
 * pass@k): up to `trials` attempts, stopping at `need` passes. A probe that
 * needs 1 pass from 2 trials tolerates one flaky answer without letting a
 * broken system through twice.
 *
 * Cost: probes run on haiku unless the probe itself is about model choice.
 * A green run is 6–8 short model calls, a few minutes, negligible tokens.
 * CI cannot run the live half (no login on runners): this is the manual
 * step before tagging, alongside ContrabandCheck.
 *
 * Exit: 1 if any check FAILs, 0 otherwise. WARN never fails the run.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type Verdict = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  title: string;
  verdict: Verdict;
  evidence: string[];
  durationMs: number;
}

/** One parsed stream-json event. Only the fields graders read. */
export interface StreamEvent {
  type: string;
  subtype?: string;
  hook_name?: string;
  output?: string;
  exit_code?: number;
  model?: string;
  message?: { content?: Array<{ type: string; name?: string; input?: unknown; text?: string }> };
  result?: string;
  total_cost_usd?: number;
}

export interface Trial {
  resultText: string;
  events: StreamEvent[];
  exitCode: number;
  stderr: string;
  durationMs: number;
  costUsd?: number;
}

interface Probe {
  id: string;
  title: string;
  trials: number;
  need: number;
  run: (ctx: Ctx, trialNo: number) => Promise<Trial>;
  grade: (trial: Trial, ctx: Ctx) => { pass: boolean; evidence: string };
}

interface Ctx {
  home: string;
  myosHome: string;
  repoRoot: string;
  model: string;
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in test/gates/ReleaseCheck.test.ts)
// ---------------------------------------------------------------------------

/** Parse a stream-json transcript, skipping non-JSON noise lines. */
export function parseStreamJson(text: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* partial line: ignore */
    }
  }
  return events;
}

/** Every tool_use block in the transcript, as {name, input-as-string}. */
export function toolUses(events: StreamEvent[]): Array<{ name: string; input: string }> {
  const uses: Array<{ name: string; input: string }> = [];
  for (const e of events) {
    if (e.type !== "assistant") continue;
    for (const block of e.message?.content ?? []) {
      if (block.type === "tool_use" && block.name) {
        uses.push({ name: block.name, input: JSON.stringify(block.input ?? {}) });
      }
    }
  }
  return uses;
}

/** Concatenated stdout of every hook that ran during the transcript. */
export function hookOutputs(events: StreamEvent[]): string {
  return events
    .filter((e) => e.type === "system" && e.subtype === "hook_response")
    .map((e) => e.output ?? "")
    .join("\n");
}

/** The final result text of a -p run ("" when the run died before one).
 * LAST result event, not first: a background agent dispatch emits an interim
 * result ("agent is running…") and then the real one when it completes. */
export function resultText(events: StreamEvent[]): string {
  const results = events.filter((e) => e.type === "result");
  return results[results.length - 1]?.result ?? "";
}

/** How many 🧠 MEMORY lines the response carries. Exactly one is correct. */
export function memoryLineCount(text: string): number {
  return (text.match(/^🧠 MEMORY:/gm) ?? []).length;
}

/** Trial verdict: pass when `need` of the recorded outcomes passed. */
export function aggregateTrials(outcomes: boolean[], need: number): Verdict {
  return outcomes.filter(Boolean).length >= need ? "pass" : "fail";
}

/** Age of a file in ms, or null when it does not exist. */
export function fileAgeMs(file: string, now = Date.now()): number | null {
  if (!existsSync(file)) return null;
  return now - statSync(file).mtimeMs;
}

export function ageLabel(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Hook file paths referenced by an installed settings.json hooks section. */
export function registeredHookFiles(settingsJson: string): string[] {
  const files = new Set<string>();
  let settings: any;
  try {
    settings = JSON.parse(settingsJson);
  } catch {
    return [];
  }
  for (const matchers of Object.values(settings?.hooks ?? {}) as any[]) {
    for (const matcher of matchers ?? []) {
      for (const h of matcher?.hooks ?? []) {
        const m = String(h?.command ?? "").match(/['"]?(\/[^'"]+\.hook\.(?:ts|sh))['"]?/);
        if (m) files.add(m[1]);
      }
    }
  }
  return [...files].sort();
}

/** Logged in ⇔ .claude.json carries an oauthAccount (tokens live in the Keychain). */
export function isLoggedIn(myosHome: string): boolean {
  try {
    return Boolean(JSON.parse(readFileSync(path.join(myosHome, ".claude.json"), "utf8"))?.oauthAccount?.emailAddress);
  } catch {
    return false;
  }
}

/** True when at least one memory-writes row records an autonomic curation run. */
export function hasCurationRun(writesJsonl: string): boolean {
  for (const line of writesJsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      if (JSON.parse(line).updated_by === "MemorySystem.add") return true;
    } catch {
      /* skip bad row */
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Subprocess plumbing
// ---------------------------------------------------------------------------

/** Minimal clean env for a probe. No CLAUDE_ or ANTHROPIC_ vars leak from the parent
 * session: a nested run inheriting CLAUDE_CODE_* would make hooks think they
 * are inside a subagent and skip. Auth comes from the Keychain + .claude.json. */
function probeEnv(ctx: Ctx): Record<string, string> {
  const env: Record<string, string> = {
    HOME: ctx.home,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "dumb",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    MYOS_HOME: ctx.myosHome,
  };
  // USER is load-bearing: claude resolves the Keychain credential item by
  // account name, so a probe without it reports "Not logged in" (bisected
  // 2026-07-29; 0/5 without USER, 8/8 with).
  if (process.env.USER) env.USER = process.env.USER;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return env;
}

async function runProc(
  cmd: string[],
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number,
  stdin?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  const started = Date.now();
  const proc = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const killer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(killer);
  return { stdout, stderr, exitCode, durationMs: Date.now() - started };
}

/** One live probe trial: myos -p in a scratch cwd, transcript captured. */
async function myosTrial(ctx: Ctx, prompt: string, extraArgs: string[] = []): Promise<Trial> {
  const launcher = path.join(ctx.myosHome, "bin/myos");
  const cwd = mkdtempSync(path.join(tmpdir(), "myos-release-probe-"));
  try {
    const r = await runProc(
      [launcher, "-p", prompt, "--model", ctx.model, "--output-format", "stream-json", "--verbose", "--max-turns", "8", ...extraArgs],
      probeEnv(ctx),
      cwd,
      ctx.timeoutMs,
    );
    const events = parseStreamJson(r.stdout);
    const costEvents = events.filter((e) => e.type === "result");
    const costEvent = costEvents[costEvents.length - 1];
    return {
      resultText: resultText(events),
      events,
      exitCode: r.exitCode,
      stderr: r.stderr,
      durationMs: r.durationMs,
      costUsd: costEvent?.total_cost_usd,
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Health checks: deterministic, zero tokens
// ---------------------------------------------------------------------------

type HealthCheck = { id: string; title: string; run: (ctx: Ctx) => Promise<Omit<CheckResult, "id" | "title" | "durationMs">> };

export const HEALTH_CHECKS: HealthCheck[] = [
  {
    id: "install-present",
    title: "Installed tree matches the repo",
    async run(ctx) {
      const versionFile = path.join(ctx.myosHome, "MYOS/VERSION");
      if (!existsSync(versionFile)) {
        return { verdict: "fail", evidence: [`${ctx.myosHome} has no MYOS/VERSION: run ./install.sh first`] };
      }
      const installed = readFileSync(versionFile, "utf8").trim();
      const repoVersionFile = path.join(ctx.repoRoot, "VERSION");
      const repo = existsSync(repoVersionFile) ? readFileSync(repoVersionFile, "utf8").trim() : null;
      if (repo && repo !== installed) {
        return {
          verdict: "warn",
          evidence: [`installed v${installed} ≠ repo v${repo}: you are validating a tree that is not the candidate; run ./install.sh`],
        };
      }
      return { verdict: "pass", evidence: [`v${installed} installed${repo ? ", matches repo" : ""}`] };
    },
  },
  {
    id: "login-state",
    title: "Headless auth is possible",
    async run(ctx) {
      const f = path.join(ctx.myosHome, ".claude.json");
      if (!existsSync(f)) {
        return { verdict: "fail", evidence: [`${f} missing: run myos once interactively and /login; live probes cannot run`] };
      }
      let j: any = {};
      try {
        j = JSON.parse(readFileSync(f, "utf8"));
      } catch {
        return { verdict: "fail", evidence: [`${f} is not valid JSON`] };
      }
      const who = j?.oauthAccount?.emailAddress;
      if (!who) return { verdict: "fail", evidence: [`.claude.json has no oauthAccount: not logged in; live probes cannot run`] };
      return { verdict: "pass", evidence: [`logged in as ${who}`] };
    },
  },
  {
    id: "hooks-registered",
    title: "Every registered hook file exists",
    async run(ctx) {
      const settingsFile = path.join(ctx.myosHome, "settings.json");
      if (!existsSync(settingsFile)) return { verdict: "fail", evidence: [`${settingsFile} missing`] };
      const files = registeredHookFiles(readFileSync(settingsFile, "utf8"));
      if (files.length === 0) return { verdict: "fail", evidence: ["settings.json registers no hooks: the autonomic layer is off"] };
      const missing = files.filter((f) => !existsSync(f));
      if (missing.length > 0) {
        return { verdict: "fail", evidence: missing.map((f) => `registered but missing: ${f}`) };
      }
      return { verdict: "pass", evidence: [`${files.length} hook files registered, all present`] };
    },
  },
  {
    id: "hooks-build",
    title: "Every registered TS hook compiles against the installed tree",
    async run(ctx) {
      const settingsFile = path.join(ctx.myosHome, "settings.json");
      if (!existsSync(settingsFile)) return { verdict: "fail", evidence: [`${settingsFile} missing`] };
      const files = registeredHookFiles(readFileSync(settingsFile, "utf8")).filter((f) => f.endsWith(".ts") && existsSync(f));
      const broken: string[] = [];
      for (const f of files) {
        const r = await runProc(
          [process.execPath, "build", f, "--target=bun", "--outfile=/dev/null"],
          probeEnv(ctx),
          ctx.myosHome,
          30_000,
        );
        const err = (r.stdout + r.stderr).match(/Could not resolve[^\n]*/);
        if (r.exitCode !== 0 || err) broken.push(`${path.basename(f)} → ${err?.[0] ?? `exit ${r.exitCode}`}`);
      }
      if (broken.length > 0) return { verdict: "fail", evidence: broken };
      return { verdict: "pass", evidence: [`${files.length} TS hooks build clean`] };
    },
  },
  {
    id: "algorithm-parity",
    title: "ALGORITHM/LATEST names a doc that exists",
    async run(ctx) {
      const latestFile = path.join(ctx.myosHome, "MYOS/ALGORITHM/LATEST");
      if (!existsSync(latestFile)) return { verdict: "fail", evidence: [`${latestFile} missing`] };
      const version = readFileSync(latestFile, "utf8").trim();
      if (!/^\d+\.\d+\.\d+$/.test(version)) return { verdict: "fail", evidence: [`LATEST holds "${version}": not a version`] };
      const doc = path.join(ctx.myosHome, `MYOS/ALGORITHM/v${version}.md`);
      if (!existsSync(doc)) return { verdict: "fail", evidence: [`LATEST names v${version} but v${version}.md does not exist`] };
      return { verdict: "pass", evidence: [`LATEST → v${version}.md, present`] };
    },
  },
  {
    id: "agents-present",
    title: "Agent definitions parse and name themselves correctly",
    async run(ctx) {
      const dir = path.join(ctx.myosHome, "agents");
      if (!existsSync(dir)) return { verdict: "fail", evidence: [`${dir} missing`] };
      const defs = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.endsWith("Context.md"));
      if (defs.length === 0) return { verdict: "fail", evidence: ["no agent definitions installed"] };
      const problems: string[] = [];
      const evidence: string[] = [];
      for (const f of defs) {
        const text = readFileSync(path.join(dir, f), "utf8");
        const fm = text.match(/^---\n([\s\S]*?)\n---/);
        const name = fm?.[1].match(/^name:\s*(\S+)/m)?.[1];
        if (!name) problems.push(`${f}: no frontmatter name`);
        else if (name !== f.replace(/\.md$/, "")) problems.push(`${f}: frontmatter name "${name}" ≠ filename`);
      }
      evidence.push(`${defs.length} agent definitions, frontmatter names match filenames`);
      if (problems.length > 0) return { verdict: "fail", evidence: problems };
      return { verdict: "pass", evidence };
    },
  },
  {
    id: "statusline",
    title: "The installed statusline renders synthetic stdin",
    async run(ctx) {
      const script = path.join(ctx.myosHome, "MYOS/statusline.ts");
      if (!existsSync(script)) return { verdict: "fail", evidence: [`${script} missing`] };
      const stdin = JSON.stringify({
        model: { display_name: "Opus" },
        workspace: { current_dir: ctx.myosHome },
        context_window: { used_percentage: 34, context_window_size: 200000, total_input_tokens: 68000 },
      });
      const r = await runProc([process.execPath, script], probeEnv(ctx), ctx.myosHome, 30_000, stdin);
      if (r.exitCode !== 0 || r.stdout.trim().length === 0) {
        return { verdict: "fail", evidence: [`exit ${r.exitCode}, stdout ${r.stdout.trim().length} bytes`, r.stderr.trim().slice(0, 200)].filter(Boolean) };
      }
      return { verdict: "pass", evidence: [`rendered ${r.stdout.trim().split("\n")[0].slice(0, 60)}…`] };
    },
  },
];

// ---------------------------------------------------------------------------
// Live probes: myos -p, graded on the transcript
// ---------------------------------------------------------------------------

function installedAlgorithmVersion(ctx: Ctx): string | null {
  const f = path.join(ctx.myosHome, "MYOS/ALGORITHM/LATEST");
  if (!existsSync(f)) return null;
  const v = readFileSync(f, "utf8").trim();
  return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

export const PROBES: Probe[] = [
  {
    id: "boot",
    title: "Authenticated boot: system prompt + hooks load, model answers",
    trials: 2,
    need: 1,
    run: (ctx) => myosTrial(ctx, "Reply with exactly: boot-ok"),
    grade(trial) {
      const pass = trial.resultText.includes("boot-ok");
      return { pass, evidence: pass ? `replied boot-ok in ${(trial.durationMs / 1000).toFixed(1)}s` : `exit ${trial.exitCode}, result: ${trial.resultText.slice(0, 120) || trial.stderr.slice(0, 120)}` };
    },
  },
  {
    id: "skill-routing",
    title: "Skill invocation: the Writing skill loads and does its job",
    trials: 2,
    need: 1,
    run: (ctx) =>
      myosTrial(
        ctx,
        'Using the Writing skill, check this sentence against the myos house style and name each violation: "We should leverage best practices in order to utilize the new framework." (release smoke-test)',
      ),
    grade(trial) {
      const uses = toolUses(trial.events);
      const touched = uses.some(
        (u) =>
          (u.name === "Skill" && /writing/i.test(u.input)) ||
          ((u.name === "Read" || u.name === "Bash") && /skills\/Writing/i.test(u.input)),
      );
      const planted = ["leverage", "best practices", "in order to", "utilize"];
      const named = planted.filter((p) => trial.resultText.toLowerCase().includes(p)).length;
      if (!touched) return { pass: false, evidence: `no Skill/Read/Bash touched skills/Writing: answered without loading the skill (${named}/4 violations named)` };
      if (named < 2) return { pass: false, evidence: `skill loaded but only ${named}/4 planted violations named` };
      return { pass: true, evidence: `skill loaded via ${uses.find((u) => /writing/i.test(u.input))?.name}, ${named}/4 violations named` };
    },
  },
  {
    id: "agent-dispatch",
    title: "Agent dispatch: Max (the second look) spawns and returns",
    trials: 3,
    need: 1,
    run: (ctx) =>
      myosTrial(
        ctx,
        // subagent_type is spelled out because a small model sometimes drops it
        // and spawns the default agent instead: which the grader rightly fails,
        // but that is model flakiness, not a broken agent definition.
        'Spawn an agent using your agent-dispatch tool with subagent_type set exactly to "Max" and this exact task: "Reply with exactly the string MAX-OK. Do not search the web. Do not use any tools." Then reply with only what the agent returned. (release smoke-test)',
        ["--allowedTools", "Task,Agent"],
      ),
    grade(trial) {
      // The dispatch tool is named Agent on current harnesses, Task on older ones.
      const dispatch = toolUses(trial.events).find((u) => (u.name === "Task" || u.name === "Agent") && u.input.includes("Max"));
      const returned = trial.resultText.includes("MAX-OK");
      if (!dispatch) return { pass: false, evidence: "no dispatch tool_use naming Max in the transcript: a claimed dispatch is not one" };
      if (!returned) return { pass: false, evidence: "agent dispatched but MAX-OK never came back" };
      return { pass: true, evidence: `${dispatch.name} → Max dispatched, MAX-OK returned in ${(trial.durationMs / 1000).toFixed(1)}s` };
    },
  },
  {
    id: "algorithm-load",
    title: "The Algorithm loads on demand at its shipped version",
    trials: 2,
    need: 1,
    run: (ctx) =>
      myosTrial(
        ctx,
        "Read ~/.myos/MYOS/ALGORITHM/LATEST, then read the versioned Algorithm doc it names, and reply on one line: ALGORITHM <version>: <the exact heading of the section that lists what must be true when a run is done>. (release smoke-test)",
        ["--allowedTools", "Read"],
      ),
    grade(trial, ctx) {
      const version = installedAlgorithmVersion(ctx);
      if (!version) return { pass: false, evidence: "installed ALGORITHM/LATEST unreadable" };
      const readDoc = toolUses(trial.events).some((u) => u.name === "Read" && u.input.includes(`v${version}.md`));
      const versionEchoed = trial.resultText.includes(version);
      const headingEchoed = /run is complete/i.test(trial.resultText);
      if (!readDoc) return { pass: false, evidence: `v${version}.md was never Read: the load path did not reach the doc` };
      if (!versionEchoed || !headingEchoed) {
        return { pass: false, evidence: `doc read but answer wrong: ${trial.resultText.slice(0, 120)}` };
      }
      return { pass: true, evidence: `read v${version}.md, echoed version + completion-section heading` };
    },
  },
  {
    id: "model-routing",
    title: "Inference levels execute the tier the registry maps them to",
    trials: 1,
    need: 1,
    async run(ctx) {
      // Both cheap rungs in one probe: low → haiku, medium → sonnet. The tool
      // itself verifies the EXECUTED model from the envelope and reports it on
      // stderr; that read-back, not the request, is what gets graded.
      const tool = path.join(ctx.myosHome, "MYOS/TOOLS/Inference.ts");
      const env = { ...probeEnv(ctx), CLAUDE_CONFIG_DIR: ctx.myosHome };
      const started = Date.now();
      const outputs: string[] = [];
      let exitCode = 0;
      for (const level of ["low", "medium"]) {
        const r = await runProc(
          [process.execPath, tool, "--level", level, "You are a release smoke-test responder.", "Reply with exactly: ok"],
          env,
          ctx.myosHome,
          ctx.timeoutMs,
        );
        outputs.push(`level=${level} ${r.stderr.match(/\[model][^\n]*/)?.[0] ?? `(no [model] line; exit ${r.exitCode})`}`);
        if (r.exitCode !== 0) exitCode = r.exitCode;
      }
      return { resultText: outputs.join("\n"), events: [], exitCode, stderr: "", durationMs: Date.now() - started };
    },
    async grade(trial, ctx) {
      // Expected tiers come from the INSTALLED registry, so a lineup change
      // there moves the expectation with it.
      let effort: Record<string, string>;
      try {
        effort = (await import(path.join(ctx.myosHome, "MYOS/TOOLS/models.ts"))).EFFORT_MODEL;
      } catch {
        return { pass: false, evidence: "installed models.ts unimportable" };
      }
      const problems: string[] = [];
      for (const level of ["low", "medium"]) {
        const line = trial.resultText.split("\n").find((l) => l.startsWith(`level=${level}`)) ?? "";
        const executed = line.match(/executed=(\S+)/)?.[1] ?? "";
        if (!executed.includes(effort[level])) problems.push(`${level} should run ${effort[level]}, executed=${executed || "nothing"}`);
        if (line.includes("DOWNGRADED")) problems.push(`${level} was downgraded`);
      }
      if (problems.length > 0) return { pass: false, evidence: problems.join("; ") };
      return { pass: true, evidence: trial.resultText.replace(/\n/g, " · ") };
    },
  } as Probe & { grade: (t: Trial, c: Ctx) => Promise<{ pass: boolean; evidence: string }> },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runProbe(probe: Probe, ctx: Ctx): Promise<CheckResult> {
  const started = Date.now();
  const evidence: string[] = [];
  const outcomes: boolean[] = [];
  for (let t = 1; t <= probe.trials; t++) {
    let outcome = { pass: false, evidence: "" };
    try {
      const trial = await probe.run(ctx, t);
      outcome = await probe.grade(trial, ctx);
    } catch (e) {
      outcome = { pass: false, evidence: `trial error: ${(e as Error).message}` };
    }
    outcomes.push(outcome.pass);
    evidence.push(`trial ${t}/${probe.trials}: ${outcome.pass ? "✓" : "✗"} ${outcome.evidence}`);
    if (outcomes.filter(Boolean).length >= probe.need) break;
  }
  return {
    id: probe.id,
    title: probe.title,
    verdict: aggregateTrials(outcomes, probe.need),
    evidence,
    durationMs: Date.now() - started,
  };
}

const ICON: Record<Verdict, string> = { pass: "✅", warn: "⚠️ ", fail: "❌", skip: "⏭️ " };

function printResult(r: CheckResult): void {
  console.log(`  ${ICON[r.verdict]} ${r.id.padEnd(18)} ${r.evidence[0] ?? ""}`);
  for (const line of r.evidence.slice(1)) console.log(`     ${" ".repeat(18)} ${line}`);
}

export async function main(argv: string[]): Promise<number> {
  const has = (f: string) => argv.includes(f);
  const value = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (has("--list")) {
    for (const c of HEALTH_CHECKS) console.log(`health  ${c.id.padEnd(18)} ${c.title}`);
    for (const p of PROBES) console.log(`live    ${p.id.padEnd(18)} ${p.title} (${p.need}/${p.trials} trials)`);
    return 0;
  }

  const home = value("--home") ?? process.env.HOME ?? "";
  const ctx: Ctx = {
    home,
    myosHome: path.join(home, ".myos"),
    repoRoot: path.resolve(import.meta.dir, ".."),
    model: value("--model") ?? "haiku",
    timeoutMs: Number(value("--timeout") ?? 240_000),
  };
  const only = value("--probe")?.split(",").map((s) => s.trim());
  const wantHealth = !has("--live") || Boolean(only);
  const wantLive = !has("--health");

  const results: CheckResult[] = [];
  console.log(`myos release check: validating ${ctx.myosHome}\n`);

  const selectedHealth = HEALTH_CHECKS.filter((c) => !only || only.includes(c.id));
  if (wantHealth && selectedHealth.length > 0) {
    console.log("HEALTH (deterministic, zero tokens)");
    for (const check of selectedHealth) {
      const started = Date.now();
      let r: Omit<CheckResult, "id" | "title" | "durationMs">;
      try {
        r = await check.run(ctx);
      } catch (e) {
        r = { verdict: "fail", evidence: [`check crashed: ${(e as Error).message}`] };
      }
      const result = { id: check.id, title: check.title, ...r, durationMs: Date.now() - started };
      results.push(result);
      printResult(result);
    }
  }

  if (wantLive) {
    const loginCheck = results.find((r) => r.id === "login-state");
    const loginOk = loginCheck ? loginCheck.verdict === "pass" : isLoggedIn(ctx.myosHome);
    const installOk = existsSync(path.join(ctx.myosHome, "MYOS/VERSION"));
    console.log(`\nLIVE (model: ${ctx.model}, transcript-graded, trials stop at first needed pass)`);
    for (const probe of PROBES) {
      if (only && !only.includes(probe.id)) continue;
      if (!installOk || !loginOk) {
        const result: CheckResult = {
          id: probe.id,
          title: probe.title,
          verdict: "skip",
          evidence: [!installOk ? "no installed tree" : "not logged in: run myos interactively once"],
          durationMs: 0,
        };
        results.push(result);
        printResult(result);
        continue;
      }
      const result = await runProbe(probe, ctx);
      results.push(result);
      printResult(result);
    }
    // A live section that could not run at all is a finding, not a quiet gap.
    if (results.some((r) => r.verdict === "skip")) {
      results.push({
        id: "live-preconditions",
        title: "Live probes were requested but could not run",
        verdict: "fail",
        evidence: ["live probes skipped: the release candidate's live behaviour is unvalidated"],
        durationMs: 0,
      });
      printResult(results[results.length - 1]);
    }
  }

  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const failed = count("fail") > 0;
  console.log(
    `\nSUMMARY: ${count("pass")} pass · ${count("warn")} warn · ${count("fail")} fail · ${count("skip")} skip: ${failed ? "❌ NOT release-ready" : "✅ release-ready"}`,
  );
  if (has("--json")) console.log(JSON.stringify(results, null, 2));
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
