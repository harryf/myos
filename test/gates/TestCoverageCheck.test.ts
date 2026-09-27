/**
 * The parity gate needs the same treatment it gives everything else: watched
 * failing, not just watched passing. It resolves the repo from its own location,
 * so each case copies it into a fake repo with a hand-written corpus.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { bunExe, repoPath, run, tempDir } from "../harness.ts";

const TOOL = "Tools/TestCoverageCheck.ts";
const SOURCE = readFileSync(repoPath(TOOL), "utf8");

/** The corpus module's shape, minus the rows, so a fixture can supply its own. */
const CORPUS_TAIL = `
export const TOOL_SURFACE = {
  dirs: [
    { dir: "Tools", pattern: /\\.ts$/ },
    { dir: "payload/MYOS/TOOLS", pattern: /\\.ts$/ },
    { dir: "payload/hooks", pattern: /\\.hook\\.(ts|sh)$/ },
  ],
  skillTools: "payload/skills",
  extras: ["payload/MYOS/statusline.ts"],
};
export function corpusBySource() { return new Map(CORPUS.map((r) => [r.source, r])); }
export function rowsRequiringTests() { return CORPUS.filter((r) => r.kind !== "exempt"); }
`;

function fixture(name: string, rows: unknown[], files: Record<string, string> = {}) {
  return tempDir(`coverage-${name}`, {
    "Tools/TestCoverageCheck.ts": SOURCE,
    "test/corpus.ts": `export const CORPUS = ${JSON.stringify(rows, null, 2)};\n${CORPUS_TAIL}`,
    ...files,
  });
}

async function runFixture(dir: { path: string }) {
  return await run([bunExe(), `${dir.path}/Tools/TestCoverageCheck.ts`], { cwd: dir.path });
}

describe("the real repo", () => {
  test("is in parity, and the summary counts every kind", async () => {
    const result = await run([bunExe(), repoPath(TOOL)]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/✅ TestCoverageCheck: \d+ scripts, \d+ rows in parity/);
    expect(result.stdout).toMatch(/static \d+, gated \d+, llm \d+, exempt \d+/);
  });
});

describe("blocking", () => {
  test("a tool with no corpus row blocks the release", async () => {
    using dir = fixture("no-row", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/gates/TestCoverageCheck.test.ts", kind: "static" },
    ], {
      "payload/MYOS/TOOLS/Newcomer.ts": "// just landed\n",
      "test/gates/TestCoverageCheck.test.ts": "",
    });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("NO TEST ROW: payload/MYOS/TOOLS/Newcomer.ts");
  });

  test("a row pointing at a deleted tool blocks the release", async () => {
    using dir = fixture("stale-row", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/gates/TestCoverageCheck.test.ts", kind: "static" },
      { source: "payload/MYOS/TOOLS/Gone.ts", test: "test/tools/Gone.test.ts", kind: "static" },
    ], { "test/gates/TestCoverageCheck.test.ts": "", "test/tools/Gone.test.ts": "" });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("STALE ROW: test/corpus.ts lists payload/MYOS/TOOLS/Gone.ts");
  });

  test("a row naming a test file that does not exist blocks the release", async () => {
    using dir = fixture("missing-test", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/tools/Nope.test.ts", kind: "static" },
    ]);
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("MISSING TEST");
  });

  test("an exempt row with no reason blocks the release", async () => {
    using dir = fixture("exempt-no-note", [
      { source: "Tools/TestCoverageCheck.ts", kind: "exempt" },
    ]);
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("exempt with no note");
  });

  test("an llm row with no note blocks the release, so 'it calls a model' is never a blanket excuse", async () => {
    using dir = fixture("llm-no-note", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/x.test.ts", kind: "llm" },
    ], { "test/x.test.ts": "" });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("kind=llm with no note");
  });

  test("an unrecognised `needs` token blocks the release", async () => {
    using dir = fixture("bad-need", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/x.test.ts", kind: "gated", needs: ["ffmpeg"], note: "n" },
    ], { "test/x.test.ts": "" });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unrecognised need");
  });

  test("a test file no row points at blocks the release", async () => {
    using dir = fixture("orphan", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/x.test.ts", kind: "static" },
    ], { "test/x.test.ts": "", "test/tools/Orphan.test.ts": "" });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ORPHAN TEST: test/tools/Orphan.test.ts");
  });

  test("an exempt row that also names a test blocks the release", async () => {
    using dir = fixture("exempt-with-test", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/x.test.ts", kind: "exempt", note: "n" },
    ], { "test/x.test.ts": "" });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("exempt but names a test file");
  });

  test("every problem is reported, not just the first", async () => {
    using dir = fixture("many", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/nope1.test.ts", kind: "static" },
      { source: "payload/MYOS/TOOLS/Gone.ts", test: "test/nope2.test.ts", kind: "static" },
    ]);
    const result = await runFixture(dir);
    expect(result.stderr).toMatch(/❌ [3-9] tool\/test parity problem\(s\)/);
  });
});

