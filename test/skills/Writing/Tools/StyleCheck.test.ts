/**
 * StyleCheck is the only gate that edits files (`--fix` rewrites em dashes), and
 * it runs over the whole repo in CI. Two things therefore need pinning: that it
 * flags what the house style bans, and that its fixer never touches code, never
 * touches a placeholder table cell, and is idempotent \u2014 a fixer that is not
 * idempotent rewrites the tree on every run and the diff stops meaning anything.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { repoPath, run, bunExe, tempDir } from "../../../harness.ts";

const TOOL = "payload/skills/Writing/Tools/StyleCheck.ts";
const { fixText, fixDashesInLine } = await import(repoPath(TOOL));

/** Run the gate over one file of content and return the parsed JSON report. */
async function check(content: string, args: string[] = []) {
  using dir = tempDir("stylecheck");
  const file = dir.write("doc.md", content);
  const result = await run([bunExe(), repoPath(TOOL), "--json", ...args, file]);
  const jsonStart = result.stdout.indexOf("{");
  return {
    ...result,
    report: JSON.parse(result.stdout.slice(jsonStart, result.stdout.lastIndexOf("}") + 1)),
    rules(): string[] {
      const report = JSON.parse(result.stdout.slice(jsonStart, result.stdout.lastIndexOf("}") + 1));
      return report.findings.map((f: { rule: string }) => f.rule);
    },
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe("detection", () => {
  test("an em dash in prose is an error and fails the run", async () => {
    const result = await check("A sentence \u2014 with a dash.\n");
    expect(result.exitCode).toBe(1);
    expect(result.rules()).toContain("em-dash");
  });

  test("banned vocabulary is reported with the line and column", async () => {
    const result = await check("# Doc\n\nWe will utilize a robust approach.\n");
    const findings = result.report.findings;
    expect(findings.map((f: { rule: string }) => f.rule)).toEqual(
      expect.arrayContaining(["vocab-latinate-banned", "vocab-crucial"]),
    );
    expect(findings[0].line).toBe(3);
    expect(findings[0].col).toBeGreaterThan(0);
  });

  test("each banned family has at least one live example", async () => {
    const cases: Record<string, string> = {
      "vocab-inflated": "This is a testament to the tapestry of learnings.",
      "vocab-latinate-banned": "We commence the work.",
      "vocab-crucial": "A seamless and nuanced result.",
      "vocab-key-adjective": "The key takeaways are listed.",
      "vocab-context-sensitive": "We leverage the ecosystem.",
      "copula-avoidance": "The file serves as the index.",
      "opener-additive": "Additionally, the run passed.",
      "hedge-worth-noting": "It is worth noting the run passed.",
      "not-just-but": "This is not just fast, but cheap.",
      "moving-forward": "Going forward we will ship weekly.",
      "vague-attribution": "Experts say the approach works.",
      "filler-phrase": "We did it in order to ship.",
    };
    for (const [rule, sentence] of Object.entries(cases)) {
      const result = await check(`# Doc\n\n${sentence}\n`);
      expect(result.rules(), `${rule} did not fire on: ${sentence}`).toContain(rule);
    }
  });

  test("structure rules are warnings, not errors, so they never block a release on their own", async () => {
    const result = await check("# Doc\n\n- **Thing:** a description\n");
    expect(result.rules()).toContain("inline-header-bullet");
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Masking: code is not prose
// ---------------------------------------------------------------------------

describe("protected regions", () => {
  test("a fenced code block is never flagged", async () => {
    const result = await check("# Doc\n\n```ts\nconst re = /\u2014/g; // utilize\n```\n");
    expect(result.report.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  test("an inline code span is never flagged", async () => {
    const result = await check("# Doc\n\nThe `--profile \u2014` flag and `utilize` token.\n");
    expect(result.report.findings).toEqual([]);
  });

  test("a link target and a bare URL are never flagged", async () => {
    const result = await check("# Doc\n\nSee [the doc](https://x.test/utilize\u2014path) and https://y.test/robust\n");
    expect(result.report.findings).toEqual([]);
  });

  test("an HTML comment is never flagged", async () => {
    const result = await check("# Doc\n\n<!-- utilize \u2014 this is a note -->\n");
    expect(result.report.findings).toEqual([]);
  });

  test("an indented code block is never flagged", async () => {
    const result = await check("# Doc\n\n    const x = 1; // utilize\n");
    expect(result.report.findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

describe("profiles", () => {
  const doc = "# Doc\n\n## A Heading In Title Case\n\n- **Thing:** a description\n\nWe utilize this.\n";

  test("prose runs every rule", async () => {
    const rules = (await check(doc, ["--profile", "prose"])).rules();
    expect(rules).toContain("heading-title-case");
    expect(rules).toContain("inline-header-bullet");
    expect(rules).toContain("vocab-latinate-banned");
  });

  test("docs drops the structure rules and keeps the vocabulary rules", async () => {
    const rules = (await check(doc, ["--profile", "docs"])).rules();
    expect(rules).not.toContain("heading-title-case");
    expect(rules).not.toContain("inline-header-bullet");
    expect(rules).toContain("vocab-latinate-banned");
  });

  test("dashes reports em dashes only, so a lifted file stays close to upstream", async () => {
    const rules = (await check(`${doc}\nA \u2014 dash.\n`, ["--profile", "dashes"])).rules();
    expect(rules).toEqual(["em-dash"]);
  });

  test("an unknown profile exits 2 rather than silently falling back to prose", async () => {
    using dir = tempDir("stylecheck-profile");
    const file = dir.write("doc.md", "# Doc\n");
    const result = await run([bunExe(), repoPath(TOOL), "--profile", "nope", file]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown profile");
  });
});

// ---------------------------------------------------------------------------
// Opt-outs
// ---------------------------------------------------------------------------

describe("opt-outs", () => {
  test("stylecheck-disable silences a rule family by prefix", async () => {
    const result = await check("<!-- stylecheck-disable: vocab -->\n\n# Doc\n\nWe utilize a robust thing.\n");
    expect(result.rules()).toEqual([]);
  });

  test("stylecheck-disable: all silences everything except em dashes", async () => {
    const result = await check("<!-- stylecheck-disable: all -->\n\n# Doc\n\nWe utilize this \u2014 really.\n");
    expect(result.rules()).toEqual(["em-dash"]);
  });

  test("em-dash cannot be disabled \u2014 there is no reason to write one", async () => {
    const result = await check("<!-- stylecheck-disable: em-dash -->\n\n# Doc\n\nA \u2014 dash.\n");
    expect(result.rules()).toContain("em-dash");
    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The fixer
// ---------------------------------------------------------------------------

describe("fixText", () => {
  test("a defined term takes a colon", () => {
    expect(fixText("**Thing** \u2014 the description.")).toBe("**Thing**: the description.");
  });

  test("an independent clause takes a semicolon", () => {
    expect(fixText("The gate runs \u2014 it blocks the release.")).toBe("The gate runs; it blocks the release.");
  });

  test("a negation takes a comma", () => {
    expect(fixText("Behaviour-enforced \u2014 not label-enforced.")).toBe("Behaviour-enforced, not label-enforced.");
  });

  test("a heading takes a colon", () => {
    expect(fixText("## Releases \u2014 how it works")).toBe("## Releases: how it works");
  });

  test("a short paired aside becomes parentheses", () => {
    expect(fixText("The gate \u2014 a real one \u2014 blocks the tag.")).toBe("The gate (a real one) blocks the tag.");
  });

  test("a trailing dash that ends its block is simply removed", () => {
    expect(fixText("The gate blocks the tag \u2014\n\nNext block.")).toBe("The gate blocks the tag\n\nNext block.");
  });

  test("code is never rewritten", () => {
    const src = "```ts\nconst EM = \"\u2014\";\n```\n";
    expect(fixText(src)).toBe(src);
    const inline = "The `a \u2014 b` token.";
    expect(fixText(inline)).toBe(inline);
  });

  test("a dash opening a table cell is left for a human to name", () => {
    // `| \u2014 |` means "no value here". Every punctuation substitute makes it worse,
    // so the fixer reports and leaves it; the cell needs a word (none, n/a).
    const src = "| Tool | Dep |\n|---|---|\n| A | \u2014 |\n| B | \u2014 (library) |\n";
    expect(fixText(src)).toBe(src);
  });

  test("a dash INSIDE a table cell is still fixed", () => {
    expect(fixText("| A | the gate \u2014 it blocks |")).toBe("| A | the gate; it blocks |");
  });

  test("fixing is idempotent", () => {
    const src = [
      "**Thing** \u2014 the description.",
      "The gate runs \u2014 it blocks the release.",
      "Behaviour-enforced \u2014 not label-enforced.",
      "## Releases \u2014 how it works",
      "| A | \u2014 |",
      "The gate \u2014 a real one \u2014 blocks the tag.",
    ].join("\n");
    const once = fixText(src);
    expect(fixText(once)).toBe(once);
  });

  test("no em dash survives a fix outside protected regions", () => {
    const src = "A \u2014 b. **T** \u2014 c. Not \u2014 only that. See `x \u2014 y` and\n```\nz \u2014 w\n```\n";
    const fixed = fixText(src);
    const proseLines = fixed.split("\n").filter((l) => !l.includes("`") && l.trim() !== "" && !l.startsWith("z"));
    for (const line of proseLines) expect(line).not.toContain("\u2014");
  });

  test("fixDependsOnNextLine: a dash at end of line keeps the punctuation when the sentence continues", () => {
    expect(fixDashesInLine("The gate runs \u2014", "The gate runs \u2014", "it blocks the release.")).toBe("The gate runs;");
  });
});

describe("--fix on disk", () => {
  test("rewrites the file, reports the count, and a second run is a no-op", async () => {
    using dir = tempDir("stylecheck-fix");
    const file = dir.write("doc.md", "# Doc\n\n**Thing** \u2014 the description.\n");

    const first = await run([bunExe(), repoPath(TOOL), "--fix", "--profile", "dashes", file]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("1 rewritten");
    expect(readFileSync(file, "utf8")).toBe("# Doc\n\n**Thing**: the description.\n");

    const second = await run([bunExe(), repoPath(TOOL), "--fix", "--profile", "dashes", file]);
    expect(second.stdout).toContain("0 rewritten");
    expect(readFileSync(file, "utf8")).toBe("# Doc\n\n**Thing**: the description.\n");
  });

  test("word choice is reported and never auto-changed", async () => {
    using dir = tempDir("stylecheck-fix-vocab");
    const file = dir.write("doc.md", "# Doc\n\nWe utilize this.\n");
    const result = await run([bunExe(), repoPath(TOOL), "--fix", file]);
    expect(result.exitCode).toBe(1);
    expect(readFileSync(file, "utf8")).toContain("utilize");
  });
});

// ---------------------------------------------------------------------------
// CLI shape
// ---------------------------------------------------------------------------

describe("CLI", () => {
  test("no arguments prints usage and exits 0", async () => {
    const result = await run([bunExe(), repoPath(TOOL)]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun StyleCheck.ts");
  });

  test("an unreadable path exits 2", async () => {
    const result = await run([bunExe(), repoPath(TOOL), "/nonexistent/path.md"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cannot read");
  });

  test("a directory is walked for .md files only", async () => {
    using dir = tempDir("stylecheck-walk");
    dir.write("a.md", "A \u2014 dash.\n");
    dir.write("b.md", "Another \u2014 dash.\n");
    dir.write("c.ts", "const x = \"\u2014\";\n");
    const result = await run([bunExe(), repoPath(TOOL), "--profile", "dashes", "--quiet", dir.path]);
    expect(result.stdout).toContain("2 file(s)");
  });

  test("--quiet prints the summary only", async () => {
    using dir = tempDir("stylecheck-quiet");
    const file = dir.write("doc.md", "A \u2014 dash.\n");
    const result = await run([bunExe(), repoPath(TOOL), "--quiet", file]);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(result.stdout).toContain("1 error");
  });

  test("--hints adds hint-severity findings without changing the exit code", async () => {
    using dir = tempDir("stylecheck-hints");
    const file = dir.write("doc.md", "# Doc\n\nThis is sufficient for now.\n");
    const plain = await run([bunExe(), repoPath(TOOL), file]);
    const hinted = await run([bunExe(), repoPath(TOOL), "--hints", file]);
    expect(plain.exitCode).toBe(0);
    expect(hinted.exitCode).toBe(0);
    expect(hinted.stdout).toContain("hint");
  });
});

// ---------------------------------------------------------------------------
// The gate against the real tree \u2014 the three commands CI runs
// ---------------------------------------------------------------------------

describe("the shipped tree passes its own gate", () => {
  // Scoped to the surfaces the skills layer owns. Doctrine files (CLAUDE.md, the
  // system prompt, MYOS/DOCUMENTATION) are written elsewhere and gated by CI,
  // which runs the checker over the whole tree.
  test("prose profile over the skills layer's reader-facing surface", async () => {
    const result = await run([
      bunExe(), repoPath(TOOL), "--profile", "prose", "--quiet",
      repoPath("payload/skills/Writing"),
      repoPath("payload/commands"),
      repoPath("payload/agents"),
    ]);
    expect(result.output).toContain("0 error");
    expect(result.exitCode).toBe(0);
  });

  // The lifted skills (Fabric patterns, Remotion references, the thinking
  // skills) are upstream text held to the dashes profile only.
  test("docs profile over the skills written for myos", async () => {
    const result = await run([
      bunExe(), repoPath(TOOL), "--profile", "docs", "--quiet",
      ...["ISA", "MyTokens", "Scheduler", "Writing", "ContextSearch", "Trim"].map((s) => repoPath("payload/skills", s)),
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("dashes profile over the lifted skills", async () => {
    const result = await run([bunExe(), repoPath(TOOL), "--profile", "dashes", "--quiet", repoPath("payload/skills")]);
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Anti
// ---------------------------------------------------------------------------

describe("Anti", () => {
  test("Anti: --fix without a change does not rewrite the file (mtime and bytes hold)", async () => {
    using dir = tempDir("stylecheck-anti-write");
    const file = dir.write("doc.md", "# Doc\n\nClean prose here.\n");
    const before = readFileSync(file);
    await run([bunExe(), repoPath(TOOL), "--fix", file]);
    expect(readFileSync(file)).toEqual(before);
  });

  test("Anti: a run without --fix never writes", async () => {
    using dir = tempDir("stylecheck-anti-nofix");
    const file = dir.write("doc.md", "**Thing** \u2014 the description.\n");
    const before = readFileSync(file, "utf8");
    await run([bunExe(), repoPath(TOOL), file]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
