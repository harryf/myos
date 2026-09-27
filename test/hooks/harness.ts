/**
 * test/hooks/harness.ts: the hook execution harness.
 *
 * Hooks are subprocesses wired to Claude Code lifecycle events: they read one
 * JSON payload from stdin, act on ~/.myos, and exit. Testing them means running
 * the real script against a sandbox HOME: never importing hook logic into the
 * test process, because most hooks resolve paths from `os.homedir()`, which Bun
 * fixes at process start (see test/harness.ts).
 *
 * Two rules from DEVELOPMENT.md are load-bearing here:
 *
 *   1. Some hooks can spawn real inference or detached workers. Every run gets
 *      a HARD timeout that kills the child: a hook that hangs fails its test
 *      loudly instead of hanging `bun test` (the documented fake-stdin trap).
 *   2. Every run gets a scrubbed env rooted at a throwaway HOME, so no test can
 *      touch the developer's real ~/.myos, bill a subscription, or inherit the
 *      subagent markers that make most hooks skip themselves.
 *
 * PATH control: `sparsePath()` builds a bin dir holding ONLY named binaries
 * (symlinks to the real ones, or stub scripts). Hooks whose deep path would
 * shell out to `claude` or `security` run with a sparse PATH so the dangerous
 * branch fails fast and deterministically instead of doing real work.
 */

import { chmodSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";

import {
  bunExe,
  repoPath,
  tempDir,
  tempHome,
  type HomeDir,
  type TempDir,
} from "../harness.ts";

// ---------------------------------------------------------------------------
// The sandbox install
// ---------------------------------------------------------------------------

/** The directories a real install guarantees before any hook fires. */
const MYOS_TREE = [
  "MYOS/MEMORY/STATE",
  "MYOS/MEMORY/OBSERVABILITY",
  "MYOS/MEMORY/WORK",
  "MYOS/MEMORY/LEARNING",
  "MYOS/MEMORY/SKILLS",
  "MYOS/MEMORY/SECURITY",
  "MYOS/MEMORY/KNOWLEDGE",
  "MYOS/USER/CONFIG",
  "MYOS/USER/CACHE",
  "MYOS/USER/PRINCIPAL",
  "MYOS/TOOLS",
  "hooks",
  "agents",
] as const;

/**
 * A scratch HOME with a myos-shaped ~/.myos inside it. `files` are written
 * relative to the HOME root (so "\.myos/…" paths address the install).
 */
export function myosHome(name: string, files: Record<string, string> = {}): HomeDir {
  const home = tempHome(`hook-${name}`);
  for (const dir of MYOS_TREE) mkdirSync(path.join(home.myos, dir), { recursive: true });
  for (const [rel, contents] of Object.entries(files)) home.write(rel, contents);
  return home;
}

// ---------------------------------------------------------------------------
// Running a hook
// ---------------------------------------------------------------------------

/** Kill threshold. Hooks budget <100ms-2s; a run this long is already a bug. */
export const HOOK_TIMEOUT_MS = 15_000;

export interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  output: string;
  /** True when the harness had to kill the hook: always a failure to assert on. */
  timedOut: boolean;
}

export interface HookRunOptions {
  /** Sandbox HOME the hook resolves ~/.myos against. */
  home: HomeDir;
  /**
   * stdin payload. An object is JSON-encoded (the normal hook contract), a
   * string is sent raw (malformed-input tests). Omit for empty/closed stdin.
   */
  stdin?: unknown;
  args?: string[];
  /** Env overrides on top of the sandbox env; `undefined` deletes a key. */
  env?: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Run one hook script (repo-relative path) as Claude Code would: JSON on
 * stdin, sandbox HOME, captured stdout/stderr/exit. `.sh` hooks run under
 * bash; everything else under bun.
 */
export async function runHook(hookRel: string, options: HookRunOptions): Promise<HookResult> {
  const script = repoPath(hookRel);
  const cmd = hookRel.endsWith(".sh")
    ? ["/bin/bash", script, ...(options.args ?? [])]
    : [bunExe(), script, ...(options.args ?? [])];

  const stdin =
    options.stdin === undefined
      ? ("ignore" as const)
      : new TextEncoder().encode(
          typeof options.stdin === "string" ? options.stdin : JSON.stringify(options.stdin),
        );

  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd ?? repoPath("."),
    env: options.home.env(options.env),
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, options.timeoutMs ?? HOOK_TIMEOUT_MS);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { stdout, stderr, exitCode, output: stdout + stderr, timedOut };
}

// ---------------------------------------------------------------------------
// PATH control
// ---------------------------------------------------------------------------

export interface SparseBin {
  /** A real binary already on this machine, exposed under its own name. */
  link?: string[];
  /** Stub scripts by name; body is a bash script (shebang added). */
  stub?: Record<string, string>;
}

/**
 * A bin dir containing ONLY what the test names, for use as the entire PATH.
 * `bun` is always included (hooks re-spawn it), plus the core shell utilities
 * a bash stub needs. Returns the TempDir; use `.path` as PATH.
 */
export function sparsePath(spec: SparseBin = {}): TempDir {
  const dir = tempDir("hook-bin");
  const link = (name: string, target: string) => {
    try {
      symlinkSync(target, dir.join(name));
    } catch {
      /* duplicate name: first one wins */
    }
  };

  link("bun", bunExe());
  for (const name of spec.link ?? []) {
    const target = Bun.which(name);
    if (target) link(name, target);
  }
  for (const [name, body] of Object.entries(spec.stub ?? {})) {
    const file = dir.write(name, `#!/bin/bash\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Hook event payloads (the shapes Claude Code sends on stdin)
// ---------------------------------------------------------------------------

export const SESSION_ID = "hooktest-session-0001";

type Overrides = Record<string, unknown>;

export const events = {
  userPrompt(prompt: string, over: Overrides = {}) {
    return {
      session_id: SESSION_ID,
      transcript_path: "",
      hook_event_name: "UserPromptSubmit",
      prompt,
      ...over,
    };
  },
  preToolUse(toolName: string, toolInput: Record<string, unknown>, over: Overrides = {}) {
    return {
      session_id: SESSION_ID,
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput,
      ...over,
    };
  },
  postToolUse(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolResponse?: unknown,
    over: Overrides = {},
  ) {
    return {
      session_id: SESSION_ID,
      hook_event_name: "PostToolUse",
      tool_name: toolName,
      tool_input: toolInput,
      ...(toolResponse !== undefined ? { tool_response: toolResponse } : {}),
      ...over,
    };
  },
  stop(over: Overrides = {}) {
    return {
      session_id: SESSION_ID,
      transcript_path: "",
      hook_event_name: "Stop",
      ...over,
    };
  },
  sessionEnd(over: Overrides = {}) {
    return {
      session_id: SESSION_ID,
      transcript_path: "",
      hook_event_name: "SessionEnd",
      ...over,
    };
  },
};

// ---------------------------------------------------------------------------
// Transcript fixtures (Claude Code JSONL shape)
// ---------------------------------------------------------------------------

/** One transcript line: a real user prompt. */
export function userText(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
}

/** One transcript line: an assistant text block. */
export function assistantText(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

/** One transcript line: an assistant tool_use block. */
export function assistantToolUse(name: string, input: Record<string, unknown>, id = "tu-1"): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  });
}

/** One transcript line: the paired tool_result (arrives as a user-role entry). */
export function toolResult(id: string, text: string, isError = false): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }],
    },
  });
}

export function transcript(...lines: string[]): string {
  return lines.join("\n") + "\n";
}
