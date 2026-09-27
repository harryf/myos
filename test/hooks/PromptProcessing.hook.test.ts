/**
 * PromptProcessing names a session from its first prompt, deterministically:
 * trimmed to 48 characters, written once. The anti property that matters: no
 * model is ever called. A stub `claude` on a sparse PATH would leave a marker
 * file if anything spawned it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { repoPath } from "../harness.ts";
import { events, myosHome, runHook, SESSION_ID, sparsePath } from "./harness.ts";
import { nameFromPrompt } from "../../payload/hooks/PromptProcessing.hook.ts";

const HOOK = "payload/hooks/PromptProcessing.hook.ts";
const NAMES = ".myos/MYOS/MEMORY/STATE/session-names.json";

async function names(home: { join(...p: string[]): string }): Promise<Record<string, string>> {
  const file = Bun.file(home.join(NAMES));
  return (await file.exists()) ? JSON.parse(await file.text()) : {};
}

describe("nameFromPrompt (pure)", () => {
  test("first prompt, whitespace collapsed, cut to 48 characters", () => {
    const n = nameFromPrompt("  Fix the statusline\n\npercentage bug in the myos toolkit and more words  ")!;
    expect(n).toBe("Fix the statusline percentage bug in the myos to");
    expect(n.length).toBeLessThanOrEqual(48);
  });

  test("a short prompt is kept whole; a slash command keeps its name", () => {
    expect(nameFromPrompt("publish it now")).toBe("publish it now");
    expect(nameFromPrompt("<command-name>/upgrade</command-name> <command-args>now</command-args>")).toBe("/upgrade");
  });

  test("system text and bare ratings never name a session", () => {
    expect(nameFromPrompt("<system-reminder>x</system-reminder>")).toBeNull();
    expect(nameFromPrompt("<task-notification>done</task-notification>")).toBeNull();
    expect(nameFromPrompt("9")).toBeNull();
    expect(nameFromPrompt("   ")).toBeNull();
  });
});

describe("the hook", () => {
  test("the first prompt names the session; a later prompt does not rename it", async () => {
    using home = myosHome("promptproc-first");
    await runHook(HOOK, { home, stdin: events.userPrompt("Build the hooks layer for myos") });
    await runHook(HOOK, { home, stdin: events.userPrompt("now the tests please") });
    expect((await names(home))[SESSION_ID]).toBe("Build the hooks layer for myos");
  });

  test("Anti: no claude spawn, even with a claude binary on PATH", async () => {
    using home = myosHome("promptproc-noclaude");
    const marker = home.join("claude-was-called");
    using bin = sparsePath({ stub: { claude: `touch '${marker}'` } });
    const result = await runHook(HOOK, {
      home,
      stdin: events.userPrompt("Rewrite the ads readout for Friday"),
      env: { PATH: bin.path },
    });
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(marker).exists()).toBe(false);
    expect((await names(home))[SESSION_ID]).toBe("Rewrite the ads readout for Friday");
  });

  test("Anti: the source has no inference path", () => {
    const src = readFileSync(repoPath(HOOK), "utf8");
    expect(src).not.toMatch(/Inference\.ts|\bspawn(Sync)?\(|execSync\(|fetch\(/);
  });

  test("Anti: unparseable stdin exits 0 without writing", async () => {
    using home = myosHome("promptproc-badstdin");
    const result = await runHook(HOOK, { home, stdin: "{nope" });
    expect(result.exitCode).toBe(0);
    expect(await names(home)).toEqual({});
  });
});
