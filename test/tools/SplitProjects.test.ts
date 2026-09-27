/**
 * SplitProjects turns the 74 KB PROJECTS.md into an index imported every
 * session plus one history file per project. What matters: the index stays
 * under its byte budget, the history text survives verbatim (continuation
 * paragraphs included), slugs are stable, and a rerun is a byte-for-byte
 * no-op that never overwrites a file Harry edited.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

import { bunExe, repoPath, run, tempDir } from "../harness.ts";

const TOOL = "payload/MYOS/TOOLS/SplitProjects.ts";
const { splitProjects, slugify, shortName, firstSentence, INDEX_BUDGET_BYTES, SCAFFOLD_MARKER } = await import(repoPath(TOOL));

const INPUT = [
  "# Projects",
  "",
  "## Open Sessions to Resume",
  "",
  "- **Sarah's Lausanne flat finder (`~/Code/personal/sarah_flat`)**: single-file page built by `Tools/build.ts`. Daily cron publishes it.",
  "",
  "- **Masha job search (2026-09-26)**: one-page career map for Masha. Built from ten input files.",
  "  UPDATE 2026-09-26 15:40 (iteration 2): page rebuilt as chapters.",
  "  UPDATE 2026-09-26 17:00 (iteration 3): Grist comments, stars and a board.",
  "",
  "- **IYF A/B flyer test (web/print, 2026-09-12)**: two variants shipped. Harry picks one.",
  "",
].join("\n");

async function cli(args: string[]) {
  return await run([bunExe(), repoPath(TOOL), ...args]);
}

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = `${d}/${name}`;
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else out[`${prefix}${name}`] = `${statSync(full).mtimeMs}:${readFileSync(full, "utf8")}`;
    }
  };
  walk(dir, "");
  return out;
}

describe("parsing", () => {
  test("one project per bullet, continuation paragraphs stay with their bullet", () => {
    const split = splitProjects(INPUT, "2026-09-27");
    expect(split.projects.map((p: { name: string }) => p.name)).toEqual([
      "Sarah's Lausanne flat finder", "Masha job search", "IYF A/B flyer test",
    ]);
    const masha = split.files.get("PROJECTS/masha-job-search.md");
    expect(masha).toContain("  UPDATE 2026-09-26 15:40 (iteration 2): page rebuilt as chapters.");
    expect(masha).toContain("  UPDATE 2026-09-26 17:00 (iteration 3): Grist comments, stars and a board.");
    expect(split.files.get("PROJECTS/iyf-a-b-flyer-test.md")).not.toContain("UPDATE");
  });

  test("a project file is the heading, the original text verbatim, and the source line", () => {
    const split = splitProjects(INPUT, "2026-09-27");
    const bullet = INPUT.split("\n").find((l: string) => l.startsWith("- **Sarah"));
    expect(split.files.get("PROJECTS/sarahs-lausanne-flat-finder.md")).toBe(
      `# Sarah's Lausanne flat finder\n\n${bullet}\n\nSource: PROJECTS.md, migrated 2026-09-27\n`,
    );
  });

  test("the index has both headings and one pointer line per project", () => {
    const { index } = splitProjects(INPUT, "2026-09-27");
    expect(index).toBe([
      "# Projects",
      "",
      "## Open Sessions to Resume",
      "",
      "- **Sarah's Lausanne flat finder**: single-file page built by `Tools/build.ts`. (see PROJECTS/sarahs-lausanne-flat-finder.md)",
      "- **Masha job search**: one-page career map for Masha. (see PROJECTS/masha-job-search.md)",
      "- **IYF A/B flyer test**: two variants shipped. (see PROJECTS/iyf-a-b-flyer-test.md)",
      "",
    ].join("\n"));
  });
});

describe("names, slugs and summaries", () => {
  test("the name stops at the first ( or :", () => {
    expect(shortName("Masha job search (2026-09-26)")).toBe("Masha job search");
    expect(shortName("Tools: the lot")).toBe("Tools");
  });

  test("slugs are kebab case ASCII, at most 60 chars, never empty", () => {
    expect(slugify("IYF A/B flyer test")).toBe("iyf-a-b-flyer-test");
    expect(slugify("Le Terrier, Sarah’s calm page")).toBe("le-terrier-sarahs-calm-page");
    expect(slugify("Zürich Café")).toBe("zurich-cafe");
    expect(slugify("x".repeat(80))).toHaveLength(60);
    expect(slugify("!!!")).toBe("project");
  });

  test("duplicate slugs get a numeric suffix, in input order", () => {
    const split = splitProjects("# P\n\n## Open\n\n- **Same**: one.\n- **Same (again)**: two.\n", "2026-09-27");
    expect(split.projects.map((p: { slug: string }) => p.slug)).toEqual(["same", "same-2"]);
  });

  test("the summary is the first sentence, cut at 160 chars", () => {
    expect(firstSentence("v1.1.0 is stable. The rest follows.")).toBe("v1.1.0 is stable.");
    const long = firstSentence(`${"word ".repeat(60)}end.`);
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("...")).toBe(true);
  });
});

describe("writing", () => {
  test("a second run rewrites identical bytes: nothing written, nothing touched", async () => {
    using dir = tempDir("split-twice", { "in.md": INPUT });
    const out = dir.join("USER");
    const first = await cli([dir.join("in.md"), "--out", out, "--date", "2026-09-27"]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("wrote 4, unchanged 0, left alone 0");
    const before = tree(out);
    const second = await cli([dir.join("in.md"), "--out", out, "--date", "2026-10-01"]);
    expect(second.stdout).toContain("wrote 0, unchanged 4, left alone 0");
    expect(tree(out)).toEqual(before);
  });

  test("an edited project file is left alone and reported", async () => {
    using dir = tempDir("split-edited", { "in.md": INPUT });
    const out = dir.join("USER");
    await cli([dir.join("in.md"), "--out", out, "--date", "2026-09-27"]);
    dir.write("USER/PROJECTS/masha-job-search.md", "# Masha job search\n\nMy own notes.\n");
    const result = await cli([dir.join("in.md"), "--out", out, "--date", "2026-09-27"]);
    expect(result.stdout).toContain("left alone (differs from the generated file, maybe edited): PROJECTS/masha-job-search.md");
    expect(readFileSync(dir.join("USER/PROJECTS/masha-job-search.md"), "utf8")).toBe("# Masha job search\n\nMy own notes.\n");
  });

  test("the shipped scaffold index is replaced, an edited index is not", async () => {
    using dir = tempDir("split-scaffold", { "in.md": INPUT });
    dir.write("USER/PROJECTS.md", readFileSync(repoPath("payload/MYOS/USER/PROJECTS.md"), "utf8"));
    await cli([dir.join("in.md"), "--out", dir.join("USER"), "--date", "2026-09-27"]);
    expect(readFileSync(dir.join("USER/PROJECTS.md"), "utf8")).toContain("(see PROJECTS/masha-job-search.md)");

    dir.write("USER/PROJECTS.md", "# Projects\n\nmine\n");
    const result = await cli([dir.join("in.md"), "--out", dir.join("USER"), "--date", "2026-09-27"]);
    expect(result.stdout).toContain("left alone (differs from the generated file, maybe edited): PROJECTS.md");
  });

  test("the scaffold carries the marker this tool looks for", () => {
    expect(readFileSync(repoPath("payload/MYOS/USER/PROJECTS.md"), "utf8")).toContain(SCAFFOLD_MARKER);
  });

  test("--dry-run writes nothing", async () => {
    using dir = tempDir("split-dry", { "in.md": INPUT });
    const result = await cli([dir.join("in.md"), "--out", dir.join("USER"), "--dry-run"]);
    expect(result.stdout).toContain("would write 4");
    expect(existsSync(dir.join("USER"))).toBe(false);
  });
});

describe("the byte budget", () => {
  test("the fixture index is far under 6,000 bytes and --check passes", async () => {
    const { index } = splitProjects(INPUT, "2026-09-27");
    expect(Buffer.byteLength(index)).toBeLessThan(INDEX_BUDGET_BYTES);
    using dir = tempDir("split-check-ok", { "in.md": INPUT });
    const result = await cli([dir.join("in.md"), "--out", dir.join("USER"), "--check"]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(dir.join("USER"))).toBe(false);
  });

  test("--check exits 1 when the index would exceed the budget, and writes nothing", async () => {
    const many = ["# Projects", "", "## Open Sessions to Resume", ""];
    for (let i = 0; i < 60; i++) many.push(`- **Project number ${i}**: ${"a long running first sentence ".repeat(6)}.`);
    using dir = tempDir("split-check-over", { "in.md": many.join("\n") });
    const result = await cli([dir.join("in.md"), "--out", dir.join("USER"), "--check"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("OVER BUDGET");
    expect(existsSync(dir.join("USER"))).toBe(false);
  });
});

describe("CLI", () => {
  test("no input prints usage and exits 2", async () => {
    const result = await cli([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Usage: bun SplitProjects.ts");
  });

  test("a bad --date is refused", async () => {
    using dir = tempDir("split-date", { "in.md": INPUT });
    const result = await cli([dir.join("in.md"), "--out", dir.join("USER"), "--date", "27.9.2026"]);
    expect(result.exitCode).toBe(2);
  });
});
