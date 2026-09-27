/**
 * HookContract: the cross hook properties no single hook's test can own.
 *
 * Silent unwiring is the failure class: a hook file that is registered
 * nowhere never runs and nothing notices. So the contract is two way (every
 * registered command points at a real file; every file is registered or a
 * named sub-gate of StopGates), plus the ordering, timeout and anti
 * properties the whole layer promises.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { bunExe, repoPath } from "../harness.ts";

interface HookCommand {
  event: string;
  matcher?: string;
  command: string;
  type?: string;
  async?: boolean;
  timeout?: number;
}

const settings = JSON.parse(readFileSync(repoPath("payload/settings.template.json"), "utf8"));

function registeredCommands(): HookCommand[] {
  const out: HookCommand[] = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {}) as [string, any[]][]) {
    for (const group of groups) {
      for (const hook of group?.hooks ?? []) {
        out.push({ event, matcher: group.matcher, command: hook.command, type: hook.type, async: hook.async, timeout: hook.timeout });
      }
    }
  }
  return out;
}

function hookPathOf(command: string): string | null {
  const m = command.match(/__MYOS_HOME__\/hooks\/([\w.-]+\.hook\.(?:ts|sh))/);
  return m ? m[1]! : null;
}

const onDisk = new Set(readdirSync(repoPath("payload/hooks")).filter((f) => /\.hook\.(ts|sh)$/.test(f)));

/** The exact shipped set: adding or dropping a hook is a decision made here. */
const TARGET = [
  "AgentInvocation", "CheckpointPerISC", "ContextReduction", "DriftReminder", "EventLogger", "FormatGate",
  "HookHealer", "ISACloseGate", "ISAFoldGate", "ISAGate", "ISAStaleWriteGuard", "ISASync", "LastResponseCache",
  "LoadContext", "LoopDetector", "ModelRungGuard", "PromptProcessing", "PublicPushGate", "Safety",
  "SessionCleanup", "StopGates", "TaskGovernance", "TimeContext", "TokenLog", "TrialClock", "VerificationGate",
];

/** Gates StopGates imports and runs; each stays runnable alone via its shim. */
const SUB_GATES: Record<string, string> = {
  "FormatGate.hook.ts": "StopGates.hook.ts",
  "VerificationGate.hook.ts": "StopGates.hook.ts",
  "ISACloseGate.hook.ts": "StopGates.hook.ts",
  "ISAFoldGate.hook.ts": "StopGates.hook.ts",
  "ISAGate.hook.ts": "StopGates.hook.ts",
};

describe("the shipped set", () => {
  test("payload/hooks holds exactly the target hooks", () => {
    const names = [...onDisk].map((f) => f.replace(/\.hook\.(ts|sh)$/, "")).sort();
    expect(names).toEqual([...TARGET].sort());
  });
});

describe("registration parity", () => {
  const registered = new Set(registeredCommands().map((c) => hookPathOf(c.command)).filter(Boolean) as string[]);

  test("every registered hook command points at a file that ships", () => {
    expect(registered.size).toBeGreaterThan(0);
    for (const file of registered) expect(onDisk.has(file), `registered hooks/${file} is not in payload/hooks`).toBe(true);
  });

  test("every hook file is registered or a StopGates sub-gate", () => {
    for (const file of onDisk) {
      expect(registered.has(file) || file in SUB_GATES, `payload/hooks/${file} will never run`).toBe(true);
    }
  });

  test("sub-gates are not registered on their own (they would run twice)", () => {
    for (const [sub, via] of Object.entries(SUB_GATES)) {
      expect(registered.has(sub), `${sub} is registered directly and via ${via}`).toBe(false);
      expect(registered.has(via)).toBe(true);
    }
  });

  test("TypeScript hooks are registered via `bun <path>` so they survive losing their exec bit", () => {
    for (const cmd of registeredCommands()) {
      const file = hookPathOf(cmd.command);
      if (file?.endsWith(".ts")) expect(cmd.command, `${cmd.event} ${file}`).toStartWith("bun ");
    }
  });

  test("every entry is a command hook with a timeout; no http hooks anywhere", () => {
    for (const cmd of registeredCommands()) {
      expect(cmd.type, `${cmd.event} ${cmd.command}`).toBe("command");
      expect(typeof cmd.timeout, `${cmd.event} ${cmd.command} has no timeout`).toBe("number");
    }
    expect(JSON.stringify(settings.hooks)).not.toContain('"http"');
    expect(JSON.stringify(settings.hooks)).not.toContain("http://");
  });
});

