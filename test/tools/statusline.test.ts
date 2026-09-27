/**
 * The statusline runs on every render, so a throw here is a visible break in
 * every session. It has to survive malformed and partial stdin without failing,
 * which is most of what these tests check.
 */

import { describe, expect, test } from "bun:test";

import { bunExe, repoPath, run, tempHome } from "../harness.ts";

const TOOL = "payload/MYOS/statusline.ts";

interface StatuslineInput {
  model?: { display_name?: string; id?: string };
  workspace?: { current_dir?: string };
  cwd?: string;
  context_window?: { used_percentage?: number; total_input_tokens?: number; context_window_size?: number };
}

/** A scratch install with a VERSION file, so the version segment has something to read. */
function installedHome(name: string, version = "9.9.9") {
  const home = tempHome(`statusline-${name}`);
  home.write(".myos/MYOS/VERSION", `${version}\n`);
  return home;
}

async function statusline(home: ReturnType<typeof tempHome>, input: StatuslineInput | string) {
  return await run([bunExe(), repoPath(TOOL)], {
    env: home.env(),
    stdin: typeof input === "string" ? input : JSON.stringify(input),
  });
}

describe("segments", () => {
  test("the shipped shape: myos v0.1.0 │ model │ ctx 34% │ cwd", async () => {
    using home = installedHome("shape", "0.1.0");
    const result = await statusline(home, {
      model: { display_name: "Fable" },
      workspace: { current_dir: "/tmp/project" },
      context_window: { used_percentage: 34, context_window_size: 200_000, total_input_tokens: 68_000 },
    });
    const parts = result.stdout.trim().split(" │ ");
    expect(parts.slice(0, 4)).toEqual(["myos v0.1.0", "Fable", "ctx 34% (132k free)", "/tmp/project"]);
  });

  test("renders version, model, context and cwd separated by │", async () => {
    using home = installedHome("full");
    const result = await statusline(home, {
      model: { display_name: "Opus" },
      workspace: { current_dir: "/tmp/project" },
      context_window: { used_percentage: 34, context_window_size: 200_000, total_input_tokens: 68_000 },
    });

    expect(result.exitCode).toBe(0);
    const line = result.stdout.trim();
    expect(line).toContain("myos v9.9.9");
    expect(line).toContain("Opus");
    expect(line).toContain("ctx 34% (132k free)");
    expect(line).toContain("/tmp/project");
    expect(line.split(" │ ").length).toBeGreaterThanOrEqual(4);
  });

  test("percentage is rounded, and free tokens are floored at zero", async () => {
    using home = installedHome("rounding");
    const result = await statusline(home, {
      context_window: { used_percentage: 33.6, context_window_size: 100, total_input_tokens: 500 },
    });
    expect(result.stdout).toContain("ctx 34% (0k free)");
  });

  test("derives the percentage from token counts when used_percentage is absent", async () => {
    using home = installedHome("derived");
    const result = await statusline(home, {
      context_window: { total_input_tokens: 50_000, context_window_size: 200_000 },
    });
    expect(result.stdout).toContain("ctx 25%");
  });

  test("falls back to the model id when there is no display name", async () => {
    using home = installedHome("modelid");
    const result = await statusline(home, { model: { id: "claude-opus-4-8" } });
    expect(result.stdout).toContain("claude-opus-4-8");
  });

  test("a path under HOME is shortened to ~", async () => {
    using home = installedHome("tilde");
    const result = await statusline(home, { workspace: { current_dir: `${home.path}/work` } });
    expect(result.stdout).toContain("~/work");
    expect(result.stdout).not.toContain(home.path);
  });

  test("lists the always-loaded myos CLAUDE.md when it exists", async () => {
    using home = installedHome("ctxfiles");
    home.write(".myos/CLAUDE.md", "# context\n");
    const result = await statusline(home, { workspace: { current_dir: `${home.path}/work` } });
    expect(result.stdout).toContain("ctx-files:");
    expect(result.stdout).toContain("~/.myos/CLAUDE.md");
  });

  test("collects a project CLAUDE.md and a .claude/CLAUDE.md walking up from cwd", async () => {
    using home = installedHome("walkup");
    home.mkdir("work/sub");
    home.write("work/CLAUDE.md", "# project\n");
    home.write("work/sub/.claude/CLAUDE.md", "# nested\n");

    const result = await statusline(home, { workspace: { current_dir: `${home.path}/work/sub` } });
    expect(result.stdout).toContain("~/work/CLAUDE.md");
    expect(result.stdout).toContain("~/work/sub/.claude/CLAUDE.md");
  });

  test("the walk stops at HOME and does not climb past it", async () => {
    using home = installedHome("stopathome");
    home.write("CLAUDE.md", "# should not be listed\n");
    const result = await statusline(home, { workspace: { current_dir: `${home.path}/work` } });
    expect(result.stdout).not.toContain("~/CLAUDE.md");
  });
});

describe("robustness: a throw here breaks every render", () => {
  test("malformed stdin still produces a line", async () => {
    using home = installedHome("badjson");
    const result = await statusline(home, "{not json at all");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("myos v9.9.9");
  });

  test("empty stdin still produces a line", async () => {
    using home = installedHome("empty");
    const result = await statusline(home, "");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
  });

  test("an absent VERSION file renders ? rather than failing", async () => {
    using home = tempHome("statusline-noversion");
    const result = await statusline(home, { model: { display_name: "Opus" } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("myos v?");
  });

  test("missing context_window renders the unknown marker", async () => {
    using home = installedHome("noctx");
    const result = await statusline(home, { model: { display_name: "Opus" } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ctx ?");
  });

  test("null and wrong-typed fields do not throw", async () => {
    using home = installedHome("wrongtypes");
    const result = await run([bunExe(), repoPath(TOOL)], {
      env: home.env(),
      stdin: JSON.stringify({ model: null, workspace: "not-an-object", context_window: { used_percentage: "34" } }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ctx ?");
  });

  test("empty segments are dropped rather than leaving a dangling separator", async () => {
    using home = installedHome("nosegments");
    const result = await statusline(home, {});
    expect(result.stdout).not.toContain("│  │");
    expect(result.stdout.trim()).not.toEndWith("│");
  });
});

describe("the version it reports", () => {
  test("comes from CLAUDE_CONFIG_DIR, so the launcher's isolation holds", async () => {
    using home = installedHome("configdir", "1.2.3");
    using other = installedHome("other", "4.5.6");
    const result = await run([bunExe(), repoPath(TOOL)], {
      env: home.env({ CLAUDE_CONFIG_DIR: `${other.path}/.myos` }),
      stdin: "{}",
    });
    expect(result.stdout).toContain("myos v4.5.6");
  });
});
