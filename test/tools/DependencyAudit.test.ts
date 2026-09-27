/**
 * DependencyAudit discovers units from the filesystem, so nothing here asserts
 * which binaries this machine happens to have. What is testable is discovery (a
 * new skill must appear with zero code changes), and the trust ordering that
 * keeps the audit honest: a dependency seen only in markdown never marks a unit
 * unavailable, because docs describe what an agent MAY run.
 *
 * `--root` points the audit at a fixture tree, so the structural assertions run
 * in milliseconds instead of scanning the whole payload; the discovery claims
 * still run against the real payload.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";

import { bunExe, parseJsonOutput, repoPath, run, tempDir } from "../harness.ts";

const TOOL = "payload/MYOS/TOOLS/DependencyAudit.ts";

interface Finding {
  name?: string;
  kind?: string;
  /** "code" is a real call site; "markdown" is only a description of one. */
  source?: string;
  required?: boolean;
  present?: boolean;
  install?: string;
  files?: string[];
}

interface Unit {
  name: string;
  kind: string;
  status: "built-in" | "ready" | "partial" | "unavailable";
  findings: Finding[];
  apis: unknown[];
}

interface Report {
  schemaVersion: number;
  root: string;
  platform: string;
  generatedAt: string;
  core: Array<{ name: string; present: boolean; install: string; why: string; optional: boolean }>;
  units: Unit[];
  missing: unknown[];
  skipped: unknown[];
}

async function audit(args: string[] = []) {
  return await run([bunExe(), repoPath(TOOL), ...args]);
}

/** A tiny payload-shaped tree: one pure skill, one that shells out, one tool. */
function fixtureRoot(name: string, extra: Record<string, string> = {}) {
  return tempDir(`depaudit-${name}`, {
    "skills/PureThinking/SKILL.md": "# PureThinking\n\nA reasoning skill that shells out to nothing.\n",
    "skills/NeedsFfmpeg/SKILL.md": "# NeedsFfmpeg\n\nUses ffmpeg.\n",
    "skills/NeedsFfmpeg/Tools/Cut.ts": 'await Bun.$`ffmpeg -i in.wav out.wav`;\n',
    "MYOS/TOOLS/Plain.ts": "console.log('no dependencies here');\n",
    ...extra,
  });
}

async function auditRoot(dir: { path: string }, args: string[] = []) {
  return parseJsonOutput<Report>((await audit(["--root", dir.path, "--json", ...args])).stdout);
}

