/**
 * SkillVersionBump keeps skill frontmatter versions moving with the skills.
 * Pure helpers are tested directly; the git-facing plan modes run against a
 * scratch repository (gated on bin:git) so no test touches the real repo.
 *
 * The tool itself always runs against the myos repo (REPO is baked from
 * import.meta.dir), so integration tests exercise the same git plumbing via a
 * scratch clone with HOME-independent config.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { repoPath, run, tempDir } from "../harness.ts";
import {
  bumpSemver,
  decideBump,
  readFrontmatterVersion,
  setFrontmatterVersion,
} from "../../Tools/SkillVersionBump.ts";

const hasGit = !!Bun.which("git");

describe("semver + frontmatter helpers", () => {
  test("bumpSemver", () => {
    expect(bumpSemver("1.0.0", "patch")).toBe("1.0.1");
    expect(bumpSemver("1.0.9", "minor")).toBe("1.1.0");
    expect(bumpSemver("4.3.2", "minor")).toBe("4.4.0");
    expect(bumpSemver("1.0", "patch")).toBe("1.0.1"); // tolerate short versions
  });

  test("decideBump: additions dominate, empty is null", () => {
    expect(decideBump(["M", "M"])).toBe("patch");
    expect(decideBump(["M", "A"])).toBe("minor");
    expect(decideBump(["R100"])).toBe("patch"); // a rename is not new capability
    expect(decideBump([])).toBeNull();
  });

  test("frontmatter version read + write, with and without an existing line", () => {
    const withVersion = "---\nname: Foo\nversion: 1.2.3\ndescription: x\n---\n\n# Foo\nversion: not-this\n";
    expect(readFrontmatterVersion(withVersion)).toBe("1.2.3");
    const bumped = setFrontmatterVersion(withVersion, "1.3.0");
    expect(readFrontmatterVersion(bumped)).toBe("1.3.0");
    expect(bumped).toContain("version: not-this"); // body untouched

    const without = "---\nname: Foo\ndescription: x\n---\n\n# Foo\n";
    expect(readFrontmatterVersion(without)).toBeNull();
    expect(readFrontmatterVersion(setFrontmatterVersion(without, "2.0.0"))).toBe("2.0.0");
  });
});

describe.if(hasGit)("against a scratch repo", () => {
  const skillMd = (v: string) => `---\nname: Foo\nversion: ${v}\ndescription: test skill\n---\n\n# Foo\n`;

  async function scratchRepo(name: string) {
    const dir = tempDir(`svb-${name}`);
    const git = async (...args: string[]) => {
      const r = await run(["git", ...args], { cwd: dir.path });
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r;
    };
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "t@t.test");
    await git("config", "user.name", "t");
    mkdirSync(dir.join("payload/skills/Foo/Workflows"), { recursive: true });
    mkdirSync(dir.join("Tools"), { recursive: true });
    writeFileSync(dir.join("payload/skills/Foo/SKILL.md"), skillMd("1.0.0"));
    // The tool resolves REPO from its own location, so plant a copy inside the scratch repo.
    writeFileSync(dir.join("Tools/SkillVersionBump.ts"), await Bun.file(repoPath("Tools/SkillVersionBump.ts")).text());
    await git("add", "-A");
    await git("commit", "-qm", "init");
    await git("tag", "v0.1.0");
    return { dir, git };
  }

  const bump = (dir: string, ...args: string[]) =>
    run(["bun", path.join(dir, "Tools/SkillVersionBump.ts"), ...args], { cwd: dir });

  test("modifications bump patch; added files bump minor; new skills stay put", async () => {
    const { dir, git } = await scratchRepo("since");
    writeFileSync(dir.join("payload/skills/Foo/SKILL.md"), skillMd("1.0.0") + "\nmore\n");
    writeFileSync(dir.join("payload/skills/Foo/Workflows/New.md"), "# new workflow\n");
    mkdirSync(dir.join("payload/skills/Brand"), { recursive: true });
    writeFileSync(dir.join("payload/skills/Brand/SKILL.md"), skillMd("1.0.0"));
    await git("add", "-A");
    await git("commit", "-qm", "change foo, add brand");

    const r = await bump(dir.path, "--since", "v0.1.0");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Foo");
    expect(r.stdout).toContain("1.0.0 → 1.1.0 (minor)"); // an added file wins
    expect(r.stdout).not.toContain("Brand"); // new since the ref: authored version stands
    expect(readFrontmatterVersion(await Bun.file(dir.join("payload/skills/Foo/SKILL.md")).text())).toBe("1.1.0");

    using _ = dir;
  });

  test("a version-line-only change never re-bumps (no self-feeding loop)", async () => {
    const { dir, git } = await scratchRepo("selffeed");
    // Simulate the tool's own prior output: only the version line moved.
    writeFileSync(dir.join("payload/skills/Foo/SKILL.md"), skillMd("1.0.1"));
    await git("add", "-A");
    await git("commit", "-qm", "version bump only");

    const r = await bump(dir.path, "--since", "v0.1.0");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("0 skill version(s) bumped");
    expect(readFrontmatterVersion(await Bun.file(dir.join("payload/skills/Foo/SKILL.md")).text())).toBe("1.0.1");

    using _ = dir;
  });

  test("backfill accumulates across tag pairs; dry-run writes nothing; no tags is a no-op", async () => {
    const { dir, git } = await scratchRepo("backfill");
    writeFileSync(dir.join("payload/skills/Foo/SKILL.md"), skillMd("1.0.0") + "\nedit one\n");
    await git("add", "-A");
    await git("commit", "-qm", "patch-worthy edit");
    await git("tag", "v0.2.0");
    writeFileSync(dir.join("payload/skills/Foo/Workflows/New.md"), "# capability\n");
    await git("add", "-A");
    await git("commit", "-qm", "minor-worthy addition");
    await git("tag", "v0.3.0");

    const dry = await bump(dir.path, "--backfill", "--dry-run");
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain("1.0.0 → 1.1.0"); // patch (1.0.1) then minor resets patch: 1.1.0
    // dry run left the file alone
    expect(readFrontmatterVersion(await Bun.file(dir.join("payload/skills/Foo/SKILL.md")).text())).toBe("1.0.0");

    const real = await bump(dir.path, "--backfill");
    expect(real.exitCode).toBe(0);
    expect(readFrontmatterVersion(await Bun.file(dir.join("payload/skills/Foo/SKILL.md")).text())).not.toBe("1.0.0");

    using _ = dir;
  });
});
