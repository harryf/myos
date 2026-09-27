/**
 * ReleaseCheck is the manual pre-release validation runner. Its live probes
 * burn tokens and are run by hand right before a tag: so NOTHING here ever
 * launches one. What is tested: every grader helper, the health checks against
 * fixture installs (healthy and broken), and the skip path that keeps live
 * probes from running against a tree that cannot answer.
 */

import { describe, expect, test } from "bun:test";

import {
  ageLabel,
  aggregateTrials,
  hasCurationRun,
  isLoggedIn,
  memoryLineCount,
  parseStreamJson,
  registeredHookFiles,
  resultText,
  toolUses,
} from "../../Tools/ReleaseCheck.ts";
import { bunExe, repoPath, repoVersion, run, tempHome, type HomeDir } from "../harness.ts";

const TOOL = repoPath("Tools/ReleaseCheck.ts");

// ---------------------------------------------------------------------------
// Transcript parsing: the graders' eyes
// ---------------------------------------------------------------------------

describe("stream-json parsing", () => {
  const transcript = [
    "some non-json noise the CLI printed",
    JSON.stringify({ type: "system", subtype: "hook_response", hook_name: "SessionStart:startup", output: "<myos-memory-delta>x</myos-memory-delta>" }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "on it" }, { type: "tool_use", name: "Agent", input: { subagent_type: "Max", prompt: "reply MAX-OK" } }] },
    }),
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/x/v8.4.0.md"}}]}}',
    "{broken json",
    JSON.stringify({ type: "result", result: "The agent is running in the background." }),
    JSON.stringify({ type: "result", result: "MAX-OK", total_cost_usd: 0.01 }),
  ].join("\n");

  test("noise and broken lines are skipped, events survive", () => {
    expect(parseStreamJson(transcript)).toHaveLength(5);
  });

  test("tool uses come back with name and stringified input", () => {
    const uses = toolUses(parseStreamJson(transcript));
    expect(uses.map((u) => u.name)).toEqual(["Agent", "Read"]);
    expect(uses[0].input).toContain("Max");
    expect(uses[1].input).toContain("v8.4.0.md");
  });

  test("resultText takes the LAST result: a background agent dispatch emits an interim one first", () => {
    // Pinned from a real probe (2026-07-29): grading the first result event
    // reads "the agent is running…" and fails a dispatch that succeeded.
    expect(resultText(parseStreamJson(transcript))).toBe("MAX-OK");
  });

  test("resultText is empty when the run died before any result", () => {
    expect(resultText(parseStreamJson("no json at all"))).toBe("");
  });
});

describe("graders", () => {
  test("memoryLineCount counts only line-initial 🧠 MEMORY lines", () => {
    expect(memoryLineCount("hello")).toBe(0);
    expect(memoryLineCount("🧠 MEMORY: fresh\nhello")).toBe(1);
    expect(memoryLineCount("🧠 MEMORY: a\ntext\n🧠 MEMORY: b")).toBe(2);
    expect(memoryLineCount("quoted mid-line 🧠 MEMORY: not a render")).toBe(0);
  });

  test("aggregateTrials passes at `need` passes and not before", () => {
    expect(aggregateTrials([false, true], 1)).toBe("pass");
    expect(aggregateTrials([false, false], 1)).toBe("fail");
    expect(aggregateTrials([true, false, true], 2)).toBe("pass");
    expect(aggregateTrials([true, false, false], 2)).toBe("fail");
  });

  test("ageLabel scales minutes → hours → days", () => {
    expect(ageLabel(5 * 60000)).toBe("5m");
    expect(ageLabel(3 * 3_600_000)).toBe("3h");
    expect(ageLabel(72 * 3_600_000)).toBe("3d");
  });
});

