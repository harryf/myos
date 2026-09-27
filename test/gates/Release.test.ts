/**
 * Release.ts: the one-command release runner.
 *
 * The side-effectful half (git, gh, pushes, polling) is deliberately not
 * exercised here: these tests cover every pure decision the tool makes
 * (version bumping, changelog re-heading, section extraction, arg parsing)
 * plus the CLI's refusal modes, all of which run before it touches git.
 */

import { describe, expect, test } from "bun:test";

import {
  bumpVersion,
  extractSection,
  localDate,
  parseArgs,
  retitleUnreleased,
} from "../../Tools/Release.ts";
import { bunExe, repoPath, run } from "../harness.ts";

const TOOL = "Tools/Release.ts";

const CHANGELOG = `# Changelog

## Unreleased

### A thing

- did the thing

## 0.2.7 (2026-07-30)

- older notes
`;

describe("bumpVersion", () => {
  test("patch, minor, major", () => {
    expect(bumpVersion("0.2.7", "patch")).toBe("0.2.8");
    expect(bumpVersion("0.2.7", "minor")).toBe("0.3.0");
    expect(bumpVersion("0.2.7", "major")).toBe("1.0.0");
  });

  test("explicit version must be greater than current", () => {
    expect(bumpVersion("0.2.7", "0.4.0")).toBe("0.4.0");
    expect(bumpVersion("0.2.7", "1.0.0")).toBe("1.0.0");
    expect(() => bumpVersion("0.2.7", "0.2.7")).toThrow("not greater");
    expect(() => bumpVersion("0.2.7", "0.2.6")).toThrow("not greater");
    expect(() => bumpVersion("0.10.0", "0.9.9")).toThrow("not greater");
  });

  test("rejects a malformed VERSION or bump", () => {
    expect(() => bumpVersion("v0.2.7", "patch")).toThrow("not X.Y.Z");
    expect(() => bumpVersion("0.2.7", "banana")).toThrow("patch|minor|major");
    expect(() => bumpVersion("0.2.7", "1.2")).toThrow("patch|minor|major");
  });
});

describe("retitleUnreleased", () => {
  test("re-heads Unreleased to the dated version heading, touching nothing else", () => {
    const out = retitleUnreleased(CHANGELOG, "0.2.8", "2026-08-01");
    expect(out).toContain("## 0.2.8 (2026-08-01)");
    expect(out).not.toContain("## Unreleased");
    expect(out.replace("## 0.2.8 (2026-08-01)", "## Unreleased")).toBe(CHANGELOG);
  });

  test("refuses when the section is missing, empty, duplicated, or already released", () => {
    expect(() => retitleUnreleased("# Changelog\n\n## 0.2.7 (x)\n- a\n", "0.2.8", "d")).toThrow('no "## Unreleased"');
    expect(() => retitleUnreleased("# Changelog\n\n## Unreleased\n\n## 0.2.7 (x)\n- a\n", "0.2.8", "d")).toThrow("empty");
    expect(() => retitleUnreleased("## Unreleased\n- a\n\n## Unreleased\n- b\n", "0.2.8", "d")).toThrow("more than one");
    expect(() => retitleUnreleased(CHANGELOG, "0.2.7", "d")).toThrow("already");
  });
});

describe("extractSection", () => {
  test("returns the lines of one section only", () => {
    expect(extractSection(CHANGELOG, "Unreleased")).toBe("### A thing\n\n- did the thing");
    expect(extractSection(CHANGELOG, "0.2.7")).toBe("- older notes");
    expect(extractSection(CHANGELOG, "9.9.9")).toBe("");
  });
});

describe("localDate", () => {
  test("formats YYYY-MM-DD with zero padding", () => {
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("parseArgs", () => {
  test("bump argument plus flags", () => {
    expect(parseArgs(["patch"])).toEqual({ bump: "patch", dryRun: false, fast: false });
    expect(parseArgs(["1.0.0", "--dry-run", "--fast"])).toEqual({ bump: "1.0.0", dryRun: true, fast: true });
    expect(parseArgs(["--help"])).toEqual({ help: true });
  });

  test("refusal modes", () => {
    expect(parseArgs([])).toHaveProperty("error");
    expect(parseArgs(["banana"])).toHaveProperty("error");
    expect(parseArgs(["patch", "minor"])).toHaveProperty("error");
    expect(parseArgs(["patch", "--frobnicate"])).toHaveProperty("error");
  });
});

describe("CLI", () => {
  test("--help exits 0 with usage", async () => {
    const result = await run([bunExe(), repoPath(TOOL), "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage:");
  });

  test("Anti: a bad bump argument exits 1 before touching git or gh", async () => {
    for (const args of [[], ["banana"], ["patch", "--frobnicate"]]) {
      const result = await run([bunExe(), repoPath(TOOL), ...args]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).not.toContain("preflight");
    }
  });
});
