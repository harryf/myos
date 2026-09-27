/**
 * test/harness.ts: the one shared test harness.
 *
 * Zero external dependencies: Bun built-ins only (`Bun`, `bun:test`, `node:fs`,
 * `node:path`, `node:os`, `node:child_process`). It has to be importable before
 * anyone runs `bun install`, because most of what it tests has no node_modules.
 * See MYOS/DOCUMENTATION/Testing/TestingDoctrine.md rule 1.
 *
 * What lives here:
 *   - `testEnv`: a scrubbed environment. Never `process.env`.
 *   - `tempDir` / `envScope`: disposable scopes (`using`), never hand-rolled try/finally.
 *   - `run` / `runTool`: subprocess capture with the deadlock-free 3-way Promise.all.
 *   - `haveBin` / `haveEnv` / `haveModule` + `gate`: optional-dependency predicates.
 *     A missing ffmpeg skips a test; it never fails one and never passes one silently.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** Repo root (this file sits at <repo>/test/harness.ts). */
export const REPO: string = path.resolve(import.meta.dir, "..");

/** payload/: the shipped tree, which mirrors ~/.myos 1:1. */
export const PAYLOAD: string = path.join(REPO, "payload");

/**
 * The real home dir, captured before anything scrubs the environment.
 * Only for tests that deliberately read the INSTALLED tree at ~/.myos
 * (TranscriptParser's home-climbing import is the one that has to). Never
 * write through this.
 */
export const REAL_HOME: string = os.homedir();

/** The installed tree, if this machine has one. Read-only for tests. */
export const INSTALLED_MYOS: string = process.env.MYOS_TEST_INSTALLED_DIR ?? path.join(REAL_HOME, ".myos");

export function bunExe(): string {
  return process.execPath;
}

/** Absolute path to a file in the repo, from a repo-relative path. */
export function repoPath(...parts: string[]): string {
  return path.join(REPO, ...parts);
}

// ---------------------------------------------------------------------------
// Scrubbed environment
// ---------------------------------------------------------------------------

/**
 * Vendor credentials. A test that inherits these can bill a real subscription
 * or make a wrapper pass for the wrong reason (it reached the live API instead
 * of taking the "no key" branch the test meant to exercise).
 */
const CREDENTIAL_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "PERPLEXITY_API_KEY",
  "REPLICATE_API_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "ELEVENLABS_API_KEY",
  "CLEANVOICE_API_KEY",
  "FAL_KEY",
] as const;

/** Sandbox HOME shared by the whole run. Created lazily, removed by preload. */
let sandboxHome: string | undefined;

export function sandboxHomeDir(): string {
  if (sandboxHome === undefined) {
    sandboxHome = mkdtempSync(path.join(os.tmpdir(), "myos-test-home-"));
    mkdirSync(path.join(sandboxHome, ".myos"), { recursive: true });
  }
  return sandboxHome;
}

export function removeSandboxHome(): void {
  if (sandboxHome !== undefined) {
    rmSync(sandboxHome, { recursive: true, force: true });
    sandboxHome = undefined;
  }
}

/**
 * The environment every spawned tool gets. HOME points at a sandbox, so a tool
 * that resolves `~/.myos` writes into the sandbox rather than the developer's
 * real install. MYOS_DIR / CLAUDE_CONFIG_DIR follow it for the same reason.
 */
export function makeTestEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const home = overrides.HOME ?? sandboxHomeDir();
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    // The same two values settings.template.json ships: the config dir is
    // ~/.myos and MYOS_DIR is the system dir INSIDE it. Getting that nesting
    // wrong sends a tool's state writes one level up from where it reads them.
    CLAUDE_CONFIG_DIR: path.join(home, ".myos"),
    MYOS_DIR: path.join(home, ".myos", "MYOS"),
    TZ: "Etc/UTC",
    CI: "1",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    TERM: "dumb",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  for (const key of CREDENTIAL_KEYS) delete base[key];
  for (const key of Object.keys(base)) {
    if (key.startsWith("BUN_DEBUG")) delete base[key];
  }
  return base;
}

/** The default scrubbed env. Pass this as `env`, never `process.env`. */
export const testEnv: Record<string, string> = makeTestEnv();

// ---------------------------------------------------------------------------
// Disposable scopes
// ---------------------------------------------------------------------------

