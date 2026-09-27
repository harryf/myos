/**
 * bin/myos is the front door: it must point Claude Code at ~/.myos, append the
 * myos system prompt when one is installed, shield a session started in $HOME
 * or inside another install's dir from that install's project settings, let
 * MYOS_SETTING_SOURCES override the shield, and pass every other argument
 * through untouched. A stub `claude` on a sparse PATH records what it got.
 */

import { describe, expect, test } from "bun:test";
import { chmodSync, realpathSync } from "node:fs";

import { makeTestEnv, repoPath, run, tempHome } from "../harness.ts";

const LAUNCHER = repoPath("bin/myos");

interface Launch {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** argv the stub claude received, one entry per arg. */
  args: string[];
  configDir: string;
}

/** A sandbox HOME (realpath, so bash's $PWD compares equal) with a stub claude. */
function sandbox(name: string, opts: { installed?: boolean; systemPrompt?: boolean } = {}) {
  const home = tempHome(`launcher-${name}`);
  const real = realpathSync(home.path);
  if (opts.installed !== false) home.write(".myos/MYOS/VERSION", "0.1.0\n");
  if (opts.systemPrompt) home.write(".myos/MYOS/MYOS_SYSTEM_PROMPT.md", "# prompt\n");
  home.write("stub/claude", [
    "#!/bin/bash",
    'printf "CONFIG=%s\\n" "$CLAUDE_CONFIG_DIR"',
    'for a in "$@"; do printf "ARG=%s\\n" "$a"; done',
  ].join("\n"));
  chmodSync(home.join("stub/claude"), 0o755);
  return Object.assign(home, { real });
}

async function launch(home: ReturnType<typeof sandbox>, args: string[], cwd: string, extra: Record<string, string | undefined> = {}): Promise<Launch> {
  const env = makeTestEnv({
    HOME: home.real,
    MYOS_HOME: `${home.real}/.myos`,
    PATH: `${home.real}/stub:/usr/bin:/bin`,
    CLAUDE_CONFIG_DIR: undefined,
    MYOS_DIR: undefined,
    ...extra,
  });
  const result = await run([LAUNCHER, ...args], { env, cwd });
  const lines = result.stdout.split("\n");
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    args: lines.filter((l) => l.startsWith("ARG=")).map((l) => l.slice(4)),
    configDir: lines.find((l) => l.startsWith("CONFIG="))?.slice(7) ?? "",
  };
}

describe("--version", () => {
  test("prints myos v<VERSION> from $MYOS_HOME/MYOS/VERSION without launching claude", async () => {
    using home = sandbox("version");
    const result = await launch(home, ["--version"], home.real);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("myos v0.1.0");
    expect(result.args).toEqual([]);
  });

  test("says so when nothing is installed", async () => {
    using home = sandbox("version-none", { installed: false });
    const result = await launch(home, ["--version"], home.real);
    expect(result.stdout).toContain("not installed");
  });
});

describe("launching", () => {
  test("exports CLAUDE_CONFIG_DIR=$MYOS_HOME and passes user args through, after its own", async () => {
    using home = sandbox("exec");
    const project = home.mkdir("Code/proj");
    const result = await launch(home, ["--resume", "-p", "hello world"], realpathSync(project));
    expect(result.exitCode).toBe(0);
    expect(result.configDir).toBe(`${home.real}/.myos`);
    expect(result.args).toEqual(["--resume", "-p", "hello world"]);
  });

  test("appends the system prompt file when it is installed", async () => {
    using home = sandbox("prompt", { systemPrompt: true });
    const project = realpathSync(home.mkdir("Code/proj"));
    const result = await launch(home, ["-p", "x"], project);
    expect(result.args).toEqual(["--append-system-prompt-file", `${home.real}/.myos/MYOS/MYOS_SYSTEM_PROMPT.md`, "-p", "x"]);
  });

  test("a missing MYOS_HOME exits 1 with the install pointer", async () => {
    using home = sandbox("missing");
    const result = await launch(home, [], home.real, { MYOS_HOME: `${home.real}/nope` });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Run install.sh");
  });
});

describe("the settings sources shield", () => {
  test("on in $HOME when ~/.claude/settings.json exists", async () => {
    using home = sandbox("shield-home");
    home.write(".claude/settings.json", "{}");
    const result = await launch(home, [], home.real);
    expect(result.args).toEqual(["--setting-sources", "user"]);
    expect(result.stderr).toContain("excluding project settings");
  });

  test("off in $HOME when there is no ~/.claude/settings.json", async () => {
    using home = sandbox("shield-home-clean");
    const result = await launch(home, [], home.real);
    expect(result.args).toEqual([]);
  });

  test("on anywhere under ~/.claude*", async () => {
    using home = sandbox("shield-claude-dir");
    const inside = realpathSync(home.mkdir(".claude-personal/PAI"));
    const result = await launch(home, [], inside);
    expect(result.args).toEqual(["--setting-sources", "user"]);
  });

  test("off in an ordinary project dir, so repo .claude settings load", async () => {
    using home = sandbox("shield-project");
    home.write(".claude/settings.json", "{}");
    const project = realpathSync(home.mkdir("Code/proj"));
    const result = await launch(home, [], project);
    expect(result.args).toEqual([]);
  });

  test("MYOS_SETTING_SOURCES overrides the shield in both directions", async () => {
    using home = sandbox("shield-override");
    home.write(".claude/settings.json", "{}");
    const atHome = await launch(home, [], home.real, { MYOS_SETTING_SOURCES: "user,project,local" });
    expect(atHome.args).toEqual(["--setting-sources", "user,project,local"]);
    const project = realpathSync(home.mkdir("Code/proj"));
    const inProject = await launch(home, [], project, { MYOS_SETTING_SOURCES: "user" });
    expect(inProject.args).toEqual(["--setting-sources", "user"]);
  });
});

describe("bash 3.2 safety", () => {
  test("with no args at all the empty-array guard holds under set -u", async () => {
    using home = sandbox("empty");
    const project = realpathSync(home.mkdir("Code/proj"));
    const result = await launch(home, [], project);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("unbound variable");
  });

  test("the script avoids bash 4 only syntax", async () => {
    const source = await Bun.file(LAUNCHER).text();
    expect(source).not.toMatch(/declare -A|mapfile|readarray|\$\{[A-Za-z_]+(,,|\^\^)\}/);
    expect(source).toContain("exec claude");
  });
});
