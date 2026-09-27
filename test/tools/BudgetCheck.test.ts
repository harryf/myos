/**
 * BudgetCheck is backpressure against always-on context regrowing. Two things
 * need pinning: the arithmetic and exit codes (which decide whether a push is
 * refused), and the shipped budgets themselves: a release whose CLAUDE.md has
 * quietly gone over its ceiling costs every PM those bytes on every turn.
 *
 * The tool resolves its own root from `import.meta.url`, so fixture runs copy it
 * into a scratch tree laid out the same way.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { PAYLOAD, bunExe, repoPath, run, tempDir } from "../harness.ts";

const TOOL = "payload/MYOS/TOOLS/BudgetCheck.ts";
const SOURCE = readFileSync(repoPath(TOOL), "utf8");

interface Budget {
  path: string;
  maxBytes: number;
  note?: string;
}

/** A scratch install root with the tool at MYOS/TOOLS/ and the files it measures. */
function fixture(name: string, config: { totalMaxBytes?: number | null; budgets: Budget[] }, files: Record<string, string> = {}) {
  return tempDir(`budget-${name}`, {
    "MYOS/TOOLS/BudgetCheck.ts": SOURCE,
    "MYOS/TOOLS/context-budgets.json": JSON.stringify(config),
    ...files,
  });
}

async function runFixture(dir: { path: string }, args: string[] = []) {
  return await run([bunExe(), `${dir.path}/MYOS/TOOLS/BudgetCheck.ts`, ...args], { cwd: dir.path });
}

describe("verdicts", () => {
  test("under budget exits 0 and ticks every row", async () => {
    using dir = fixture("under", { budgets: [{ path: "CLAUDE.md", maxBytes: 100 }] }, { "CLAUDE.md": "x".repeat(50) });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("✅");
    expect(result.stdout).toContain("50 /    100 B   50%  CLAUDE.md");
  });

  test("over budget exits 1 and says how many bytes over", async () => {
    using dir = fixture("over", { budgets: [{ path: "CLAUDE.md", maxBytes: 100 }] }, { "CLAUDE.md": "x".repeat(130) });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("1 file(s) OVER budget");
    expect(result.stdout).toContain("CLAUDE.md: 30 B over");
  });

  test("exactly at the budget is not over: the ceiling is inclusive", async () => {
    using dir = fixture("exact", { budgets: [{ path: "CLAUDE.md", maxBytes: 100 }] }, { "CLAUDE.md": "x".repeat(100) });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
  });

  test("a file listed but absent reports MISSING and does not fail the check", async () => {
    using dir = fixture("missing", { budgets: [{ path: "Gone.md", maxBytes: 100 }] });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("MISSING");
    expect(result.stdout).toContain("Gone.md");
  });

  test("the total hard cap fails even when every single file is under its own budget", async () => {
    using dir = fixture(
      "total",
      { totalMaxBytes: 100, budgets: [{ path: "A.md", maxBytes: 100 }, { path: "B.md", maxBytes: 100 }] },
      { "A.md": "x".repeat(60), "B.md": "x".repeat(60) },
    );
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("TOTAL over hard cap");
    expect(result.stdout).toContain("120 > 100 B");
    expect(result.stdout).not.toContain("OVER budget");
  });

  test("no total cap means the sum is reported but never fails", async () => {
    using dir = fixture("nototal", { totalMaxBytes: null, budgets: [{ path: "A.md", maxBytes: 100 }] }, { "A.md": "x".repeat(50) });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("total: 50");
    expect(result.stdout).not.toContain("hard cap");
  });

  test("rows are ordered worst-first, so the file to prune is the first one read", async () => {
    using dir = fixture(
      "order",
      { budgets: [{ path: "Low.md", maxBytes: 1000 }, { path: "High.md", maxBytes: 100 }] },
      { "Low.md": "x".repeat(100), "High.md": "x".repeat(90) },
    );
    const result = await runFixture(dir);
    expect(result.stdout.indexOf("High.md")).toBeLessThan(result.stdout.indexOf("Low.md"));
  });

  test("a file over 90% is warned about before it is over", async () => {
    using dir = fixture("warn", { budgets: [{ path: "A.md", maxBytes: 100 }] }, { "A.md": "x".repeat(95) });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("⚠️");
  });
});

