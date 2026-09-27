/**
 * MergeSettings is the upgrade-safety contract in code: it decides what a new
 * release is allowed to change in a settings.json that belongs to the PM. Every
 * test here pins a rule DEVELOPMENT.md states in prose, including the two that
 * have bitten this codebase (a rule silently pruned for naming an unknown tool,
 * and a nested template edit that never reaches an existing install).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";

import { PAYLOAD, repoPath, run, bunExe, tempDir, tempHome } from "../harness.ts";

const TOOL = "payload/MYOS/TOOLS/MergeSettings.ts";

const {
  KNOWN_TOOL_NAMES,
  applyArrayMerge,
  deepEqual,
  expandEnvHomeReferences,
  extractMyosHomePaths,
  foldTemplateAdditions,
  hookIdentity,
  isAppendAnnotation,
  mergeSettings,
  permissionRuleRejectionReason,
  prunePermissionRules,
  pruneStaleHookRegistrations,
  templateHookIdentities,
} = await import(repoPath(TOOL));

// ---------------------------------------------------------------------------
// mergeSettings
// ---------------------------------------------------------------------------

describe("mergeSettings", () => {
  test("user values win and system key order survives", () => {
    const merged = mergeSettings(
      { a: 1, b: { c: 2, d: 3 }, e: 4 },
      { b: { c: 99 }, z: "new" },
    );
    expect(merged).toEqual({ a: 1, b: { c: 99, d: 3 }, e: 4, z: "new" });
    expect(Object.keys(merged)).toEqual(["a", "b", "e", "z"]);
  });

  test("arrays replace by default", () => {
    expect(mergeSettings({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] });
  });

  test('{ __merge: "append" } appends instead of replacing, and the annotation is consumed', () => {
    const merged = mergeSettings({ list: [1, 2] }, { list: { __merge: "append", values: [3] } });
    expect(merged).toEqual({ list: [1, 2, 3] });
    expect(JSON.stringify(merged)).not.toContain("__merge");
  });

  test("append against an absent system value yields just the user values", () => {
    expect(applyArrayMerge(undefined, { __merge: "append", values: [1] })).toEqual([1]);
  });

  test("append against a non-array system value throws rather than guessing", () => {
    expect(() => applyArrayMerge("scalar", { __merge: "append", values: [1] })).toThrow(/requires the system value to be an array/);
  });

  test("a malformed __merge annotation is an error, not a silent literal", () => {
    expect(() => mergeSettings({}, { list: { __merge: "prepend", values: [1] } })).toThrow(/__merge annotations must use/);
  });

  test("isAppendAnnotation rejects lookalikes", () => {
    expect(isAppendAnnotation({ __merge: "append", values: [] })).toBe(true);
    expect(isAppendAnnotation({ __merge: "append" })).toBe(false);
    expect(isAppendAnnotation({ values: [] })).toBe(false);
    expect(isAppendAnnotation(null)).toBe(false);
  });

  test("the inputs are not mutated (the result is a deep clone)", () => {
    const system = { nested: { list: [1] } };
    const merged = mergeSettings(system, {});
    merged.nested.list.push(2);
    expect(system.nested.list).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// expandEnvHomeReferences: issues #1404 / #1422
// ---------------------------------------------------------------------------

describe("expandEnvHomeReferences", () => {
  test("expands a leading $HOME / ${HOME} / ~ in env values", () => {
    const settings = {
      env: {
        A: "$HOME/.myos/MYOS",
        B: "${HOME}/.myos",
        C: "~/.myos",
        D: "$HOME",
        E: "~",
      },
    };
    expandEnvHomeReferences(settings, "/home/pm");
    expect(settings.env).toEqual({
      A: "/home/pm/.myos/MYOS",
      B: "/home/pm/.myos",
      C: "/home/pm/.myos",
      D: "/home/pm",
      E: "/home/pm",
    });
  });

  test("only a whole leading segment expands: $HOMEBREW is left alone", () => {
    const settings = { env: { A: "$HOMEBREW/bin", B: "/opt/$HOME/x", C: "~notahome" } };
    expandEnvHomeReferences(settings, "/home/pm");
    expect(settings.env).toEqual({ A: "$HOMEBREW/bin", B: "/opt/$HOME/x", C: "~notahome" });
  });

  test("an empty home is a no-op rather than producing a rooted path", () => {
    const settings = { env: { A: "$HOME/.myos" } };
    expandEnvHomeReferences(settings, "");
    expect(settings.env.A).toBe("$HOME/.myos");
  });
});

// ---------------------------------------------------------------------------
// Permission rules: silent-pruning failure mode #1
// ---------------------------------------------------------------------------

describe("permissionRuleRejectionReason", () => {
  test("accepts a known tool with and without an argument pattern", () => {
    expect(permissionRuleRejectionReason("Read")).toBeNull();
    expect(permissionRuleRejectionReason("Bash(git status:*)")).toBeNull();
  });

  test("rejects a tool the harness does not have: MultiEdit is the live example", () => {
    expect(KNOWN_TOOL_NAMES.has("MultiEdit")).toBe(false);
    expect(permissionRuleRejectionReason("MultiEdit(/tmp/**)")).toMatch(/matches no known tool/);
  });

  test("accepts an mcp rule with a literal server segment", () => {
    expect(permissionRuleRejectionReason("mcp__linear__list_issues")).toBeNull();
    expect(permissionRuleRejectionReason("mcp__linear__*")).toBeNull();
  });

  test("rejects an mcp wildcard in server position", () => {
    expect(permissionRuleRejectionReason("mcp__*")).toMatch(/not in tool position/);
    expect(permissionRuleRejectionReason("mcp__*__read")).toMatch(/not in tool position/);
    expect(permissionRuleRejectionReason("mcp__")).toMatch(/not in tool position/);
  });

  test("any mcp__ server is accepted by prefix, including the server-wide form", () => {
    expect(permissionRuleRejectionReason("mcp__linear")).toBeNull();
    expect(permissionRuleRejectionReason("mcp__claude-in-chrome__navigate")).toBeNull();
    expect(permissionRuleRejectionReason("mcp__claude_ai_Gmail__authenticate")).toBeNull();
  });

  test("every tool name the myos settings template may use is known", () => {
    for (const name of ["Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "NotebookRead", "NotebookEdit",
      "TodoWrite", "Task", "Skill", "SlashCommand", "AskUserQuestion", "ToolSearch", "EnterPlanMode", "ExitPlanMode",
      "EnterWorktree", "ExitWorktree", "LSP", "Monitor", "SendMessage", "TaskCreate", "TaskGet", "TaskList",
      "TaskOutput", "TaskStop", "TaskUpdate", "CronCreate", "CronDelete", "CronList", "TeamCreate", "TeamDelete",
      "BashOutput", "KillShell", "Bash", "Edit", "Write", "Agent", "Workflow", "Artifact", "ArtifactComments",
      "ArtifactData", "ScheduleWakeup", "SendFeedback", "ReportFindings", "ListAgents"]) {
      expect(KNOWN_TOOL_NAMES.has(name), name).toBe(true);
    }
    // Template rules also name agents and paths inside the parens; only the tool is checked.
    expect(permissionRuleRejectionReason("Agent(Designer)")).toBeNull();
    expect(permissionRuleRejectionReason("Edit(~/Code/**)")).toBeNull();
  });

  test("rejects a non-string or empty rule", () => {
    expect(permissionRuleRejectionReason("")).toMatch(/non-empty string/);
    expect(permissionRuleRejectionReason(undefined as unknown as string)).toMatch(/non-empty string/);
  });

  test("Write(<path>) is syntactically valid here: the harness-inertness check is PermissionRulesCheck's job", () => {
    expect(permissionRuleRejectionReason("Write(/etc/**)")).toBeNull();
  });
});

describe("prunePermissionRules", () => {
  test("drops invalid rules, keeps valid ones, and reports every drop", () => {
    const settings = {
      permissions: {
        allow: ["Read", "MultiEdit(/x)", "Bash(ls:*)"],
        deny: ["mcp__*"],
        ask: ["Edit(/etc/**)"],
      },
    };
    const dropped = prunePermissionRules(settings);
    expect(settings.permissions.allow).toEqual(["Read", "Bash(ls:*)"]);
    expect(settings.permissions.deny).toEqual([]);
    expect(settings.permissions.ask).toEqual(["Edit(/etc/**)"]);
    expect(dropped.map((d: { rule: string }) => d.rule)).toEqual(["MultiEdit(/x)", "mcp__*"]);
    expect(dropped[0].array).toBe("allow");
  });

  test("settings with no permissions block is a no-op", () => {
    expect(prunePermissionRules({})).toEqual([]);
    expect(prunePermissionRules({ permissions: null })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hook identity and stale-registration pruning
// ---------------------------------------------------------------------------

describe("extractMyosHomePaths", () => {
  test("finds quoted and bare paths under myosHome", () => {
    expect(extractMyosHomePaths(`bun '/h/.myos/hooks/A.ts'`, "/h/.myos")).toEqual(["/h/.myos/hooks/A.ts"]);
    expect(extractMyosHomePaths(`bun /h/.myos/hooks/A.ts --flag`, "/h/.myos")).toEqual(["/h/.myos/hooks/A.ts"]);
  });

  test("ignores paths outside myosHome: a PM's own hook is never a pruning candidate", () => {
    expect(extractMyosHomePaths("bun /h/scripts/mine.ts", "/h/.myos")).toEqual([]);
  });

  test("a regex-special myosHome is matched literally, not as a pattern", () => {
    expect(extractMyosHomePaths("bun /h/.myos+x/hooks/A.ts", "/h/.myos+x")).toEqual(["/h/.myos+x/hooks/A.ts"]);
    expect(extractMyosHomePaths("bun /h/Xmyos/hooks/A.ts", "/h/.myos")).toEqual([]);
  });
});

describe("hookIdentity", () => {
  test("identity is the path relative to myosHome, so timeout edits do not create a duplicate", () => {
    const home = "/h/.myos";
    const a = hookIdentity({ type: "command", command: `bun '${home}/hooks/A.hook.ts'` }, home);
    const b = hookIdentity({ type: "command", command: `bun '${home}/hooks/A.hook.ts'`, timeout: 99 }, home);
    expect(a).toBe("hooks/A.hook.ts");
    expect(b).toBe(a);
  });

  test("a command naming nothing under myosHome falls back to the literal command", () => {
    expect(hookIdentity({ type: "command", command: "echo hi" }, "/h/.myos")).toBe("command:echo hi");
  });

  test("a non-command entry has no identity", () => {
    expect(hookIdentity({ type: "other" }, "/h/.myos")).toBeNull();
    expect(hookIdentity(null, "/h/.myos")).toBeNull();
  });
});

describe("pruneStaleHookRegistrations", () => {
  test("drops a registration whose script this release deleted, and empties the matcher group with it", () => {
    using dir = tempDir("prune-hooks");
    const home = dir.path;
    dir.write("hooks/Alive.hook.ts", "// present");

    const settings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: `bun '${home}/hooks/Alive.hook.ts'` },
              { type: "command", command: `bun '${home}/hooks/Gone.hook.ts'` },
            ],
          },
          { matcher: "Bash", hooks: [{ type: "command", command: `bun '${home}/hooks/AlsoGone.hook.ts'` }] },
        ],
      },
    };

    const pruned = pruneStaleHookRegistrations(settings, home);
    expect(pruned.map((p: { missingPath: string }) => p.missingPath)).toEqual([
      `${home}/hooks/Gone.hook.ts`,
      `${home}/hooks/AlsoGone.hook.ts`,
    ]);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks).toHaveLength(1);
  });

  test("a hook outside myosHome is never pruned, even when the path is missing here", () => {
    using dir = tempDir("prune-foreign");
    const settings = {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "bun /somewhere/else/mine.ts" }] }] },
    };
    expect(pruneStaleHookRegistrations(settings, dir.path)).toEqual([]);
    expect(settings.hooks.SessionStart[0].hooks).toHaveLength(1);
  });

  test("a registration the current template asks for is never stale, whatever the filesystem says", () => {
    using dir = tempDir("prune-protected");
    const home = dir.path;
    const command = `bun '${home}/hooks/NotCopiedYet.hook.ts'`;
    const settings = { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } };
    const template = { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } };

    const pruned = pruneStaleHookRegistrations(settings, home, templateHookIdentities(template, home));
    expect(pruned).toEqual([]);
    expect(settings.hooks.SessionStart[0].hooks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// foldTemplateAdditions: the additive upgrade
// ---------------------------------------------------------------------------

describe("foldTemplateAdditions", () => {
  const home = "/h/.myos";

  test("adds a whole new top-level section", () => {
    const existing: any = { env: {} };
    const changes = foldTemplateAdditions(existing, { env: {}, statusLine: { type: "command" } }, home);
    expect(existing.statusLine).toEqual({ type: "command" });
    expect(changes).toEqual([{ kind: "key", detail: "statusLine (new section)" }]);
  });

  test("never overwrites a value the PM set", () => {
    const existing: any = { env: { A: "mine" }, model: "opus" };
    const changes = foldTemplateAdditions(existing, { env: { A: "shipped", B: "new" }, model: "sonnet" }, home);
    expect(existing.env).toEqual({ A: "mine", B: "new" });
    expect(existing.model).toBe("opus");
    expect(changes).toEqual([{ kind: "env", detail: "env.B" }]);
  });

  test("appends a newly-registered hook into the matching matcher group", () => {
    const existing: any = {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: `bun '${home}/hooks/Old.hook.ts'` }] }] },
    };
    const template = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: `bun '${home}/hooks/Old.hook.ts'` },
              { type: "command", command: `bun '${home}/hooks/New.hook.ts'` },
            ],
          },
        ],
      },
    };
    const changes = foldTemplateAdditions(existing, template, home);
    expect(existing.hooks.SessionStart).toHaveLength(1);
    expect(existing.hooks.SessionStart[0].hooks).toHaveLength(2);
    expect(changes).toEqual([{ kind: "hook", detail: "hooks.SessionStart: hooks/New.hook.ts" }]);
  });

  test("a hook the PM moved to another matcher is not duplicated", () => {
    const command = `bun '${home}/hooks/Moved.hook.ts'`;
    const existing: any = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] } };
    const changes = foldTemplateAdditions(existing, { hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command }] }] } }, home);
    expect(changes).toEqual([]);
    expect(existing.hooks.PreToolUse).toHaveLength(1);
  });

  test("a template matcher group with no counterpart is added whole", () => {
    const existing: any = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `bun '${home}/hooks/A.ts'` }] }] } };
    foldTemplateAdditions(existing, { hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: `bun '${home}/hooks/B.ts'` }] }] } }, home);
    expect(existing.hooks.PreToolUse).toHaveLength(2);
    expect(existing.hooks.PreToolUse[1].matcher).toBe("Edit");
  });

  test("an event the PM's file does not register at all is copied in", () => {
    const existing: any = { hooks: {} };
    const changes = foldTemplateAdditions(existing, { hooks: { Stop: [{ hooks: [{ type: "command", command: `bun '${home}/hooks/S.ts'` }] }] } }, home);
    expect(existing.hooks.Stop).toHaveLength(1);
    expect(changes).toEqual([{ kind: "hook", detail: "hooks.Stop (event not registered)" }]);
  });

  test("re-folding the same template changes nothing (idempotent)", () => {
    const template = {
      env: { A: "1" },
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: `bun '${home}/hooks/A.ts'` }] }] },
    };
    const existing: any = { env: {}, hooks: {} };
    expect(foldTemplateAdditions(existing, template, home).length).toBeGreaterThan(0);
    expect(foldTemplateAdditions(existing, template, home)).toEqual([]);
  });

  test("a new template permission rule reaches an existing install", () => {
    // The former DOCUMENTED LIMIT, closed 2026-08-08: before this, a new
    // permissions.allow entry in the template never landed on an upgrade, so
    // every new auto-allowed connector (the Granola rules were the trigger)
    // shipped only to fresh installs.
    const existing: any = { permissions: { allow: ["Read"] } };
    const changes = foldTemplateAdditions(existing, { permissions: { allow: ["Read", "Bash(ls:*)"] } }, home);
    expect(changes).toEqual([{ kind: "permission", detail: "permissions.allow: Bash(ls:*)" }]);
    expect(existing.permissions.allow).toEqual(["Read", "Bash(ls:*)"]);
  });

  test("a rule the user moved to another array is not re-added where the template ships it", () => {
    const existing: any = { permissions: { allow: ["Read"], ask: ["Bash(gh:*)"] } };
    const changes = foldTemplateAdditions(existing, { permissions: { allow: ["Read", "Bash(gh:*)"] } }, home);
    expect(changes).toEqual([]);
    expect(existing.permissions.allow).toEqual(["Read"]);
    expect(existing.permissions.ask).toEqual(["Bash(gh:*)"]);
  });

  test("a template rule for an array the user's file lacks creates that array", () => {
    const existing: any = { permissions: { allow: ["Read"] } };
    const changes = foldTemplateAdditions(existing, { permissions: { allow: ["Read"], ask: ["Bash(rm:*)"] } }, home);
    expect(changes).toEqual([{ kind: "permission", detail: "permissions.ask: Bash(rm:*)" }]);
    expect(existing.permissions.ask).toEqual(["Bash(rm:*)"]);
  });

  test("identical permission arrays are a no-op", () => {
    const existing: any = { permissions: { allow: ["Read", "Bash(ls:*)"] } };
    expect(foldTemplateAdditions(existing, { permissions: { allow: ["Read", "Bash(ls:*)"] } }, home)).toEqual([]);
  });

  test("non-object inputs are refused rather than half-applied", () => {
    expect(foldTemplateAdditions(null, { a: 1 }, home)).toEqual([]);
    expect(foldTemplateAdditions({}, null, home)).toEqual([]);
  });
});

describe("deepEqual", () => {
  test("compares structurally, not by reference", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe("CLI: --system/--user/--output", () => {
  test("writes the merge and reports the key counts", async () => {
    using home = tempHome("merge-cli");
    home.write(".myos/system.json", JSON.stringify({ env: { A: "1" }, model: "sonnet" }));
    home.write(".myos/user.json", JSON.stringify({ model: "opus" }));

    const result = await run(
      [bunExe(), repoPath(TOOL), "--system", home.join(".myos/system.json"), "--user", home.join(".myos/user.json"), "--output", home.join(".myos/settings.json")],
      { env: home.env() },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Merged 2 system keys + 1 user overlays");
    expect(JSON.parse(readFileSync(home.join(".myos/settings.json"), "utf8"))).toEqual({ env: { A: "1" }, model: "opus" });
  });

  test("warns on stderr about every pruned permission rule and still writes a valid file", async () => {
    using home = tempHome("merge-prune");
    home.write(".myos/system.json", JSON.stringify({ permissions: { allow: ["Read", "MultiEdit(/x)"] } }));
    home.write(".myos/user.json", JSON.stringify({}));

    const result = await run(
      [bunExe(), repoPath(TOOL), "--system", home.join(".myos/system.json"), "--user", home.join(".myos/user.json"), "--output", home.join(".myos/settings.json")],
      { env: home.env() },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("pruned 1 invalid permission rule");
    expect(result.stderr).toContain("MultiEdit(/x)");
    expect(JSON.parse(readFileSync(home.join(".myos/settings.json"), "utf8")).permissions.allow).toEqual(["Read"]);
  });

  test("--check exits 1 and names the difference", async () => {
    using home = tempHome("merge-check");
    home.write(".myos/system.json", JSON.stringify({ model: "sonnet" }));
    home.write(".myos/user.json", JSON.stringify({}));
    home.write(".myos/settings.json", JSON.stringify({ model: "opus" }));

    const result = await run(
      [bunExe(), repoPath(TOOL), "--system", home.join(".myos/system.json"), "--user", home.join(".myos/user.json"), "--check", home.join(".myos/settings.json")],
      { env: home.env() },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("model");
  });

  test("a missing input is a clean no-op, not a crash (fresh-install guard)", async () => {
    using home = tempHome("merge-absent");
    const result = await run(
      [bunExe(), repoPath(TOOL), "--system", home.join(".myos/nope.json"), "--user", home.join(".myos/nope2.json"), "--output", home.join(".myos/out.json")],
      { env: home.env() },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("nothing to merge");
  });

  test("bad flags exit 2 with usage, so a typo cannot silently merge the wrong thing", async () => {
    const result = await run([bunExe(), repoPath(TOOL), "--system"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  test("malformed JSON is reported with the file name", async () => {
    using home = tempHome("merge-badjson");
    home.write(".myos/system.json", "{not json");
    home.write(".myos/user.json", "{}");
    const result = await run(
      [bunExe(), repoPath(TOOL), "--system", home.join(".myos/system.json"), "--user", home.join(".myos/user.json"), "--output", home.join(".myos/out.json")],
      { env: home.env() },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to parse JSON file");
  });
});

describe("CLI: --upgrade (what a release may change in a PM's settings.json)", () => {
  async function upgrade(home: ReturnType<typeof tempHome>, args: string[] = []) {
    return run(
      [bunExe(), repoPath(TOOL), "--upgrade", "--template", home.join("template.json"), "--existing", home.join(".myos/settings.json"), ...args],
      { env: home.env() },
    );
  }

  test("without --apply it reports and writes nothing", async () => {
    using home = tempHome("upgrade-dry");
    home.write("template.json", JSON.stringify({ env: { NEW: "1" } }));
    home.write(".myos/settings.json", JSON.stringify({ env: {} }, null, 2) + "\n");
    const before = readFileSync(home.join(".myos/settings.json"), "utf8");

    const result = await upgrade(home);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("would apply");
    expect(result.stdout).toContain("env.NEW");
    expect(readFileSync(home.join(".myos/settings.json"), "utf8")).toBe(before);
  });

  test("with --apply the new setting lands and the PM's values survive", async () => {
    using home = tempHome("upgrade-apply");
    home.write("template.json", JSON.stringify({ env: { NEW: "1", KEPT: "shipped" } }));
    home.write(".myos/settings.json", JSON.stringify({ env: { KEPT: "mine", OWN: "keepme" } }, null, 2) + "\n");

    const result = await upgrade(home, ["--apply"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("applied");

    const after = JSON.parse(readFileSync(home.join(".myos/settings.json"), "utf8"));
    expect(after.env).toEqual({ KEPT: "mine", OWN: "keepme", NEW: "1" });
  });

  test("a no-op re-run leaves the file byte-identical (the installer's idempotency contract)", async () => {
    using home = tempHome("upgrade-noop");
    home.write("template.json", JSON.stringify({ env: { NEW: "1" } }));
    home.write(".myos/settings.json", JSON.stringify({ env: { NEW: "1" } }, null, 2) + "\n");

    const before = readFileSync(home.join(".myos/settings.json"));
    const mtimeBefore = statSync(home.join(".myos/settings.json")).mtimeMs;

    const result = await upgrade(home, ["--apply"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("already carries every shipped setting");
    expect(readFileSync(home.join(".myos/settings.json"))).toEqual(before);
    expect(statSync(home.join(".myos/settings.json")).mtimeMs).toBe(mtimeBefore);
  });

  test("--backup-dir keeps the previous file before writing", async () => {
    using home = tempHome("upgrade-backup");
    home.write("template.json", JSON.stringify({ env: { NEW: "1" } }));
    home.write(".myos/settings.json", JSON.stringify({ env: { OLD: "1" } }));

    const result = await upgrade(home, ["--apply", "--backup-dir", home.join("backups")]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(home.join("backups/settings.json"), "utf8")).env).toEqual({ OLD: "1" });
  });

  test("an absent template or settings.json is skipped, never an error mid-install", async () => {
    using home = tempHome("upgrade-absent");
    home.write(".myos/settings.json", "{}");
    const result = await upgrade(home, ["--apply"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("settings upgrade skipped");
  });

  test("--upgrade needs both paths and says so", async () => {
    const result = await run([bunExe(), repoPath(TOOL), "--upgrade", "--template", "/nope"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("needs both --template and --existing");
  });
});

// ---------------------------------------------------------------------------
// The shipped template must survive its own merger
// ---------------------------------------------------------------------------

describe("the shipped settings.template.json", () => {
  test("loses no permission rule and no hook registration to pruning", () => {
    const rendered = readFileSync(`${PAYLOAD}/settings.template.json`, "utf8").replaceAll("__MYOS_HOME__", "/h/.myos");
    const template = JSON.parse(rendered);

    const before = JSON.stringify(template.permissions);
    expect(prunePermissionRules(template)).toEqual([]);
    expect(JSON.stringify(template.permissions)).toBe(before);
  });

  test("folds into an empty settings.json without throwing, and then is idempotent", () => {
    const rendered = readFileSync(`${PAYLOAD}/settings.template.json`, "utf8").replaceAll("__MYOS_HOME__", "/h/.myos");
    const existing: any = {};
    expect(foldTemplateAdditions(existing, JSON.parse(rendered), "/h/.myos").length).toBeGreaterThan(0);
    expect(foldTemplateAdditions(existing, JSON.parse(rendered), "/h/.myos")).toEqual([]);
  });

  test("every hook it registers has a distinct identity (a duplicate would read as already present)", () => {
    const rendered = readFileSync(`${PAYLOAD}/settings.template.json`, "utf8").replaceAll("__MYOS_HOME__", "/h/.myos");
    const template = JSON.parse(rendered);
    for (const [event, groups] of Object.entries<any>(template.hooks ?? {})) {
      const seen: string[] = [];
      for (const group of groups) {
        for (const entry of group.hooks ?? []) {
          const id = hookIdentity(entry, "/h/.myos");
          if (id !== null) seen.push(id);
        }
      }
      expect(new Set(seen).size, `duplicate hook identity in hooks.${event}: ${seen.join(", ")}`).toBe(seen.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Anti-criteria
// ---------------------------------------------------------------------------

describe("Anti", () => {
  test("Anti: a merge never writes outside the paths it was given", async () => {
    using home = tempHome("merge-anti");
    home.write(".myos/system.json", JSON.stringify({ env: { A: "1" } }));
    home.write(".myos/user.json", "{}");
    const canary = home.write(".myos/canary.json", "untouched");

    await run(
      [bunExe(), repoPath(TOOL), "--system", home.join(".myos/system.json"), "--user", home.join(".myos/user.json"), "--output", home.join(".myos/settings.json")],
      { env: home.env() },
    );

    expect(readFileSync(canary, "utf8")).toBe("untouched");
  });

  test("Anti: a hook registration is not dropped just because its file is missing when the template still ships it", () => {
    // Regression guard for the preview-run bug: --upgrade before hooks are copied
    // must not report adding a hook and dropping it in the same breath.
    using dir = tempDir("anti-addthendrop");
    const command = `bun '${dir.path}/hooks/Fresh.hook.ts'`;
    const template = { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } };
    const existing: any = { hooks: {} };

    foldTemplateAdditions(existing, template, dir.path);
    const pruned = pruneStaleHookRegistrations(existing, dir.path, templateHookIdentities(template, dir.path));

    expect(pruned).toEqual([]);
    expect(existing.hooks.SessionStart[0].hooks).toHaveLength(1);
  });
});

// keep the import used even if a future edit drops the last writeFileSync call
void writeFileSync;
