/**
 * PermissionRulesCheck catches two failure modes that are invisible at review
 * time: a rule the installer silently prunes, and an inert `Write(<path>)` rule
 * that reads as protection and provides none. It takes a template path precisely
 * so it can be run against deliberately-broken fixtures, which is what this does.
 */

import { describe, expect, test } from "bun:test";

import { bunExe, repoPath, run, tempDir } from "../harness.ts";

const TOOL = "Tools/PermissionRulesCheck.ts";

async function checkTemplate(settings: unknown) {
  using dir = tempDir("permission-rules");
  const file = dir.write("settings.template.json", JSON.stringify(settings, null, 2));
  // `await` before the enclosing `using` disposes the dir: returning the promise
  // would delete the fixture out from under the subprocess.
  return await run([bunExe(), repoPath(TOOL), file]);
}

describe("the shipped template", () => {
  test("passes, and the count it reports is non-zero", async () => {
    const result = await run([bunExe(), repoPath(TOOL)]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/✅ PermissionRulesCheck: \d+ permission rules valid, defaultMode=auto\./);
    const count = Number(result.stdout.match(/: (\d+) permission rules/)?.[1]);
    expect(count).toBeGreaterThan(0);
  });
});

describe("blocking", () => {
  test("a rule naming an unknown tool is blocked with the installer's reason", async () => {
    const result = await checkTemplate({ permissions: { defaultMode: "auto", allow: ["MultiEdit(/tmp/**)"] } });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("BAD RULE permissions.allow: MultiEdit(/tmp/**)");
    expect(result.stderr).toContain("MergeSettings would silently drop this at install");
  });

  test("an inert Write(<path>) rule is blocked and the Edit() replacement is spelled out", async () => {
    const result = await checkTemplate({ permissions: { defaultMode: "auto", deny: ["Write(/etc/**)"] } });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the harness ignores Write(<path>)");
    expect(result.stderr).toContain("use Edit(/etc/**) instead");
  });

  test("an mcp wildcard in server position is blocked", async () => {
    const result = await checkTemplate({ permissions: { defaultMode: "auto", allow: ["mcp__*"] } });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not in tool position");
  });

  test("a non-string rule is blocked", async () => {
    const result = await checkTemplate({ permissions: { defaultMode: "auto", allow: [42] } });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a non-empty string");
  });

  test("a missing permissions block is blocked, naming the 0.1.0–0.2.1 regression", async () => {
    const result = await checkTemplate({ env: {} });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no `permissions` block");
  });

  test("defaultMode other than auto is blocked: prefix rules cannot express compound commands", async () => {
    const result = await checkTemplate({ permissions: { defaultMode: "acceptEdits", allow: ["Read"] } });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expected \"auto\"");
  });

  test("every bad rule is counted, not just the first", async () => {
    const result = await checkTemplate({
      permissions: { defaultMode: "auto", allow: ["MultiEdit(/x)", "Write(/y)"], deny: ["mcp__*"] },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("3 bad permission rule(s)");
  });
});

describe("passing", () => {
  test("valid rules across all three arrays pass", async () => {
    const result = await checkTemplate({
      permissions: {
        defaultMode: "auto",
        allow: ["Read", "Bash(git status:*)", "mcp__linear__list_issues", "mcp__notion__*"],
        ask: ["Bash(git push:*)"],
        deny: ["Edit(/etc/**)"],
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("6 permission rules valid");
  });

  test("an array the template omits is not an error", async () => {
    const result = await checkTemplate({ permissions: { defaultMode: "auto", allow: ["Read"] } });
    expect(result.exitCode).toBe(0);
  });
});