describe("discovery", () => {
  test("skill tools are found under payload/skills/<Skill>/Tools", async () => {
    using dir = fixture("skill-discovery", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/x.test.ts", kind: "static" },
    ], { "test/x.test.ts": "", "payload/skills/Writing/Tools/StyleCheck.ts": "// tool\n" });
    const result = await runFixture(dir);
    expect(result.stderr).toContain("NO TEST ROW: payload/skills/Writing/Tools/StyleCheck.ts");
  });

  test("a skill with no Tools dir is not a problem", async () => {
    using dir = fixture("skill-no-tools", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/x.test.ts", kind: "static" },
    ], { "test/x.test.ts": "", "payload/skills/Council/SKILL.md": "# skill\n" });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
  });

  test("hooks are on the surface: a hook with no row blocks; its lib/ files do not", async () => {
    using dir = fixture("hook-discovery", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/x.test.ts", kind: "static" },
    ], {
      "test/x.test.ts": "",
      "payload/hooks/Fresh.hook.ts": "// just landed\n",
      "payload/hooks/Shell.hook.sh": "#!/bin/bash\n",
      "payload/hooks/lib/paths.ts": "// shared, covered through its hooks\n",
    });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("NO TEST ROW: payload/hooks/Fresh.hook.ts");
    expect(result.stderr).toContain("NO TEST ROW: payload/hooks/Shell.hook.sh");
    expect(result.stderr).not.toContain("lib/paths.ts");
  });

  test("statusline.ts counts as a tool even though it lives outside a Tools dir", async () => {
    using dir = fixture("extras", [
      { source: "Tools/TestCoverageCheck.ts", test: "test/x.test.ts", kind: "static" },
    ], { "test/x.test.ts": "", "payload/MYOS/statusline.ts": "// statusline\n" });
    const result = await runFixture(dir);
    expect(result.stderr).toContain("NO TEST ROW: payload/MYOS/statusline.ts");
  });
});

describe("the corpus itself", () => {
  test("every gated and installed-dependent row states what it needs", async () => {
    const { CORPUS } = await import("../corpus.ts");
    for (const row of CORPUS) {
      if (row.kind !== "gated") continue;
      expect(row.needs, `${row.source} is gated with no needs`).toBeDefined();
      expect(row.needs!.length, `${row.source} is gated with an empty needs list`).toBeGreaterThan(0);
    }
  });

  test("no source is listed twice", async () => {
    const { CORPUS } = await import("../corpus.ts");
    const sources = CORPUS.map((r) => r.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  test("no test path is claimed by two rows", async () => {
    const { CORPUS } = await import("../corpus.ts");
    const tests = CORPUS.map((r) => r.test).filter(Boolean) as string[];
    expect(new Set(tests).size).toBe(tests.length);
  });

  test("each test path mirrors its source path", async () => {
    const { CORPUS } = await import("../corpus.ts");
    for (const row of CORPUS) {
      // Only scripts mirror; a doc row (payload/CLAUDE.md) names the doctrine test.
      if (!row.test || !/\.(ts|sh)$/.test(row.source)) continue;
      // .sh strips too: ContextReduction.hook.sh → ContextReduction.hook.test.ts.
      const base = row.source.split("/").pop()!.replace(/\.(ts|sh)$/, "");
      expect(row.test, `${row.source} → ${row.test} does not mirror the source name`).toContain(`${base}.test.ts`);
    }
  });
});