describe("install-state readers", () => {
  test("registeredHookFiles finds quoted hook paths across events, deduplicated", () => {
    const settings = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ command: "bun '/inst/hooks/A.hook.ts'" }, { command: "bun '/inst/hooks/B.hook.sh'" }] }],
        Stop: [{ hooks: [{ command: "bun '/inst/hooks/A.hook.ts'" }] }],
      },
    });
    expect(registeredHookFiles(settings)).toEqual(["/inst/hooks/A.hook.ts", "/inst/hooks/B.hook.sh"]);
  });

  test("registeredHookFiles returns [] on malformed settings rather than throwing", () => {
    expect(registeredHookFiles("{not json")).toEqual([]);
    expect(registeredHookFiles("{}")).toEqual([]);
  });

  test("hasCurationRun is true only for MemorySystem.add rows, bad rows skipped", () => {
    expect(hasCurationRun('{"updated_by":"MemorySystem.add"}\n')).toBe(true);
    expect(hasCurationRun('{"updated_by":"SomethingElse"}\n{broken\n')).toBe(false);
    expect(hasCurationRun("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixture installs for the CLI
// ---------------------------------------------------------------------------

/** A fixture ~/.myos that every health check should call healthy. */
function healthyHome(name: string): HomeDir {
  const home = tempHome(name);
  const hook = home.write(".myos/hooks/Ok.hook.ts", 'console.log("ok");\n');
  home.write(".myos/MYOS/VERSION", `${repoVersion()}\n`);
  home.write(".myos/.claude.json", JSON.stringify({ hasCompletedOnboarding: true, oauthAccount: { emailAddress: "pm@example.com" } }));
  home.write(".myos/settings.json", JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: `bun '${hook}'` }] }] } }));
  home.write(".myos/MYOS/MEMORY/STATE/delta-surface-heartbeat", new Date().toISOString());
  home.write(".myos/MYOS/USER/CACHE/freshness.json", JSON.stringify({ overall_grade: "B", fresh_count: 3, total: 4 }));
  home.write(".myos/MYOS/MEMORY/OBSERVABILITY/memory-writes.jsonl", '{"ts":"2026-07-29T00:00:00Z","updated_by":"MemorySystem.add","additions":["x"]}\n');
  home.write(".myos/MYOS/ALGORITHM/LATEST", "9.9.9\n");
  home.write(".myos/MYOS/ALGORITHM/v9.9.9.md", "# The Algorithm 9.9.9\n");
  home.write(".myos/agents/TestAgent.md", "---\nname: TestAgent\n---\nbody\n");
  home.write(".myos/MYOS/statusline.ts", 'console.log("fixture statusline");\n');
  return home;
}

test("isLoggedIn reads oauthAccount from a fixture .claude.json", () => {
  using home = healthyHome("releasecheck-login");
  expect(isLoggedIn(home.join(".myos"))).toBe(true);
  using empty = tempHome("releasecheck-nologin");
  expect(isLoggedIn(empty.join(".myos"))).toBe(false);
});

describe("CLI --list", () => {
  test("names every health check and probe without touching an install", async () => {
    const result = await run([bunExe(), TOOL, "--list"]);
    expect(result.exitCode).toBe(0);
    for (const id of ["install-present", "login-state", "hooks-build", "algorithm-parity", "statusline"]) {
      expect(result.stdout).toContain(id);
    }
    for (const id of ["boot", "skill-routing", "agent-dispatch", "algorithm-load", "model-routing"]) {
      expect(result.stdout).toContain(id);
    }
  });
});

describe("CLI --health against a healthy fixture install", () => {
  test("every check passes and the run is release-ready", async () => {
    using home = healthyHome("releasecheck-healthy");
    const result = await run([bunExe(), TOOL, "--health", "--home", home.path]);
    expect(result.stdout).toContain("✅ install-present");
    expect(result.stdout).toContain("✅ login-state");
    expect(result.stdout).toContain("✅ hooks-registered");
    expect(result.stdout).toContain("✅ hooks-build");
    expect(result.stdout).toContain("✅ algorithm-parity");
    expect(result.stdout).toContain("✅ agents-present");
    expect(result.stdout).toContain("✅ statusline");
    expect(result.stdout).toContain("✅ release-ready");
    expect(result.exitCode).toBe(0);
  });

  test("Anti: --health never reaches the live section", async () => {
    using home = healthyHome("releasecheck-nolive");
    const result = await run([bunExe(), TOOL, "--health", "--home", home.path]);
    expect(result.stdout).not.toContain("LIVE");
    expect(result.stdout).not.toContain("trial");
  });
});

