/**
 * MigrateMemory --from-pai is the one-way bridge from Harry's pai install. The
 * promises worth a gate: it copies byte for byte, it never touches the source,
 * a second run copies nothing, a dry run writes nothing, and the path audit
 * counts what it says it counts. Every run here uses a fixture pai tree built
 * in a sandbox; the real ~/.claude-personal is never read.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";

import { bunExe, repoPath, run, tempHome } from "../harness.ts";

const TOOL = "payload/MYOS/TOOLS/MigrateMemory.ts";
const CURRENT = readFileSync(repoPath("test/fixtures/isa/current.md"), "utf8");
const LEGACY = readFileSync(repoPath("test/fixtures/isa/legacy.md"), "utf8");

const PROJECTS = [
  "# Projects",
  "",
  "## Open Sessions to Resume",
  "",
  "- **Flat finder (`~/Code/personal/sarah_flat`)**: single-file page built daily. Published by hand.",
  "",
  "- **Masha job search (2026-09-26)**: one-page career map. Built from ten files.",
  "  UPDATE 2026-09-26 15:40 (iteration 2): rebuilt as chapters.",
  "  UPDATE 2026-09-26 17:00 (iteration 3): Grist comments added.",
  "",
  "- **Sulk Web 2.x**: stable root at v1.1.0. The 2.x line ships as prereleases.",
  "",
].join("\n");

/** A sandbox HOME holding an installed myos tree and a fixture pai tree. */
function fixture(name: string) {
  const home = tempHome(`migrate-${name}`);
  home.write(".myos/MYOS/VERSION", "0.1.0\n");
  const pai = ".claude-personal/PAI";
  home.write(`${pai}/MEMORY/WORK/20260928-090000_report-json-flag/ISA.md`, CURRENT);
  home.write(`${pai}/MEMORY/WORK/20260601-120000_legacy-task/ISA.md`, LEGACY);
  home.write(`${pai}/MEMORY/WORK/20260910-080000_notes-only/ISA.md`, "# Notes\n\nRead /Users/harry/.claude-personal/PAI once.\n");
  home.write(`${pai}/MEMORY/WORK/20260910-080000_notes-only/stitch-brief.md`, "brief\n");
  home.write(`${pai}/MEMORY/WORK/20260910-080000_notes-only/\${HOME}/.claude/PAI/cache.txt`, "residue\n");
  home.write(`${pai}/MEMORY/WORK/README.md`, "not a work dir\n");
  home.write(`${pai}/MEMORY/KNOWLEDGE/Ideas/grist.md`, "# Grist\n");
  home.write(`${pai}/MEMORY/KNOWLEDGE/Research/scraping-law.md`, "# Law\nSee ~/.claude-personal/x and /Users/harry/.claude/y\n");
  home.write(`${pai}/MEMORY/STATE/work.json`, JSON.stringify({ sessions: { a: { task: "A" }, b: { task: "B" } } }, null, 2));
  home.write(`${pai}/MEMORY/STATE/session-names.json`, JSON.stringify({ "uuid-1": "One", "uuid-2": "Two" }, null, 2));
  home.write(`${pai}/USER/PROJECTS/PROJECTS.md`, PROJECTS);
  return Object.assign(home, { source: home.join(".claude-personal"), myosDir: home.join(".myos/MYOS") });
}

async function migrate(home: ReturnType<typeof fixture>, args: string[] = []) {
  return await run([bunExe(), repoPath(TOOL), "--from-pai", ...args], {
    env: home.env({ MYOS_PAI_SOURCE: home.source }),
  });
}