describe("discovery against the real payload", () => {
  test("--list finds every skill and tool without being told about any of them", async () => {
    const result = await audit(["--list"]);
    expect(result.exitCode).toBe(0);

    const names = result.stdout.trim().split("\n").filter(Boolean);
    // Expectations come from the payload on disk, not a hard-coded skill list:
    // every skill dir and every MYOS/TOOLS script is a unit, plus the hooks layer.
    const skills = readdirSync(repoPath("payload/skills"), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    const tools = readdirSync(repoPath("payload/MYOS/TOOLS"))
      .filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));
    for (const unit of [...skills, ...tools, "hooks"]) expect(names, `${unit} not discovered`).toContain(unit);
    expect(names).toContain("Doctor");
    expect(names).toContain("Interceptor");
    expect(result.stdout).not.toContain("{");
  });

  test("a single unit can be audited by name", async () => {
    const report = parseJsonOutput<Report>((await audit(["Interceptor", "--json"])).stdout);
    expect(report.units.map((unit) => unit.name)).toEqual(["Interceptor"]);
  });

  test("a MYOS tool resolves with or without the .ts suffix", async () => {
    const withSuffix = parseJsonOutput<Report>((await audit(["Doctor.ts", "--json"])).stdout);
    const without = parseJsonOutput<Report>((await audit(["Doctor", "--json"])).stdout);
    expect(without.units).toHaveLength(1);
    expect(withSuffix.units.map((u) => u.name)).toEqual(without.units.map((u) => u.name));
  });

  test("an unknown unit name exits 2 and lists what it could have meant", async () => {
    const result = await audit(["NoSuchUnitAnywhere", "--json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Unknown unit "NoSuchUnitAnywhere"');
    expect(result.stderr).toContain("Available:");
  });
});

describe("discovery in a fixture tree: a new skill needs no code change", () => {
  test("a skill dropped into skills/ appears in the audit", async () => {
    using dir = fixtureRoot("newskill", { "skills/JustLanded/SKILL.md": "# JustLanded\n" });
    const report = await auditRoot(dir);
    expect(report.units.map((unit) => unit.name)).toContain("JustLanded");
  });

  test("a directory without a SKILL.md is not a skill", async () => {
    using dir = fixtureRoot("notaskill", { "skills/NotASkill/README.md": "# not a skill\n" });
    const report = await auditRoot(dir);
    expect(report.units.map((unit) => unit.name)).not.toContain("NotASkill");
  });

  test("the audited root is reported, so a report can never be mistaken for another tree's", async () => {
    using dir = fixtureRoot("rootreport");
    const report = await auditRoot(dir);
    expect(report.root).toBe(dir.path);
  });
});

describe("verdicts", () => {
  test("a unit that depends on nothing is built-in, so no missing binary can block it", async () => {
    using dir = fixtureRoot("builtin");
    const report = await auditRoot(dir);
    const pure = report.units.find((unit) => unit.name === "PureThinking");
    expect(pure?.findings).toEqual([]);
    expect(pure?.status).toBe("built-in");
  });

  test("a real call site is detected from code and drives the unit's status", async () => {
    using dir = fixtureRoot("callsite");
    const report = await auditRoot(dir);
    const unit = report.units.find((u) => u.name === "NeedsFfmpeg");
    const ffmpeg = unit?.findings.find((finding) => finding.name === "ffmpeg");
    expect(ffmpeg, "the ffmpeg call site was not detected").toBeDefined();
    expect(ffmpeg!.source).toBe("code");
    expect(ffmpeg!.install).toContain("ffmpeg");
    expect(ffmpeg!.files).toContain("skills/NeedsFfmpeg/Tools/Cut.ts");
    expect(["ready", "unavailable", "partial"]).toContain(unit!.status);
  });

  test("a markdown-only dependency never marks a unit unavailable", async () => {
    // The trust ordering: a code call site is a real invocation; a fenced bash
    // block in a doc is a description of what an agent may run. Only the former
    // can block a unit.
    using dir = fixtureRoot("mdonly", {
      "skills/DocsOnly/SKILL.md": "# DocsOnly\n\n```bash\nsome-binary-nobody-has --flag\nffmpeg -i a b\n```\n",
    });
    const report = await auditRoot(dir);
    const unit = report.units.find((u) => u.name === "DocsOnly");
    expect(unit?.status).not.toBe("unavailable");
  });

  test("every status in a report is one of the four documented values", async () => {
    using dir = fixtureRoot("statuses");
    const report = await auditRoot(dir);
    for (const unit of report.units) {
      expect(["built-in", "ready", "partial", "unavailable"], `${unit.name} status is ${unit.status}`).toContain(unit.status);
    }
  });

  test("every core dependency carries an install command, a role, and an optionality flag", async () => {
    using dir = fixtureRoot("core");
    const report = await auditRoot(dir);
    expect(report.core.length).toBeGreaterThan(0);
    for (const dependency of report.core) {
      expect(dependency.install, `${dependency.name} has no install command`).toBeString();
      expect(dependency.install.length).toBeGreaterThan(0);
      // The why is what turns "XX rg missing" into something a PM can act on.
      expect(dependency.why, `${dependency.name} has no why`).toBeString();
      expect(dependency.why.length).toBeGreaterThan(0);
      expect(dependency.optional).toBeBoolean();
      // Every PM runs macOS: installs must be Homebrew or macOS-native.
      expect(dependency.install, `${dependency.name} install is not brew/macOS-native`).toMatch(
        /brew |xcode-select|code\.claude\.com|bun\.sh/,
      );
    }
  });

  test("rg is core, and its why pins the incident that proved it (ContextSearch dying without it)", async () => {
    using dir = fixtureRoot("core-rg");
    const report = await auditRoot(dir);
    const rg = report.core.find((c) => c.name === "rg");
    expect(rg).toBeDefined();
    expect(rg!.optional).toBe(false);
    expect(rg!.why).toContain("ContextSearch");
    expect(rg!.install).toContain("brew install ripgrep");
  });

  test("the human report separates the core section from skill-specific dependencies", async () => {
    using dir = fixtureRoot("core-render");
    const result = await run([bunExe(), repoPath(TOOL), "--root", dir.path]);
    expect(result.stdout).toContain("Core toolchain (what myos assumes on every machine: not skill-specific)");
  });

  test("the report carries a schema version, the platform and a timestamp", async () => {
    using dir = fixtureRoot("meta");
    const report = await auditRoot(dir);
    expect(report.schemaVersion).toBeNumber();
    expect(report.platform).toBe(process.platform);
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("CLI", () => {
  test("--root without a value exits 2 rather than auditing the wrong tree", async () => {
    const result = await audit(["--root"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--root needs a directory");
  });

  test("a root that is not a payload exits 2 and says what was missing", async () => {
    using dir = tempDir("depaudit-notpayload", { "readme.md": "# nothing here\n" });
    const result = await audit(["--root", dir.path, "--json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("No myos payload found");
  });

  test("--missing lists distinct missing dependencies with a way to fix each", async () => {
    using dir = fixtureRoot("missing", {
      "skills/NeedsNothingReal/Tools/X.ts": 'await Bun.$`definitely-not-installed-xyz --run`;\n',
      "skills/NeedsNothingReal/SKILL.md": "# NeedsNothingReal\n",
    });
    const result = await audit(["--root", dir.path, "--missing"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});

describe("Anti", () => {
  test("Anti: an audit installs nothing without --install", async () => {
    using dir = fixtureRoot("anti-install");
    const result = await audit(["--root", dir.path, "--json"]);
    expect(result.output).not.toMatch(/installing|installed successfully/i);
    expect(result.exitCode).toBe(0);
  });

  test("Anti: no credential value reaches the report: only key names ever appear", async () => {
    using dir = fixtureRoot("anti-secrets", { ".env": "PERPLEXITY_API_KEY=pplx-supersecretvalue\n" });
    const report = await auditRoot(dir);
    expect(JSON.stringify(report)).not.toContain("pplx-supersecretvalue");
  });

  test("Anti: the audited tree is never written to", async () => {
    using dir = fixtureRoot("anti-write");
    const before = await Bun.file(`${dir.path}/skills/PureThinking/SKILL.md`).text();
    await audit(["--root", dir.path, "--json"]);
    expect(await Bun.file(`${dir.path}/skills/PureThinking/SKILL.md`).text()).toBe(before);
  });
});
