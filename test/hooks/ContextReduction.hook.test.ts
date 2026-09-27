/**
 * ContextReduction rewrites Bash commands to their rtk equivalents before
 * execution: a MUTATOR, not a blocker. Its header carries a do-not-regress
 * invariant from the 2026-06-10 Vector ISA incident: compress what the model
 * WATCHES (build/test/VCS status), never what it READS (search, file reads,
 * HTTP). The Anti tests are that invariant.
 *
 * rtk itself is never executed by the hook (only `command -v` checks it), so
 * a stub rtk on PATH lets every rewrite rule run on machines without rtk.
 * jq IS executed, so those tests gate on it.
 */

import { describe, expect, test } from "bun:test";

import { gate, haveBin } from "../harness.ts";
import { events, myosHome, runHook, sparsePath, type HookResult } from "./harness.ts";

const HOOK = "payload/hooks/ContextReduction.hook.sh";
const skipNoJq = gate("ContextReduction", haveBin("jq"), "jq not on PATH: rewrite rules untestable");

/** PATH with a stub rtk prepended to the real PATH (the script needs sed/grep/jq). */
function pathWithRtk() {
  const bin = sparsePath({ stub: { rtk: "exit 0" } });
  return { bin, PATH: `${bin.path}:${process.env.PATH}` };
}

function rewrittenCommand(result: HookResult): string | null {
  if (!result.stdout.trim()) return null;
  const out = JSON.parse(result.stdout);
  expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
  return out.hookSpecificOutput.updatedInput.command;
}

async function rewrite(command: string): Promise<{ result: HookResult; command: string | null }> {
  using home = myosHome("ctxred");
  const { bin, PATH } = pathWithRtk();
  try {
    const result = await runHook(HOOK, {
      home,
      stdin: events.preToolUse("Bash", { command }),
      env: { PATH },
    });
    return { result, command: rewrittenCommand(result) };
  } finally {
    bin[Symbol.dispose]();
  }
}

describe.skipIf(skipNoJq)("watch-path commands are compressed", () => {
  test("git status → rtk git status", async () => {
    const { command } = await rewrite("git status");
    expect(command).toBe("rtk git status");
  });

  test("npm test → rtk npm test", async () => {
    const { command } = await rewrite("npm test");
    expect(command).toBe("rtk npm test");
  });

  test("a leading env assignment is preserved through the rewrite", async () => {
    const { command } = await rewrite("NODE_ENV=production npx vitest run --coverage");
    expect(command).toBe("NODE_ENV=production rtk vitest run --coverage");
  });

  test("other tool_input fields survive the rewrite untouched", async () => {
    using home = myosHome("ctxred-fields");
    const { bin, PATH } = pathWithRtk();
    try {
      const result = await runHook(HOOK, {
        home,
        stdin: events.preToolUse("Bash", { command: "git diff", description: "Show working tree diff" }),
        env: { PATH },
      });
      const updated = JSON.parse(result.stdout).hookSpecificOutput.updatedInput;
      expect(updated.command).toBe("rtk git diff");
      expect(updated.description).toBe("Show working tree diff");
    } finally {
      bin[Symbol.dispose]();
    }
  });

  test("interceptor screenshot --save is redirected into /tmp/myos-screenshots", async () => {
    const { command } = await rewrite("interceptor screenshot --save shot.jpg");
    expect(command).toContain("mkdir -p /tmp/myos-screenshots");
    expect(command).toContain("cd /tmp/myos-screenshots");
  });
});

describe.skipIf(skipNoJq)("Anti: read-path commands are NEVER rewritten (Vector ISA invariant)", () => {
  for (const readPath of [
    "rg -n 'pattern' src/",
    "grep -rn pattern .",
    "cat README.md",
    "ls -la",
    "find . -name '*.ts'",
    "curl https://example.com/health",
    "head -20 file.txt",
  ]) {
    test(`Anti: ${readPath.split(" ")[0]} runs exactly as issued`, async () => {
      const { result, command } = await rewrite(readPath);
      expect(command).toBeNull();
      expect(result.exitCode).toBe(0);
    });
  }
});

describe.skipIf(skipNoJq)("skips", () => {
  test("an already-rtk command is left alone", async () => {
    const { command } = await rewrite("rtk git status");
    expect(command).toBeNull();
  });

  test("heredocs are never rewritten", async () => {
    const { command } = await rewrite("git status <<EOF\nweird\nEOF");
    expect(command).toBeNull();
  });

  test("multi-line scripts are never rewritten (byte-offset corruption guard)", async () => {
    const { command } = await rewrite("git status\ngit diff");
    expect(command).toBeNull();
  });

  test("non-matching commands pass through silently", async () => {
    const { result, command } = await rewrite("bun run build");
    expect(command).toBeNull();
    expect(result.exitCode).toBe(0);
  });
});

describe("missing dependencies", () => {
  test("without rtk on PATH the hook exits 0 silently: never blocks Bash", async () => {
    using home = myosHome("ctxred-nortk");
    const result = await runHook(HOOK, {
      home,
      stdin: events.preToolUse("Bash", { command: "git status" }),
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
