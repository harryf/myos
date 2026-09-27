/**
 * install.sh is the product: every test here runs the real script against a
 * sandbox HOME and MYOS_HOME, never the real home. What it must hold: a fresh
 * install lays down the tree, the user space and the launcher; a second run is
 * a no-op for everything that is Harry's (settings.json byte identical, USER and
 * MEMORY untouched); a dry run writes nothing; a foreign config dir is refused
 * before a single byte (not even install.log); --from-pai copies once.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";

import { repoPath, repoVersion, run, tempHome } from "../harness.ts";

type Home = ReturnType<typeof tempHome>;

async function install(home: Home, args: string[] = [], extra: Record<string, string> = {}) {
  return await run(["bash", repoPath("install.sh"), ...args], {
    env: home.env({ MYOS_HOME: home.myos, MYOS_INSTALL_TODAY: "2026-09-28", TMPDIR: home.mkdir("tmp"), ...extra }),
  });
}

describe("fresh install", () => {
  test("lays down the payload, the user space, the memory dirs and the launcher", async () => {
    using home = tempHome("install-fresh");
    const result = await install(home);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.stdout).toContain("mode: FRESH INSTALL");

    for (const rel of [
      "settings.json", "CLAUDE.md", "package.json", "bin/myos", ".install-manifest.json",
      "MYOS/VERSION", "MYOS/statusline.ts", "MYOS/TOOLS/Doctor.ts", "MYOS/TOOLS/SplitProjects.ts",
      "MYOS/USER/PROJECTS.md", "MYOS/USER/CONVENTIONS.md", "MYOS/USER/CONFIG/MYOS_CONFIG.toml",
      "MYOS/USER/CONFIG/trial.json",
    ]) {
      expect(existsSync(`${home.myos}/${rel}`), rel).toBe(true);
    }
    for (const dir of ["WORK", "KNOWLEDGE", "STATE", "OBSERVABILITY", "OBSERVABILITY/TOKENS"]) {
      expect(lstatSync(`${home.myos}/MYOS/MEMORY/${dir}`).isDirectory(), dir).toBe(true);
    }
    expect(readFileSync(`${home.myos}/MYOS/VERSION`, "utf8").trim()).toBe(repoVersion());
    expect(readFileSync(`${home.myos}/MYOS/USER/CONFIG/MYOS_CONFIG.toml`, "utf8")).toContain('timezone = "Europe/Zurich"');
    expect(readFileSync(`${home.myos}/settings.json`, "utf8")).not.toContain("__MYOS_HOME__");
  });

  test("trial.json carries the review dates: gate +14 days, doctrine +30", async () => {
    using home = tempHome("install-trial");
    await install(home);
    expect(JSON.parse(readFileSync(`${home.myos}/MYOS/USER/CONFIG/trial.json`, "utf8"))).toEqual({
      started: "2026-09-28",
      gate_review_due: "2026-10-12",
      doctrine_review_due: "2026-10-28",
      gate_review_done: false,
      doctrine_review_done: false,
    });
  });

  test("the launcher is linked at ~/.local/bin/myos and prints the version", async () => {
    using home = tempHome("install-launcher");
    const result = await install(home);
    const link = home.join(".local/bin/myos");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(`${home.myos}/bin/myos`);
    expect(result.stdout).toContain("is not on your PATH");

    const version = await run([link, "--version"], { env: home.env({ MYOS_HOME: home.myos }) });
    expect(version.stdout.trim()).toBe(`myos v${repoVersion()}`);
  });

  test("an existing ~/.local/bin/myos that is not a symlink is left alone", async () => {
    using home = tempHome("install-launcher-file");
    home.write(".local/bin/myos", "#!/bin/sh\necho mine\n");
    const result = await install(home);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(home.join(".local/bin/myos"), "utf8")).toBe("#!/bin/sh\necho mine\n");
    expect(result.stdout).toContain("is not a symlink, so it was left alone");
  });

  test("a dir holding only MYOS/MEMORY and MYOS/USER is a fresh install, and that content is kept", async () => {
    using home = tempHome("install-usertrees");
    home.write(".myos/MYOS/MEMORY/STATE/capabilities.json", "{\"stray\":true}\n");
    home.write(".myos/MYOS/USER/PROJECTS.md", "# Projects\n\nmine\n");
    const result = await install(home);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.stdout).toContain("mode: FRESH INSTALL");
    expect(readFileSync(`${home.myos}/MYOS/MEMORY/STATE/capabilities.json`, "utf8")).toBe("{\"stray\":true}\n");
    expect(readFileSync(`${home.myos}/MYOS/USER/PROJECTS.md`, "utf8")).toBe("# Projects\n\nmine\n");
  });
});

describe("second run", () => {
  test("is an upgrade that leaves settings.json byte identical and every user file as it was", async () => {
    using home = tempHome("install-twice");
    await install(home);
    const settings = readFileSync(`${home.myos}/settings.json`, "utf8");
    home.write(".myos/MYOS/USER/CONVENTIONS.md", "# Conventions\n\nmine\n");
    home.write(".myos/MYOS/USER/CONFIG/trial.json", "{\"gate_review_done\":true}\n");
    home.write(".myos/MYOS/MEMORY/WORK/x/ISA.md", "keep\n");

    const second = await install(home, [], { MYOS_INSTALL_TODAY: "2026-12-01" });
    expect(second.exitCode, second.output).toBe(0);
    expect(second.stdout).toContain("mode: UPGRADE");
    expect(readFileSync(`${home.myos}/settings.json`, "utf8")).toBe(settings);
    expect(readFileSync(`${home.myos}/MYOS/USER/CONVENTIONS.md`, "utf8")).toBe("# Conventions\n\nmine\n");
    expect(readFileSync(`${home.myos}/MYOS/USER/CONFIG/trial.json`, "utf8")).toBe("{\"gate_review_done\":true}\n");
    expect(readFileSync(`${home.myos}/MYOS/MEMORY/WORK/x/ISA.md`, "utf8")).toBe("keep\n");
    expect(second.stdout).not.toContain("will be removed");
  });
});

describe("--dry-run", () => {
  test("reports the plan and writes nothing, not even the target dir", async () => {
    using home = tempHome("install-dry");
    const result = await run(["bash", repoPath("install.sh"), "--dry-run"], {
      env: home.env({ MYOS_HOME: home.join("fresh-target"), TMPDIR: home.mkdir("tmp") }),
    });
    expect(result.exitCode, result.output).toBe(0);
    expect(result.stdout).toContain("would create MYOS/USER/CONFIG/trial.json");
    expect(result.stdout).toContain("Dry run complete");
    expect(existsSync(home.join("fresh-target"))).toBe(false);
    expect(existsSync(home.join(".local"))).toBe(false);
  });
});

describe("refusals", () => {
  test("a config dir with skills/ and no myos marker is refused before install.log exists", async () => {
    using home = tempHome("install-foreign");
    home.write(".myos/skills/Mine/SKILL.md", "keep-me\n");
    const result = await install(home);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("nothing that identifies it as a myos install");
    expect(readFileSync(`${home.myos}/skills/Mine/SKILL.md`, "utf8")).toBe("keep-me\n");
    expect(existsSync(`${home.myos}/install.log`)).toBe(false);
  });

  test("MYOS/ holding anything besides MEMORY and USER is refused too", async () => {
    using home = tempHome("install-foreign-myos");
    home.write(".myos/MYOS/TOOLS/theirs.ts", "x\n");
    const result = await install(home);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("MYOS/TOOLS");
  });

  test("an unknown flag exits 1 instead of silently installing", async () => {
    using home = tempHome("install-badflag");
    const result = await install(home, ["--dryrun"]);
    expect(result.exitCode).toBe(1);
    expect(existsSync(`${home.myos}/install.log`)).toBe(false);
  });

  test("--help names the four flags and nothing from the old co-install offers", async () => {
    using home = tempHome("install-help");
    const result = await install(home, ["--help"]);
    expect(result.exitCode).toBe(0);
    for (const flag of ["--dry-run", "--force", "--reset", "--from-pai"]) expect(result.stdout).toContain(flag);
    for (const gone of ["--migrate-pai", "--disable-pai", "--no-pai-check", "--with-creative-deps", "--native-command"]) {
      expect(result.stdout).not.toContain(gone);
    }
  });
});

describe("--from-pai", () => {
  test("copies the pai memories in after the payload, and a second run copies nothing", async () => {
    using home = tempHome("install-frompai");
    home.write("pai/PAI/MEMORY/WORK/20260928-090000_x/ISA.md", "# ISA\n");
    home.write("pai/PAI/MEMORY/KNOWLEDGE/Ideas/a.md", "# A\n");
    home.write("pai/PAI/USER/PROJECTS/PROJECTS.md", "# Projects\n\n## Open Sessions to Resume\n\n- **Alpha (x)**: first. More.\n");
    const env = { MYOS_PAI_SOURCE: home.join("pai") };

    const first = await install(home, ["--from-pai"], env);
    expect(first.exitCode, first.output).toBe(0);
    expect(first.stdout).toContain("WORK:      copied 1 dir(s)");
    expect(readFileSync(`${home.myos}/MYOS/MEMORY/WORK/20260928-090000_x/ISA.md`, "utf8")).toBe("# ISA\n");
    expect(readFileSync(`${home.myos}/MYOS/USER/PROJECTS.md`, "utf8")).toContain("- **Alpha**: first. (see PROJECTS/alpha.md)");

    const second = await install(home, ["--from-pai"], env);
    expect(second.exitCode, second.output).toBe(0);
    expect(second.stdout).toContain("WORK:      copied 0 dir(s) (0 files), 1 already present");
  });

  test("a missing pai source fails the run loudly but leaves the install in place", async () => {
    using home = tempHome("install-frompai-missing");
    const result = await install(home, ["--from-pai"], { MYOS_PAI_SOURCE: home.join("nowhere") });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("--from-pai did not");
    expect(existsSync(`${home.myos}/MYOS/VERSION`)).toBe(true);
  });
});
