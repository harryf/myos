/**
 * UpgradePlan decides which of a PM's files the installer is about to destroy.
 * Every classification below maps to a row of the provenance table in
 * DEVELOPMENT.md, and the ones that matter most are the two that trigger a
 * backup: userEdited (differs from the manifest) and userAdded (no manifest
 * entry, sitting in an area the installer replaces wholesale).
 *
 * Both --repo and --home are injectable, so all of this runs against fixtures
 * and never near a real install.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { bunExe, repoPath, run, tempDir, type TempDir } from "../harness.ts";

const TOOL = "Tools/UpgradePlan.ts";

/** A minimal release checkout: one replace-area skill, one additive skill, hooks, MYOS. */
function fixtureRepoFiles(): Record<string, string> {
  return {
    "VERSION": "9.9.9\n",
    "docs/INVENTORY.md": "# inventory\n",
    "bin/myos": "#!/usr/bin/env bash\n",
    "payload/CLAUDE.md": "# context\n",
    "payload/HOME_README.md": "# readme\n",
    "payload/skills/Writing/SKILL.md": "# writing v2\n",
    "payload/skills/_GIGSPM/SKILL.md": "# gigspm v2\n",
    "payload/hooks/Alive.hook.ts": "// v2\n",
    "payload/MYOS/statusline.ts": "// v2\n",
    "payload/MYOS/TOOLS/Doctor.ts": "// v2\n",
    "payload/agents/Forge.md": "# forge\n",
    "payload/commands/myos.md": "# command\n",
  };
}

async function plan(repo: TempDir, home: TempDir, args: string[] = []) {
  return run([bunExe(), repoPath(TOOL), "--repo", repo.path, "--home", home.path, ...args]);
}

/** Write a manifest recording the sha256 of files as an installer would have. */
async function writeManifest(repo: TempDir, home: TempDir, version = "9.9.8") {
  return run([bunExe(), repoPath(TOOL), "--repo", repo.path, "--home", home.path, "--write-manifest", version, "--quiet"]);
}

describe("a fresh install", () => {
  test("everything is a create, nothing is at risk", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home");

    const result = await plan(repo, home);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+ new file\(s\) from this release/);
    expect(result.stdout).not.toContain("locally modified");
    expect(result.stdout).not.toContain("will be removed");
  });
});

describe("provenance classification", () => {
  test("byte-identical files are 'already up to date'", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", {
      "skills/Writing/SKILL.md": "# writing v2\n",
      "hooks/Alive.hook.ts": "// v2\n",
    });
    await writeManifest(repo, home);

    const result = await plan(repo, home);
    expect(result.stdout).toMatch(/[1-9]\d* file\(s\) already up to date/);
    expect(result.stdout).not.toContain("locally modified");
  });

  test("a file matching the manifest but differing from source is a release change, silently replaced", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# writing v1\n" });
    await writeManifest(repo, home); // records the sha of v1 as ours

    const result = await plan(repo, home);
    expect(result.stdout).toMatch(/[1-9]\d* file\(s\) updated by this release/);
    expect(result.stdout).not.toContain("locally modified");
  });

  test("a file the PM edited after install is 'locally modified' and named", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# writing v1\n" });
    await writeManifest(repo, home);
    home.write("skills/Writing/SKILL.md", "# writing v1 with MY EDIT\n");

    const result = await plan(repo, home);
    expect(result.stdout).toContain("locally modified, will be replaced");
    expect(result.stdout).toContain("skills/Writing/SKILL.md");
  });

  test("a file the PM added inside a replace area will be removed, and is named", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# writing v2\n" });
    await writeManifest(repo, home);
    home.write("skills/Writing/MyNotes.md", "notes I wrote\n");

    const result = await plan(repo, home);
    expect(result.stdout).toContain("not from any release, will be removed");
    expect(result.stdout).toContain("skills/Writing/MyNotes.md");
  });

  test("a user file inside an additive _-skill is left alone", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/_GIGSPM/SKILL.md": "# gigspm v2\n" });
    await writeManifest(repo, home);
    home.write("skills/_GIGSPM/CONFIG.md", "my config\n");

    const result = await plan(repo, home);
    expect(result.stdout).toMatch(/[1-9]\d* user file\(s\) inside additive skills, left alone/);
    expect(result.stdout).not.toContain("skills/_GIGSPM/CONFIG.md");
  });

  test("a file a past release owned and this one dropped is reported as removed, not as the PM's", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home");
    // Install the old release, which shipped a hook this one does not.
    home.write("hooks/Alive.hook.ts", "// v2\n");
    home.write("hooks/Dropped.hook.ts", "// v1 only\n");
    repo.write("payload/hooks/Dropped.hook.ts", "// v1 only\n");
    await writeManifest(repo, home);
    // This release no longer ships it.
    await Bun.write(`${repo.path}/payload/hooks/Dropped.hook.ts`, "");
    const { unlinkSync } = await import("node:fs");
    unlinkSync(`${repo.path}/payload/hooks/Dropped.hook.ts`);

    const result = await plan(repo, home);
    expect(result.stdout).toContain("dropped from this release, will be removed");
    expect(result.stdout).not.toContain("not from any release");
  });

  test("no manifest at all treats everything differing as the PM's, and says so", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# writing v1\n" });

    const result = await plan(repo, home);
    expect(result.stdout).toContain("no install manifest found");
    expect(result.stdout).toContain("locally modified, will be replaced");
  });

  test("a corrupt manifest is the same as none", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", {
      "skills/Writing/SKILL.md": "# writing v1\n",
      ".install-manifest.json": "{not json",
    });

    const result = await plan(repo, home);
    expect(result.stdout).toContain("no install manifest found");
  });
});

