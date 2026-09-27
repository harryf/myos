/**
 * SkillFrontmatter.test.ts: every shipped skill's SKILL.md frontmatter is
 * strict YAML.
 *
 * Nothing else in the pipeline parses frontmatter for real: myos's tooling
 * reads it with line regexes (SkillVersionBump, ReleaseCheck) and Claude
 * Code's loader is lenient. So an invalid document: the classic being an
 * unquoted `description:` value containing ": ": loads fine everywhere until
 * a strict parser sees it. GitHub's renderer (Psych) was that parser: three
 * skills shipped with a YAML syntax-error banner on github.com (2026-08-01).
 * This gate is the strict parser the pipeline was missing.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const skillsDir = join(import.meta.dir, "../../payload/skills");
const skills = readdirSync(skillsDir)
  .filter((d) => existsSync(join(skillsDir, d, "SKILL.md")))
  .sort();

describe("SKILL.md frontmatter parses as strict YAML", () => {
  test("payload skills were found", () => {
    expect(skills.length).toBeGreaterThanOrEqual(20);
  });

  for (const skill of skills) {
    test(skill, () => {
      const text = readFileSync(join(skillsDir, skill, "SKILL.md"), "utf8");
      const fm = text.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) throw new Error(`${skill}/SKILL.md has no frontmatter block`);

      // parse() throws on invalid YAML ("mapping values are not allowed…").
      const doc = parse(fm[1]) as Record<string, unknown>;

      expect(doc).toBeTruthy();
      expect(doc.name).toBe(skill);
      expect(typeof doc.description).toBe("string");
      expect((doc.description as string).trim().length).toBeGreaterThan(0);
    });
  }
});