export interface TempDir extends Disposable {
  readonly path: string;
  /** Absolute path inside the temp dir. */
  join(...parts: string[]): string;
  /** Write a file, creating parent dirs. Returns the absolute path. */
  write(relPath: string, contents: string): string;
  /** Create a directory, including parents. Returns the absolute path. */
  mkdir(relPath: string): string;
  toString(): string;
}

/**
 * A temp directory that removes itself at end of scope:
 *   using dir = tempDir("merge-settings", { "settings.json": "{}" });
 */
export function tempDir(name: string, files: Record<string, string> = {}): TempDir {
  const root = mkdtempSync(path.join(os.tmpdir(), `myos-${name.replace(/[^A-Za-z0-9_-]/g, "-")}-`));

  const api: TempDir = {
    path: root,
    join: (...parts: string[]) => path.join(root, ...parts),
    write(relPath: string, contents: string) {
      const target = path.join(root, relPath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
      return target;
    },
    mkdir(relPath: string) {
      const target = path.join(root, relPath);
      mkdirSync(target, { recursive: true });
      return target;
    },
    toString: () => root,
    [Symbol.dispose]() {
      rmSync(root, { recursive: true, force: true });
    },
  };

  for (const [relPath, contents] of Object.entries(files)) api.write(relPath, contents);
  return api;
}

/**
 * A disposable copy of a real directory, for tools that write INSIDE their own
 * tree (`import.meta.dir`-relative state). Importing such a tool from the copy
 * keeps its writes out of payload/.
 */
export interface TempCopyOptions {
  /**
   * Sub-path to place the copy under, mirroring where it lives in a real install
   * (e.g. "skills" for a skill). Anything the tool resolves relative to its own
   * directory then stays inside the disposable root: a skill that writes to
   * `<self>/../../MYOS/MEMORY` lands in the copy, not next to it.
   */
  under?: string;
}

export function tempCopy(name: string, sourceDir: string, options: TempCopyOptions = {}): TempDir {
  // Deliberately NOT in the OS temp dir: node resolution walks UP from the
  // importing file, so a copy under /tmp cannot see the repo's node_modules and
  // every dep-carrying tool fails to import. A scratch root inside the repo
  // keeps resolution working while still keeping writes out of payload/.
  const scratchRoot = path.join(REPO, ".test-tmp");
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(path.join(scratchRoot, `${name.replace(/[^A-Za-z0-9_-]/g, "-")}-`));
  const target = path.join(root, options.under ?? "", path.basename(sourceDir));
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(sourceDir, target, { recursive: true });

  return {
    path: target,
    join: (...parts: string[]) => path.join(target, ...parts),
    write(relPath: string, contents: string) {
      const file = path.join(target, relPath);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, contents);
      return file;
    },
    mkdir(relPath: string) {
      const dir = path.join(target, relPath);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    toString: () => target,
    [Symbol.dispose]() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * A scratch $HOME with a myos-shaped tree inside it, for tools that resolve
 * their paths from HOME. Returns the temp dir plus the ~/.myos path in it.
 */
export interface HomeDir extends TempDir {
  readonly myos: string;
  /** Env for a subprocess rooted at this HOME. */
  env(overrides?: Record<string, string | undefined>): Record<string, string>;
}

export function tempHome(name: string, files: Record<string, string> = {}): HomeDir {
  const dir = tempDir(`home-${name}`, files);
  const myos = path.join(dir.path, ".myos");
  mkdirSync(myos, { recursive: true });
  return Object.assign(dir, {
    myos,
    env: (overrides: Record<string, string | undefined> = {}) => makeTestEnv({ HOME: dir.path, ...overrides }),
  });
}

/**
 * Sets process env vars for the duration of a scope and restores them after,
 * including keys that were absent (deleted again rather than set to "undefined").
 *
 * NOTE: `os.homedir()` is resolved once at process start in Bun, so overriding
 * HOME in-process does NOT move it. Anything reading `os.homedir()` must be
 * tested through `run`/`runTool` with a sandbox HOME instead.
 */
export function envScope(vars: Record<string, string | undefined>): Disposable {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return {
    [Symbol.dispose]() {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Subprocess capture
// ---------------------------------------------------------------------------

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** stdout + stderr, for assertions that do not care which stream carried it. */
  output: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}

/**
 * Spawn and capture. The 3-way Promise.all is not stylistic: awaiting `exited`
 * before draining the pipes deadlocks as soon as a child writes more than one
 * pipe buffer (doctrine rule 5).
 */
export async function run(cmd: string[], options: RunOptions = {}): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd ?? REPO,
    env: options.env ?? testEnv,
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode, output: stdout + stderr };
}

/** Run a repo-relative bun script: runTool("Tools/ContrabandCheck.ts"). */
export function runTool(relPath: string, args: string[] = [], options: RunOptions = {}): Promise<RunResult> {
  return run([bunExe(), repoPath(relPath), ...args], options);
}

// ---------------------------------------------------------------------------
// Optional dependencies
// ---------------------------------------------------------------------------

/**
 * Every skip this run recorded, printed once by test/preload.ts. A skipped test
 * that says nothing is indistinguishable from a passing one, which is how a
 * whole surface goes quietly untested for a release.
 */
export const skipLedger = new Map<string, string>();

/** Record a skip and return true, for `test.skipIf(...)`. */
export function gate(label: string, available: boolean, reason: string): boolean {
  if (!available) skipLedger.set(label, reason);
  return !available;
}

const binCache = new Map<string, boolean>();

/** Is an executable on PATH? */
export function haveBin(name: string): boolean {
  const cached = binCache.get(name);
  if (cached !== undefined) return cached;
  let found = false;
  try {
    execFileSync("/usr/bin/env", ["which", name], { stdio: "ignore", env: testEnv });
    found = true;
  } catch {
    found = false;
  }
  binCache.set(name, found);
  return found;
}

/** Is a credential present in the REAL environment (tests never use its value)? */
export function haveEnv(name: string): boolean {
  const value = process.env[name] ?? realEnvSnapshot.get(name);
  return typeof value === "string" && value.length > 0;
}

/**
 * The real environment as it was before preload scrubbed it, so `haveEnv` can
 * still answer "would a live run have a key?" without any test seeing the value.
 */
export const realEnvSnapshot = new Map<string, string>();

export function snapshotRealEnv(): void {
  for (const key of CREDENTIAL_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) realEnvSnapshot.set(key, "present");
  }
}

const moduleCache = new Map<string, boolean>();

/** Is a node module resolvable from the repo (i.e. has someone run bun install)? */
export function haveModule(spec: string, fromDir: string = REPO): boolean {
  const key = `${fromDir}::${spec}`;
  const cached = moduleCache.get(key);
  if (cached !== undefined) return cached;
  let found = false;
  try {
    found = existsSync(Bun.resolveSync(spec, fromDir));
  } catch {
    found = false;
  }
  moduleCache.set(key, found);
  return found;
}

/**
 * Can this module actually be imported here? `haveModule` only asks the resolver,
 * and bun's auto-install makes that answer optimistic: it resolves a package it
 * has never fetched. An import is the honest question, so anything whose deps are
 * deferred to first use (Evals, Prompting, Remotion) gates on this instead.
 */
export async function canImport(specifier: string): Promise<boolean> {
  try {
    await import(specifier);
    return true;
  } catch {
    return false;
  }
}

/** Does this machine have a myos install to read? */
export function haveInstalledTree(): boolean {
  return existsSync(path.join(INSTALLED_MYOS, "MYOS", "VERSION"));
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Strip everything that legitimately varies between runs, so drift in line
 * numbers, timestamps, temp paths or colour codes never causes a diff, and
 * drift in content always does (doctrine rule 7).
 */
export function normalize(text: string, replacements: Record<string, string> = {}): string {
  let out = text.replaceAll("\r\n", "\n");
  for (const [from, to] of Object.entries(replacements)) out = out.replaceAll(from, to);
  return out
    .replaceAll(REPO, "<repo>")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<iso-timestamp>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>")
    .replace(/\b\d+(\.\d+)?ms\b/g, "<duration>")
    .replace(/\/(tmp|private\/var\/folders)\/[^\s"']*/g, "<tmp>");
}

/**
 * Extract the first JSON object or array from a tool's stdout. Several tools
 * print a JSON report and then a human summary line, so `JSON.parse(stdout)`
 * alone fails on output that is perfectly correct.
 */
export function parseJsonOutput<T = any>(stdout: string): T {
  const start = stdout.search(/[[{]/);
  if (start === -1) throw new Error(`no JSON found in output:\n${stdout}`);
  const opener = stdout[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stdout.length; i += 1) {
    const char = stdout[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return JSON.parse(stdout.slice(start, i + 1));
    }
  }
  throw new Error(`unterminated JSON in output:\n${stdout}`);
}

/** Read the repo VERSION file (single source of truth). */
export function repoVersion(): string {
  return readFileSync(repoPath("VERSION"), "utf8").trim();
}