describe("ordering and placement", () => {
  const byEvent = (event: string) => registeredCommands().filter((c) => c.event === event).map((c) => hookPathOf(c.command));

  test("Stop runs LastResponseCache, then StopGates", () => {
    expect(byEvent("Stop")).toEqual(["LastResponseCache.hook.ts", "StopGates.hook.ts"]);
  });

  test("StopGates dispatches the gates in the documented order", () => {
    const src = readFileSync(repoPath("payload/hooks/StopGates.hook.ts"), "utf8");
    const order = src.match(/GATES: GateModule\[\] = \[([^\]]+)\]/)![1]!.split(",").map((s) => s.trim());
    expect(order).toEqual(["formatGate", "verificationGate", "isaCloseGate", "isaFoldGate", "isaGate"]);
  });

  test("SessionStart and UserPromptSubmit carry the documented hooks in order", () => {
    expect(byEvent("SessionStart")).toEqual(["HookHealer.hook.ts", "LoadContext.hook.ts", "TrialClock.hook.ts"]);
    expect(byEvent("UserPromptSubmit")).toEqual([
      "TimeContext.hook.ts", "DriftReminder.hook.ts", "PromptProcessing.hook.ts", "ModelRungGuard.hook.ts",
    ]);
  });

  test("PromptProcessing, ModelRungGuard, EventLogger and TokenLog are async; gates are not", () => {
    const cmds = registeredCommands();
    for (const name of ["PromptProcessing", "ModelRungGuard", "EventLogger", "TokenLog"]) {
      for (const c of cmds.filter((c) => hookPathOf(c.command) === `${name}.hook.ts`)) expect(c.async, name).toBe(true);
    }
    for (const name of ["StopGates", "PublicPushGate", "ISAStaleWriteGuard"]) {
      for (const c of cmds.filter((c) => hookPathOf(c.command) === `${name}.hook.ts`)) expect(c.async ?? false, name).toBe(false);
    }
  });

  test("PublicPushGate guards Bash, ISAStaleWriteGuard guards Write|Edit before the tool runs", () => {
    const pre = registeredCommands().filter((c) => c.event === "PreToolUse");
    expect(pre.find((c) => hookPathOf(c.command) === "PublicPushGate.hook.ts")?.matcher).toBe("Bash");
    expect(pre.find((c) => hookPathOf(c.command) === "ISAStaleWriteGuard.hook.ts")?.matcher).toBe("Write|Edit");
  });
});

describe("anti properties", () => {
  const files = [...onDisk, ...readdirSync(repoPath("payload/hooks/lib")).map((f) => `lib/${f}`)];
  const sources = files.map((f) => ({ f, src: readFileSync(repoPath("payload/hooks", f), "utf8") }));

  test("no hook spawns `claude` or imports Inference", () => {
    for (const { f, src } of sources) {
      expect(src, f).not.toMatch(/Inference(\.ts)?['"]/);
      expect(src, f).not.toMatch(/spawn(Sync)?\(\s*\[?\s*['"]claude['"]/);
      expect(src, f).not.toMatch(/exec(File)?(Sync)?\(\s*['"]claude\b/);
    }
  });

  test("no voice, notification server, kitty, Pulse, telegram, pmai or 31337 reference", () => {
    for (const { f, src } of sources) expect(src, f).not.toMatch(/31337|ntfy|osascript|elevenlabs|kitty|voice|pulse|telegram|pmai/i);
  });

  test("no ~/Projects assumption (Harry keeps projects in ~/Code)", () => {
    for (const { f, src } of sources) expect(src, f).not.toMatch(/\bProjects\b/);
  });

  test("no hook shells out through execSync", () => {
    for (const { f, src } of sources) expect(src, f).not.toMatch(/execSync\(/);
  });

  test("no em dash character in any hook source", () => {
    for (const { f, src } of sources) expect(src.includes("\u2014"), f).toBe(false);
  });

  test("Safety makes no network or model call", () => {
    for (const f of ["Safety.hook.ts", "lib/safety-classifier.ts"]) {
      const src = readFileSync(repoPath("payload/hooks", f), "utf8");
      expect(src, f).not.toMatch(/from ["'](node:)?(child_process|https?|net)["']|\bfetch\(|Bun\.spawn|Inference/);
    }
  });

  test("every hook file bundles for bun", () => {
    for (const f of [...onDisk].filter((f) => f.endsWith(".ts"))) {
      const r = Bun.spawnSync([bunExe(), "build", repoPath("payload/hooks", f), "--target=bun", "--outfile=/dev/null"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(r.exitCode, `${f}: ${new TextDecoder().decode(r.stderr)}`).toBe(0);
    }
  });
});
