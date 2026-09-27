#!/usr/bin/env bun
/**
 * TestCoverageCheck: parity gate between the tool surface and the test suite.
 *
 * The same contract INVENTORY.md holds for components: a tool script exists ⇔ it
 * has a row in test/corpus.ts, and every row that claims a test file has one.
 *
 * Why a gate rather than a convention: the failure it prevents is invisible.
 * A new tool lands, nobody writes a test, the suite still says "all pass", and
 * the release ships an untested tool with a green tick next to it. Percentage
 * coverage would not catch it either, because the file simply is not in the run.
 *
 * Checks:
 *   1. every tool script on disk has a corpus row              (new tool, no test)
 *   2. every corpus row points at a script that still exists   (stale row)
 *   3. every non-exempt row's test file exists                 (row lies)
 *   4. exempt and llm rows carry a note                        (silent exemption)
 *   5. no test file under test/ is unreferenced by the corpus   (orphan test)
 *
 * EXIT CODES: 0 = parity holds, 1 = drift (release blocked).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { CORPUS, TOOL_SURFACE, corpusBySource } from "../test/corpus.ts";

const REPO = path.resolve(import.meta.dir, "..");
const problems: string[] = [];

function fail(message: string): void {
  problems.push(message);
}

// --- discover the tool surface on disk -------------------------------------

function listFiles(dir: string, pattern: RegExp): string[] {
  const absolute = path.join(REPO, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((entry) => pattern.test(entry))
    .filter((entry) => statSync(path.join(absolute, entry)).isFile())
    .map((entry) => `${dir}/${entry}`);
}

const onDisk = new Set<string>();

for (const { dir, pattern } of TOOL_SURFACE.dirs) {
  for (const file of listFiles(dir, pattern)) onDisk.add(file);
}

const skillsDir = path.join(REPO, TOOL_SURFACE.skillTools);
if (existsSync(skillsDir)) {
  for (const skill of readdirSync(skillsDir)) {
    const toolsDir = path.join(skillsDir, skill, "Tools");
    if (!existsSync(toolsDir) || !statSync(toolsDir).isDirectory()) continue;
    for (const file of listFiles(`${TOOL_SURFACE.skillTools}/${skill}/Tools`, /\.ts$/)) onDisk.add(file);
  }
}

for (const extra of TOOL_SURFACE.extras) {
  if (existsSync(path.join(REPO, extra))) onDisk.add(extra);
}

// --- 1 & 2: source parity --------------------------------------------------

const rows = corpusBySource();

for (const source of [...onDisk].sort()) {
  if (!rows.has(source)) {
    fail(
      `NO TEST ROW: ${source} is a shipped script with no row in test/corpus.ts. ` +
        `Add one (kind: static | gated | llm | exempt) in the same commit that added it.`,
    );
  }
}

for (const row of CORPUS) {
  if (!onDisk.has(row.source)) {
    fail(`STALE ROW: test/corpus.ts lists ${row.source}, which is not on disk. Drop the row and its test file.`);
  }
}

// --- 3 & 4: row integrity --------------------------------------------------

const referencedTests = new Set<string>();

for (const row of CORPUS) {
  if (row.kind === "exempt") {
    if (row.test !== undefined) {
      fail(`BAD ROW: ${row.source} is exempt but names a test file. Pick one.`);
    }
    if (!row.note) {
      fail(`BAD ROW: ${row.source} is exempt with no note. An exemption needs a stated reason.`);
    }
    continue;
  }

  if (!row.test) {
    fail(`BAD ROW: ${row.source} is kind=${row.kind} with no test path.`);
    continue;
  }

  referencedTests.add(row.test);

  if (!existsSync(path.join(REPO, row.test))) {
    fail(`MISSING TEST: ${row.source} names ${row.test}, which does not exist.`);
  }

  if (row.kind === "llm" && !row.note) {
    fail(
      `BAD ROW: ${row.source} is kind=llm with no note. State which deterministic part the test covers, ` +
        `so "it calls a model" never becomes a blanket excuse.`,
    );
  }

  if (row.needs) {
    for (const need of row.needs) {
      if (!/^(bin|module|env):.+|^installed$/.test(need)) {
        fail(`BAD ROW: ${row.source} has an unrecognised need "${need}" (expected bin:… module:… env:… or installed).`);
      }
    }
  }
}

// --- 5: orphan test files --------------------------------------------------

function walkTests(dir: string): string[] {
  const absolute = path.join(REPO, dir);
  if (!existsSync(absolute)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const relative = `${dir}/${entry}`;
    const stats = statSync(path.join(REPO, relative));
    if (stats.isDirectory()) out.push(...walkTests(relative));
    else if (entry.endsWith(".test.ts")) out.push(relative);
  }
  return out;
}

/** Test files that legitimately have no corpus row (they test the suite itself
 * or a cross-script contract no single row can own). */
const SUITE_SELF_TESTS = new Set([
  "test/suite.test.ts",
  // Cross-hook properties: settings.template.json registration parity and
  // inter-hook ordering. Per-hook rows each own their own test file.
  "test/hooks/HookContract.test.ts",
  // Cross-skill property: every SKILL.md frontmatter parses as strict YAML.
  // No single script owns skill frontmatter, so no corpus row can own this.
  "test/gates/SkillFrontmatter.test.ts",
]);

for (const testFile of walkTests("test")) {
  if (referencedTests.has(testFile) || SUITE_SELF_TESTS.has(testFile)) continue;
  fail(
    `ORPHAN TEST: ${testFile} is not named by any test/corpus.ts row. ` +
      `Either point a row at it or delete it: an unreferenced test file drifts out of the parity contract.`,
  );
}

// --- report ---------------------------------------------------------------

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\n❌ ${problems.length} tool/test parity problem(s). Release blocked.`);
  process.exit(1);
}

const counts = CORPUS.reduce<Record<string, number>>((acc, row) => {
  acc[row.kind] = (acc[row.kind] ?? 0) + 1;
  return acc;
}, {});

console.log(
  `✅ TestCoverageCheck: ${onDisk.size} scripts, ${CORPUS.length} rows in parity ` +
    `(static ${counts.static ?? 0}, gated ${counts.gated ?? 0}, llm ${counts.llm ?? 0}, exempt ${counts.exempt ?? 0}).`,
);