/** mtime plus sha256 of every file under dir, for a before/after comparison. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = `${st.mtimeMs}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`;
    }
  };
  walk(dir);
  return out;
}

describe("copying", () => {
  test("copies WORK dirs byte for byte, KNOWLEDGE, STATE and the split projects, with counts", async () => {
    using home = fixture("copy");
    const result = await migrate(home);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WORK:      copied 3 dir(s) (4 files), 0 already present");
    expect(result.stdout).toContain("KNOWLEDGE: copied 2 file(s)");
    expect(result.stdout).toContain("STATE:     copied 2 file(s)");
    expect(result.stdout).toContain("PROJECTS:  wrote 4 file(s)");

    const work = path.join(home.myosDir, "MEMORY/WORK");
    expect(readdirSync(work).sort()).toEqual([
      "20260601-120000_legacy-task", "20260910-080000_notes-only", "20260928-090000_report-json-flag",
    ]);
    expect(readFileSync(path.join(work, "20260928-090000_report-json-flag/ISA.md"), "utf8")).toBe(CURRENT);
    expect(readFileSync(path.join(work, "20260601-120000_legacy-task/ISA.md"), "utf8")).toBe(LEGACY);
    expect(existsSync(path.join(work, "20260910-080000_notes-only/stitch-brief.md"))).toBe(true);
    expect(existsSync(path.join(home.myosDir, "MEMORY/KNOWLEDGE/Research/scraping-law.md"))).toBe(true);
    expect(existsSync(path.join(home.myosDir, "USER/PROJECTS.md"))).toBe(true);
    expect(existsSync(path.join(home.myosDir, "USER/PROJECTS/masha-job-search.md"))).toBe(true);
  });

  test("literal ${HOME} residue dirs and stray files beside the WORK dirs are not copied", async () => {
    using home = fixture("residue");
    await migrate(home);
    expect(existsSync(path.join(home.myosDir, "MEMORY/WORK/20260910-080000_notes-only/${HOME}"))).toBe(false);
    expect(existsSync(path.join(home.myosDir, "MEMORY/WORK/README.md"))).toBe(false);
  });

  test("symlinks are never followed or copied", async () => {
    using home = fixture("symlink");
    symlinkSync(home.path, home.join(".claude-personal/PAI/MEMORY/KNOWLEDGE/loop"));
    const result = await migrate(home);
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(home.myosDir, "MEMORY/KNOWLEDGE/loop"))).toBe(false);
  });

  test("the path audit counts the lines that name the old install", async () => {
    using home = fixture("audit");
    const result = await migrate(home);
    // one line in the notes ISA, one line (two paths) in the law note
    expect(result.stdout).toContain("path audit: 2 line(s)");
    expect(result.stdout).toContain("KNOWLEDGE/Research/scraping-law.md (1)");
  });
});

describe("STATE merge", () => {
  test("rows the target lacks are added, rows it has are left exactly as they are", async () => {
    using home = fixture("merge");
    home.write(".myos/MYOS/MEMORY/STATE/work.json", JSON.stringify({ sessions: { a: { task: "mine" } } }));
    home.write(".myos/MYOS/MEMORY/STATE/session-names.json", JSON.stringify({ "uuid-1": "Mine" }));
    const result = await migrate(home);
    expect(result.stdout).toContain("merged 2 (2 new rows)");

    const work = JSON.parse(readFileSync(path.join(home.myosDir, "MEMORY/STATE/work.json"), "utf8"));
    expect(work.sessions).toEqual({ a: { task: "mine" }, b: { task: "B" } });
    const names = JSON.parse(readFileSync(path.join(home.myosDir, "MEMORY/STATE/session-names.json"), "utf8"));
    expect(names).toEqual({ "uuid-1": "Mine", "uuid-2": "Two" });
  });

  test("a target that is not valid JSON is refused, not overwritten", async () => {
    using home = fixture("badjson");
    home.write(".myos/MYOS/MEMORY/STATE/work.json", "{ not json");
    const result = await migrate(home);
    expect(result.exitCode).toBe(1);
    expect(readFileSync(path.join(home.myosDir, "MEMORY/STATE/work.json"), "utf8")).toBe("{ not json");
  });
});

describe("idempotent", () => {
  test("a second run copies nothing and changes no byte or mtime in the target", async () => {
    using home = fixture("twice");
    await migrate(home);
    const before = snapshot(home.myosDir);
    const second = await migrate(home);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("WORK:      copied 0 dir(s) (0 files), 3 already present");
    expect(second.stdout).toContain("KNOWLEDGE: copied 0 file(s), 2 already present");
    expect(second.stdout).toContain("2 unchanged");
    expect(second.stdout).toContain("PROJECTS:  wrote 0 file(s), 4 unchanged");
    expect(snapshot(home.myosDir)).toEqual(before);
  });

  test("an existing WORK dir is skipped whole, even when its files differ", async () => {
    using home = fixture("workskip");
    home.write(".myos/MYOS/MEMORY/WORK/20260601-120000_legacy-task/ISA.md", "mine\n");
    const result = await migrate(home);
    expect(result.stdout).toContain("copied 2 dir(s)");
    expect(readFileSync(path.join(home.myosDir, "MEMORY/WORK/20260601-120000_legacy-task/ISA.md"), "utf8")).toBe("mine\n");
  });
});

describe("--dry-run", () => {
  test("reports the same counts and writes nothing at all", async () => {
    using home = fixture("dry");
    const before = snapshot(home.myosDir);
    const result = await migrate(home, ["--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WORK:      would copy 3 dir(s) (4 files)");
    expect(result.stdout).toContain("PROJECTS:  would write 4 file(s)");
    expect(snapshot(home.myosDir)).toEqual(before);
  });
});

describe("guards", () => {
  test("without --from-pai it prints usage and exits 2", async () => {
    using home = fixture("usage");
    const result = await run([bunExe(), repoPath(TOOL)], { env: home.env() });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--from-pai");
  });

  test("a target that is not an installed myos tree is refused, and nothing is created", async () => {
    using home = tempHome("migrate-noinstall");
    home.write(".claude-personal/PAI/MEMORY/WORK/x/ISA.md", "x\n");
    const result = await run([bunExe(), repoPath(TOOL), "--from-pai"], {
      env: home.env({ MYOS_PAI_SOURCE: home.join(".claude-personal") }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Run install.sh first");
    expect(existsSync(home.join(".myos/MYOS"))).toBe(false);
  });

  test("--source wins over MYOS_PAI_SOURCE, and a source without PAI/ exits 1", async () => {
    using home = fixture("source");
    const result = await migrate(home, ["--source", home.join("nowhere")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no pai install at");
  });

  test("the MyTokens sync is skipped with a note when the skill is not installed", async () => {
    using home = fixture("tokens");
    const result = await migrate(home);
    expect(result.stdout).toContain("MyTokens:  skipped: the MyTokens skill is not installed");
  });
});

describe("MyTokens sync", () => {
  test("runs TokenLog sync once over <source>/projects, with the config and MYOS dirs of the target", async () => {
    using home = fixture("tokens-run");
    home.write(".claude-personal/projects/-Users-x/session.jsonl", "{}\n");
    const log = home.join("tokenlog-call.json");
    home.write(".myos/skills/MyTokens/Tools/TokenLog.ts", [
      "import { writeFileSync } from \"node:fs\";",
      `writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), projects: process.env.MYOS_TOKENLOG_PROJECTS, config: process.env.CLAUDE_CONFIG_DIR, myos: process.env.MYOS_DIR }));`,
      "console.log(\"1 session added\");",
    ].join("\n"));
    const result = await migrate(home);
    expect(result.stdout).toContain("MyTokens:  synced (1 session added)");
    const call = JSON.parse(readFileSync(log, "utf8"));
    expect(call).toEqual({
      argv: ["sync"],
      projects: home.join(".claude-personal/projects"),
      config: home.join(".myos"),
      myos: home.join(".myos/MYOS"),
    });
  });

  test("a dry run names the sync but does not run it", async () => {
    using home = fixture("tokens-dry");
    home.write(".claude-personal/projects/-Users-x/session.jsonl", "{}\n");
    home.write(".myos/skills/MyTokens/Tools/TokenLog.ts", "throw new Error(\"must not run\");\n");
    const result = await migrate(home, ["--dry-run"]);
    expect(result.stdout).toContain("would run TokenLog sync over");
  });
});

describe("Anti", () => {
  test("Anti: the source tree's bytes and mtimes are unchanged after a real run", async () => {
    using home = fixture("anti-source");
    const before = snapshot(home.source);
    await migrate(home);
    await migrate(home);
    expect(snapshot(home.source)).toEqual(before);
  });

  test("Anti: nothing outside MYOS/MEMORY and MYOS/USER is written", async () => {
    using home = fixture("anti-scope");
    await migrate(home);
    expect(readdirSync(home.myosDir).sort()).toEqual(["MEMORY", "USER", "VERSION"]);
    expect(readdirSync(home.join(".myos")).sort()).toEqual(["MYOS"]);
  });
});