describe("backups", () => {
  test("at-risk files are copied out, preserving their relative path", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# writing v1\n" });
    await writeManifest(repo, home);
    home.write("skills/Writing/SKILL.md", "# MY EDIT\n");
    home.write("skills/Writing/Mine.md", "mine\n");

    const backupDir = home.join("upgrade-backups/run1");
    const result = await plan(repo, home, ["--backup-dir", backupDir]);

    expect(result.stdout).toContain(`backed up to: ${backupDir}`);
    expect(readFileSync(`${backupDir}/skills/Writing/SKILL.md`, "utf8")).toBe("# MY EDIT\n");
    expect(readFileSync(`${backupDir}/skills/Writing/Mine.md`, "utf8")).toBe("mine\n");
  });

  test("files at no risk are not copied: a backup dir is not a second install", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# writing v2\n" });
    await writeManifest(repo, home);
    home.write("skills/Writing/Mine.md", "mine\n");

    const backupDir = home.join("upgrade-backups/run1");
    await plan(repo, home, ["--backup-dir", backupDir]);

    expect(existsSync(`${backupDir}/skills/Writing/Mine.md`)).toBe(true);
    expect(existsSync(`${backupDir}/skills/Writing/SKILL.md`)).toBe(false);
  });

  test("without --backup-dir it says plainly that nothing was copied", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# edited\n" });

    const result = await plan(repo, home);
    expect(result.stdout).toContain("dry run: nothing copied");
  });
});

describe("--write-manifest", () => {
  test("records the installed files' hashes, sorted, with the version", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", {
      "skills/Writing/SKILL.md": "# writing v2\n",
      "hooks/Alive.hook.ts": "// v2\n",
    });

    const result = await writeManifest(repo, home, "9.9.9");
    expect(result.exitCode).toBe(0);

    const manifest = JSON.parse(readFileSync(home.join(".install-manifest.json"), "utf8"));
    expect(manifest.version).toBe("9.9.9");
    expect(manifest.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(manifest.files)).toEqual([...Object.keys(manifest.files)].sort());
    expect(manifest.files["skills/Writing/SKILL.md"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("hashes what is on disk, not what the source says", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# something else\n" });
    await writeManifest(repo, home);

    const manifest = JSON.parse(readFileSync(home.join(".install-manifest.json"), "utf8"));
    const expected = new Bun.CryptoHasher("sha256").update("# something else\n").digest("hex");
    expect(manifest.files["skills/Writing/SKILL.md"]).toBe(expected);
  });

  test("a manifest written now makes the next run report no user edits", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# writing v1\n" });

    expect((await plan(repo, home)).stdout).toContain("locally modified");
    await writeManifest(repo, home);
    expect((await plan(repo, home)).stdout).not.toContain("locally modified");
  });
});

describe("the area table mirrors install.sh", () => {
  test("every managed area install.sh copies appears in the tool", () => {
    // A managed path missing from the tool is a path the installer can delete
    // without warning, which is exactly the bug this pairing prevents.
    const tool = readFileSync(repoPath(TOOL), "utf8");
    for (const area of ["skills", "agents", "commands", "hooks", "MYOS", "CLAUDE.md", "INVENTORY.md", "HOME_README.md", "bin"]) {
      expect(tool, `area ${area} missing from UpgradePlan`).toContain(area);
    }
  });

  test("MEMORY is never a managed area (it is preserved forever)", () => {
    const tool = readFileSync(repoPath(TOOL), "utf8");
    expect(tool).toContain('name === "MEMORY"');
  });

  test("noise files are never compared or backed up", () => {
    const tool = readFileSync(repoPath(TOOL), "utf8");
    for (const name of [".DS_Store", "node_modules", "bun.lock", ".git"]) {
      expect(tool).toContain(name);
    }
  });
});

describe("CLI", () => {
  test("missing --repo or --home exits 2 with usage", async () => {
    const result = await run([bunExe(), repoPath(TOOL)]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  test("a flag with no value exits 2 rather than reading the next flag as a path", async () => {
    const result = await run([bunExe(), repoPath(TOOL), "--repo", "--home", "/tmp"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing value for --repo");
  });
});

describe("Anti", () => {
  test("Anti: a plan run writes nothing into the home it inspects", async () => {
    using repo = tempDir("upgrade-repo", fixtureRepoFiles());
    using home = tempDir("upgrade-home", { "skills/Writing/SKILL.md": "# edited\n" });
    const before = readFileSync(home.join("skills/Writing/SKILL.md"), "utf8");

    await plan(repo, home);

    expect(readFileSync(home.join("skills/Writing/SKILL.md"), "utf8")).toBe(before);
    expect(existsSync(home.join(".install-manifest.json"))).toBe(false);
  });
});
