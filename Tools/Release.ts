#!/usr/bin/env bun
/**
 * Release: the one-command release runner.
 *
 * Automates the flow DEVELOPMENT.md § Releases documents, in order, stopping
 * loud at the first failure:
 *
 *   1. preflight   on main, clean tree, not behind origin, gh authenticated,
 *                  CHANGELOG has a non-empty "## Unreleased" section
 *   2. gates       ContrabandCheck, PermissionRulesCheck, TestCoverageCheck, bun test
 *   3. system      ./install.sh then ReleaseCheck (live probes; --fast = --health only)
 *   4. version     bump VERSION, re-head "## Unreleased" to "## X.Y.Z (YYYY-MM-DD)"
 *   5. ship        commit "release: vX.Y.Z", push, wait for CI green,
 *                  push the tag (the release act), wait for the release
 *                  workflow, confirm the GitHub release is published
 *   6. sync        re-run ./install.sh so ~/.myos matches the release
 *
 * The one thing it never writes is the changelog entry itself: releases stay
 * human-described. Add the "## Unreleased" section while doing the work, then
 * releasing is:
 *
 *   bun Tools/Release.ts patch            # 0.2.7 → 0.2.8 (also: minor, major, X.Y.Z)
 *   bun Tools/Release.ts patch --dry-run  # full rehearsal: gates + probes, no writes/pushes
 *   bun Tools/Release.ts patch --fast     # ReleaseCheck health half only, zero model calls
 *
 * Manual by design (live probes + pushes), never wired into CI. Exit 1 on any
 * failure, with a "where you are" note so a half-done release is resumable by
 * hand.
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// Pure logic (exported for tests)
// ---------------------------------------------------------------------------

export const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function bumpVersion(current: string, bump: string): string {
  const m = SEMVER.exec(current.trim());
  if (!m) throw new Error(`VERSION is not X.Y.Z: "${current.trim()}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  const e = SEMVER.exec(bump);
  if (!e) throw new Error(`bump must be patch|minor|major or X.Y.Z, got "${bump}"`);
  const next = [Number(e[1]), Number(e[2]), Number(e[3])];
  const cur = [major, minor, patch];
  for (let i = 0; i < 3; i++) {
    if (next[i] > cur[i]) return bump;
    if (next[i] < cur[i]) break;
  }
  throw new Error(`explicit version ${bump} is not greater than current ${current.trim()}`);
}

/** The section the release workflow extracts: lines after "## <version> " up to the next "## ". */
export function extractSection(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith(`## ${version} `) || line === `## ${version}`) { inSection = true; continue; }
    if (line.startsWith("## ")) { inSection = false; continue; }
    if (inSection) out.push(line);
  }
  return out.join("\n").trim();
}