describe("output modes", () => {
  test("--json reports ok, totals and every row", async () => {
    using dir = fixture("json", { totalMaxBytes: 1000, budgets: [{ path: "A.md", maxBytes: 100, note: "why" }] }, { "A.md": "x".repeat(50) });
    const result = await runFixture(dir, ["--json"]);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.totalBytes).toBe(50);
    expect(report.totalBudget).toBe(100);
    expect(report.totalMaxBytes).toBe(1000);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ path: "A.md", maxBytes: 100, bytes: 50, over: false, note: "why" });
  });

  test("--json still exits 1 when over budget", async () => {
    using dir = fixture("json-over", { budgets: [{ path: "A.md", maxBytes: 10 }] }, { "A.md": "x".repeat(50) });
    const result = await runFixture(dir, ["--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).ok).toBe(false);
  });

  test("--quiet prints nothing while everything is under budget", async () => {
    using dir = fixture("quiet-ok", { budgets: [{ path: "A.md", maxBytes: 100 }] }, { "A.md": "x".repeat(50) });
    const result = await runFixture(dir, ["--quiet"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  test("--quiet speaks up as soon as a file is over", async () => {
    using dir = fixture("quiet-over", { budgets: [{ path: "A.md", maxBytes: 10 }] }, { "A.md": "x".repeat(50) });
    const result = await runFixture(dir, ["--quiet"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("OVER budget");
  });

  test("--cache writes the statusline summary and keeps the exit code", async () => {
    using dir = fixture("cache", { totalMaxBytes: 1000, budgets: [{ path: "A.md", maxBytes: 100 }] }, {
      "A.md": "x".repeat(95),
      "MYOS/MEMORY/STATE/.keep": "",
    });
    const result = await runFixture(dir, ["--cache"]);
    expect(result.exitCode).toBe(0);

    const cache = JSON.parse(readFileSync(`${dir.path}/MYOS/MEMORY/STATE/context-budget.json`, "utf8"));
    expect(cache).toMatchObject({ totalBytes: 95, overCount: 0, worstFile: "A.md", worstPct: 95, worstBytes: 95, worstMax: 100 });
    expect(cache.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("--cache survives an unwritable STATE dir rather than failing the caller", async () => {
    using dir = fixture("cache-nodir", { budgets: [{ path: "A.md", maxBytes: 100 }] }, { "A.md": "x".repeat(50) });
    const result = await runFixture(dir, ["--cache"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("the shipped budgets", () => {
  test("every always-on file is within its ceiling", async () => {
    const result = await run([bunExe(), repoPath(TOOL)]);
    expect(result.stdout).not.toContain("OVER budget");
    expect(result.exitCode).toBe(0);
  });

  test("every budgeted path exists in the payload: a MISSING row is a silent hole in the ceiling", () => {
    const config = JSON.parse(readFileSync(`${PAYLOAD}/MYOS/TOOLS/context-budgets.json`, "utf8"));
    for (const budget of config.budgets as Budget[]) {
      expect(Bun.file(`${PAYLOAD}/${budget.path}`).size, `${budget.path} is budgeted but not shipped`).toBeGreaterThan(0);
    }
  });

  test("CLAUDE.md plus the system prompt stay inside the 10KB always-loaded limit DEVELOPMENT.md states", () => {
    const claudeMd = Bun.file(`${PAYLOAD}/CLAUDE.md`).size;
    const systemPrompt = Bun.file(`${PAYLOAD}/MYOS/MYOS_SYSTEM_PROMPT.md`).size;
    expect(claudeMd + systemPrompt).toBeLessThanOrEqual(10 * 1024);
  });

  test("the per-file budgets sum to no more than the hard total cap", () => {
    const config = JSON.parse(readFileSync(`${PAYLOAD}/MYOS/TOOLS/context-budgets.json`, "utf8"));
    const sum = (config.budgets as Budget[]).reduce((total, b) => total + b.maxBytes, 0);
    expect(sum).toBeLessThanOrEqual(config.totalMaxBytes);
  });

  test("every budget row carries a note saying what the file is for", () => {
    const config = JSON.parse(readFileSync(`${PAYLOAD}/MYOS/TOOLS/context-budgets.json`, "utf8"));
    for (const budget of config.budgets as Budget[]) {
      expect(budget.note, `${budget.path} has no note`).toBeString();
    }
  });
});

describe("Anti", () => {
  test("Anti: a plain run writes nothing (only --cache writes)", async () => {
    using dir = fixture("anti-write", { budgets: [{ path: "A.md", maxBytes: 100 }] }, {
      "A.md": "x".repeat(50),
      "MYOS/MEMORY/STATE/.keep": "",
    });
    await runFixture(dir);
    expect(await Bun.file(`${dir.path}/MYOS/MEMORY/STATE/context-budget.json`).exists()).toBe(false);
  });
});