describe("CLI --health against broken fixture installs", () => {
  test("a registered hook whose file is gone fails hooks-registered", async () => {
    using home = healthyHome("releasecheck-missinghook");
    home.write(".myos/settings.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: `bun '${home.join(".myos/hooks/Gone.hook.ts")}'` }] }] } }));
    const result = await run([bunExe(), TOOL, "--health", "--home", home.path]);
    expect(result.stdout).toContain("❌ hooks-registered");
    expect(result.stdout).toContain("Gone.hook.ts");
    expect(result.exitCode).toBe(1);
  });

  test("a hook that cannot compile fails hooks-build with the resolver error", async () => {
    using home = healthyHome("releasecheck-brokenhook");
    const bad = home.write(".myos/hooks/Broken.hook.ts", 'import { x } from "./DoesNotExist.ts";\nconsole.log(x);\n');
    home.write(".myos/settings.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: `bun '${bad}'` }] }] } }));
    const result = await run([bunExe(), TOOL, "--health", "--home", home.path]);
    expect(result.stdout).toContain("❌ hooks-build");
    expect(result.stdout).toContain("Broken.hook.ts");
    expect(result.exitCode).toBe(1);
  });

  test("ALGORITHM/LATEST pointing at a missing doc fails parity", async () => {
    using home = healthyHome("releasecheck-algodrift");
    home.write(".myos/MYOS/ALGORITHM/LATEST", "1.0.0\n");
    const result = await run([bunExe(), TOOL, "--health", "--home", home.path]);
    expect(result.stdout).toContain("❌ algorithm-parity");
    expect(result.stdout).toContain("v1.0.0.md does not exist");
    expect(result.exitCode).toBe(1);
  });

  test("an installed version that is not the repo's warns without failing", async () => {
    using home = healthyHome("releasecheck-staleinstall");
    home.write(".myos/MYOS/VERSION", "0.0.1\n");
    const result = await run([bunExe(), TOOL, "--health", "--home", home.path]);
    expect(result.stdout).toContain("⚠️  install-present");
    expect(result.stdout).toContain("run ./install.sh");
    expect(result.exitCode).toBe(0);
  });

  test("an agent whose frontmatter name disagrees with its filename fails", async () => {
    using home = healthyHome("releasecheck-agentname");
    home.write(".myos/agents/TestAgent.md", "---\nname: SomeoneElse\n---\nbody\n");
    const result = await run([bunExe(), TOOL, "--health", "--home", home.path]);
    expect(result.stdout).toContain("❌ agents-present");
    expect(result.stdout).toContain('"SomeoneElse" ≠ filename');
    expect(result.exitCode).toBe(1);
  });

  test("an empty HOME fails install-present with the install.sh pointer", async () => {
    using home = tempHome("releasecheck-noinstall");
    const result = await run([bunExe(), TOOL, "--health", "--home", home.path]);
    expect(result.stdout).toContain("❌ install-present");
    expect(result.stdout).toContain("run ./install.sh first");
    expect(result.exitCode).toBe(1);
  });
});

describe("Anti: live probes never run against a tree that cannot answer", () => {
  test("no login → every probe skips instantly and the gap is itself a failure", async () => {
    using home = healthyHome("releasecheck-liveskip");
    const { rmSync } = await import("node:fs");
    rmSync(home.join(".myos/.claude.json"));

    // Full run (health + live): live probes must SKIP without ever spawning
    // the launcher: the fixture has no bin/myos, so a spawn attempt would
    // surface as a trial error rather than the clean skip asserted here.
    const result = await run([bunExe(), TOOL, "--home", home.path]);
    expect(result.stdout).toContain("⏭️  boot");
    expect(result.stdout).toContain("not logged in");
    expect(result.stdout).not.toContain("trial 1");
    expect(result.stdout).toContain("live probes skipped: the release candidate's live behaviour is unvalidated");
    expect(result.exitCode).toBe(1);
  });
});