/** Re-head "## Unreleased" to "## <version> (<date>)", refusing anything ambiguous. */
export function retitleUnreleased(changelog: string, version: string, date: string): string {
  if (changelog.includes(`## ${version} `) || changelog.includes(`## ${version}\n`)) {
    throw new Error(`CHANGELOG already has a "## ${version}" entry: was this version already released?`);
  }
  const headings = changelog.split("\n").filter((l) => l.trim() === "## Unreleased").length;
  if (headings === 0) {
    throw new Error('CHANGELOG has no "## Unreleased" section. Describe the release there first; this tool never writes release notes.');
  }
  if (headings > 1) throw new Error('CHANGELOG has more than one "## Unreleased" heading: merge them first.');
  if (!extractSection(changelog, "Unreleased")) {
    throw new Error('the "## Unreleased" section is empty: describe the release before shipping it.');
  }
  return changelog.replace(/^## Unreleased[ \t]*$/m, `## ${version} (${date})`);
}

export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface Options {
  bump: string;
  dryRun: boolean;
  fast: boolean;
}

export function parseArgs(argv: string[]): Options | { error: string } | { help: true } {
  const opts: Options = { bump: "", dryRun: false, fast: false };
  for (const a of argv) {
    if (a === "--help" || a === "-h") return { help: true };
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--fast") opts.fast = true;
    else if (a.startsWith("-")) return { error: `unknown flag ${a}` };
    else if (opts.bump) return { error: `one bump argument only, got "${opts.bump}" and "${a}"` };
    else opts.bump = a;
  }
  if (!opts.bump) return { error: "usage: bun Tools/Release.ts patch|minor|major|X.Y.Z [--dry-run] [--fast]" };
  if (!["patch", "minor", "major"].includes(opts.bump) && !SEMVER.test(opts.bump)) {
    return { error: `bump must be patch|minor|major or X.Y.Z, got "${opts.bump}"` };
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

interface Cmd { ok: boolean; stdout: string; stderr: string }

function sh(cmd: string[], opts: { echo?: boolean } = {}): Cmd {
  const p = Bun.spawnSync(cmd, { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const stdout = p.stdout.toString();
  const stderr = p.stderr.toString();
  if (opts.echo && (stdout || stderr)) process.stdout.write(stdout + stderr);
  return { ok: p.exitCode === 0, stdout, stderr };
}

function step(label: string) {
  console.log(`\n▶ ${label}`);
}

function pass(msg: string) {
  console.log(`  ✅ ${msg}`);
}

function die(msg: string, whereYouAre?: string): never {
  console.error(`  ❌ ${msg}`);
  if (whereYouAre) console.error(`\nWhere you are: ${whereYouAre}`);
  process.exit(1);
}

function must(c: Cmd, what: string, whereYouAre?: string): Cmd {
  if (!c.ok) {
    const tail = (c.stdout + c.stderr).trim().split("\n").slice(-15).join("\n");
    if (tail) console.error(tail);
    die(`${what} failed`, whereYouAre);
  }
  return c;
}

/** Poll a gh-run query until it reports a completed conclusion. */
async function waitForRun(label: string, listArgs: string[], timeoutMin = 15): Promise<void> {
  const deadline = Date.now() + timeoutMin * 60_000;
  while (Date.now() < deadline) {
    const c = sh(["gh", "run", "list", ...listArgs, "--json", "status,conclusion", "--jq", ".[0] | (.status + \" \" + (.conclusion // \"\"))"]);
    const state = c.stdout.trim();
    if (state === "completed success") { pass(`${label} green`); return; }
    if (state.startsWith("completed")) die(`${label}: ${state}`, `the ${label} run failed on GitHub: open it with: gh run list ${listArgs.join(" ")}`);
    await Bun.sleep(15_000);
  }
  die(`${label}: no green run within ${timeoutMin} minutes`, `check gh run list ${listArgs.join(" ")} and resume by hand`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    console.log("usage: bun Tools/Release.ts patch|minor|major|X.Y.Z [--dry-run] [--fast]");
    console.log("  --dry-run   run every check, print the plan, write and push nothing");
    console.log("  --fast      ReleaseCheck deterministic half only (skips live model probes)");
    return;
  }
  if ("error" in parsed) { console.error(parsed.error); process.exit(1); }
  const opts = parsed;

  step("preflight");
  const branch = must(sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]), "git branch lookup").stdout.trim();
  if (branch !== "main") die(`releases ship from main, not "${branch}"`);
  if (must(sh(["git", "status", "--porcelain"]), "git status").stdout.trim() !== "") {
    die("working tree is not clean: commit or stash first, so the release commit holds only VERSION + CHANGELOG + skill version bumps");
  }
  must(sh(["git", "fetch", "origin", "main"]), "git fetch");
  if (must(sh(["git", "rev-list", "--count", "HEAD..origin/main"]), "git rev-list").stdout.trim() !== "0") {
    die("local main is behind origin/main: git pull first");
  }
  must(sh(["gh", "auth", "status"]), "gh auth status (is the GitHub CLI logged in?)");

  const current = readFileSync(path.join(REPO, "VERSION"), "utf8").trim();
  let next: string;
  let changelog: string;
  try {
    next = bumpVersion(current, opts.bump);
    changelog = retitleUnreleased(readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8"), next, localDate());
  } catch (e) {
    die((e as Error).message);
  }
  const notes = extractSection(changelog, next);
  pass(`plan: v${current} → v${next}, ${notes.split("\n").length} line(s) of release notes${opts.dryRun ? " (dry run)" : ""}`);

  step("gates");
  must(sh(["bun", "Tools/ContrabandCheck.ts"]), "ContrabandCheck");
  pass("contraband clean");
  must(sh(["bun", "Tools/PermissionRulesCheck.ts"]), "PermissionRulesCheck");
  pass("permission rules valid");
  must(sh(["bun", "Tools/TestCoverageCheck.ts"]), "TestCoverageCheck");
  pass("tool ⇔ test parity");
  const tests = must(sh(["bun", "test"]), "bun test");
  const summary = (tests.stderr + tests.stdout)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .filter((l) => /^\s*\d+ (pass|fail|skip)\b/.test(l))
    .map((l) => l.trim())
    .join(" · ");
  pass(summary || "bun test green");

  step("installed-system validation");
  must(sh(["./install.sh"]), "install.sh");
  pass("installed to ~/.myos");
  const rc = must(sh(["bun", "Tools/ReleaseCheck.ts", ...(opts.fast ? ["--health"] : [])]), "ReleaseCheck");
  pass(rc.stdout.trim().split("\n").at(-1) ?? "ReleaseCheck green");

  if (opts.dryRun) {
    console.log(`\n✅ dry run complete: v${next} is ready to ship. Release notes preview:\n`);
    console.log(notes.split("\n").slice(0, 12).join("\n"));
    return;
  }

  step(`version → ${next}`);
  writeFileSync(path.join(REPO, "VERSION"), `${next}\n`);
  writeFileSync(path.join(REPO, "CHANGELOG.md"), changelog);
  if (!extractSection(readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8"), next)) {
    die("CHANGELOG re-head produced an empty extraction: aborting before commit");
  }
  pass(`VERSION + CHANGELOG heading "## ${next} (${localDate()})"`);
  // Skill frontmatter versions move with the skills: bump everything changed
  // since the tag this release supersedes (added files → minor, edits → patch).
  const sv = must(sh(["bun", "Tools/SkillVersionBump.ts", "--since", `v${current}`]), "SkillVersionBump");
  pass(sv.stdout.trim().split("\n").at(-1) ?? "skill versions current");

  step("ship");
  must(sh(["git", "commit", "-am", `release: v${next}`]), "git commit");
  must(sh(["git", "push"]), "git push", "VERSION/CHANGELOG are committed locally but not pushed: push by hand");
  const sha = must(sh(["git", "rev-parse", "HEAD"]), "git rev-parse").stdout.trim();
  pass(`pushed ${sha.slice(0, 7)} (release: v${next})`);
  await waitForRun("CI", ["--commit", sha]);
  must(sh(["git", "tag", `v${next}`]), "git tag");
  must(sh(["git", "push", "origin", `v${next}`]), "tag push",
    `the release commit is on main and CI is green, but the v${next} tag did not push: push it by hand`);
  pass(`tag v${next} pushed (the release act)`);
  await waitForRun("release workflow", ["--workflow=release.yml", "--commit", sha]);
  const view = must(sh(["gh", "release", "view", `v${next}`, "--json", "tagName,isDraft,publishedAt"]),
    "gh release view", "the workflow went green but the release is not visible: check GitHub");
  const release = JSON.parse(view.stdout) as { tagName: string; isDraft: boolean; publishedAt: string };
  if (release.isDraft) die(`v${next} exists but is still a draft`);
  pass(`GitHub release published: ${release.tagName} at ${release.publishedAt}`);

  step("sync local install");
  must(sh(["./install.sh"]), "install.sh");
  const installed = readFileSync(path.join(process.env.HOME ?? "", ".myos", "MYOS", "VERSION"), "utf8").trim();
  if (installed !== next) die(`~/.myos/MYOS/VERSION is ${installed}, expected ${next}`);
  pass(`~/.myos is on ${installed}`);

  console.log(`\n✅ v${next} released. PMs upgrade with: git fetch --tags && git checkout v${next} && ./install.sh`);
}

if (import.meta.main) {
  await main();
}
