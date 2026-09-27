#!/usr/bin/env bun
/**
 * SkillVersionBump.ts: keep skill frontmatter `version:` fields honest.
 *
 * Skills carry a semver in their SKILL.md frontmatter, but nothing moved it
 * when a skill changed: everything authored for myos sat at its birth version
 * forever. This tool bumps every skill whose directory changed:
 *
 *   files added to an existing skill  → minor bump (new capability)
 *   modifications / deletions only    → patch bump
 *   skill absent at the reference     → left alone (its authored version stands)
 *   major                             → a human decision, edit the frontmatter
 *
 * Modes:
 *   bun Tools/SkillVersionBump.ts [--since <ref>] [--dry-run]
 *       Bump against one reference (default: the latest v* tag). Release.ts
 *       runs this in its version step, so bumps ride in the release commit.
 *   bun Tools/SkillVersionBump.ts --backfill [--dry-run]
 *       Replay every v* tag pair and accumulate the bumps each skill earned
 *       across the release history. One-time catch-up for stuck versions.
 *
 * No tags → clean no-op (fresh repos have nothing to compare against).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..");
const SKILLS = "payload/skills";

// ─────────── Pure helpers (tested directly) ───────────

export function bumpSemver(version: string, kind: "patch" | "minor"): string {
  const parts = version.trim().split(".").map((p) => Number(p) || 0);
  while (parts.length < 3) parts.push(0);
  const [major, minor, patch] = parts;
  return kind === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/** Decide a bump from git name-status letters for one skill dir. */
export function decideBump(statuses: string[]): "minor" | "patch" | null {
  if (statuses.length === 0) return null;
  return statuses.some((s) => s.startsWith("A")) ? "minor" : "patch";
}

export function readFrontmatterVersion(text: string): string | null {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const m = (fm ? fm[1] : "").match(/^version:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

export function setFrontmatterVersion(text: string, version: string): string {
  if (/^version:\s*\S+\s*$/m.test(text.slice(0, text.indexOf("\n---", 4) + 4))) {
    return text.replace(/^version:\s*\S+\s*$/m, `version: ${version}`);
  }
  return text.replace(/^(---\nname:[^\n]*\n)/, `$1version: ${version}\n`);
}

// ─────────── Git plumbing ───────────

function git(args: string[]): { ok: boolean; stdout: string } {
  const proc = Bun.spawnSync(["git", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  return { ok: proc.exitCode === 0, stdout: proc.stdout.toString() };
}

function tags(): string[] {
  const out = git(["tag", "-l", "v*"]);
  if (!out.ok) return [];
  return out.stdout
    .split("\n")
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .sort((a, b) => {
      const pa = a.slice(1).split(".").map(Number);
      const pb = b.slice(1).split(".").map(Number);
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
}

interface DirChange {
  statuses: string[];
  files: string[];
}

/** name-status per skill for changes between two refs (to = "" means worktree HEAD). */
function skillChanges(from: string, to: string): Map<string, DirChange> {
  const range = to ? [from, to] : [from, "HEAD"];
  const out = git(["diff", "--name-status", ...range, "--", SKILLS]);
  const bySkill = new Map<string, DirChange>();
  if (!out.ok) return bySkill;
  for (const line of out.stdout.split("\n")) {
    const m = line.match(/^([A-Z]\d*)\t(?:[^\t]+\t)?payload\/skills\/([^/]+)\/(.+)$/);
    if (!m) continue;
    const c = bySkill.get(m[2]) ?? { statuses: [], files: [] };
    c.statuses.push(m[1]);
    c.files.push(m[3]);
    bySkill.set(m[2], c);
  }
  return bySkill;
}

/**
 * A diff whose only content is the frontmatter version line is this tool's own
 * previous output, not a skill change; counting it would patch-bump every skill
 * on every release forever.
 */
function versionOnlyChange(from: string, to: string, skill: string): boolean {
  const range = to ? [from, to] : [from, "HEAD"];
  const out = git(["diff", ...range, "--", `${SKILLS}/${skill}/SKILL.md`]);
  if (!out.ok) return false;
  const content = out.stdout.split("\n").filter((l) => /^[+-]/.test(l) && !/^[+-]{3}/.test(l));
  return content.length > 0 && content.every((l) => /^[+-]version:\s*\S+\s*$/.test(l));
}

function effectiveBump(change: DirChange, from: string, to: string, skill: string): "minor" | "patch" | null {
  const kind = decideBump(change.statuses);
  if (!kind) return null;
  if (change.files.every((f) => f === "SKILL.md") && versionOnlyChange(from, to, skill)) return null;
  return kind;
}

function existedAt(ref: string, skill: string): boolean {
  return git(["cat-file", "-e", `${ref}:${SKILLS}/${skill}/SKILL.md`]).ok;
}

function versionAt(ref: string, skill: string): string | null {
  const out = git(["show", `${ref}:${SKILLS}/${skill}/SKILL.md`]);
  return out.ok ? readFrontmatterVersion(out.stdout) : null;
}

// ─────────── Modes ───────────

interface Change {
  skill: string;
  from: string;
  to: string;
  kind: string;
}

function currentSkills(): string[] {
  return readdirSync(path.join(REPO, SKILLS), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function planSince(ref: string): Change[] {
  const changes: Change[] = [];
  for (const [skill, change] of skillChanges(ref, "")) {
    if (!existedAt(ref, skill)) continue; // new skill: authored version stands
    const kind = effectiveBump(change, ref, "", skill);
    if (!kind) continue;
    const file = path.join(REPO, SKILLS, skill, "SKILL.md");
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // skill dir changed but is gone from the worktree
    }
    const from = readFrontmatterVersion(text) ?? "1.0.0";
    changes.push({ skill, from, to: bumpSemver(from, kind), kind });
  }
  return changes;
}

export function planBackfill(allTags: string[]): Change[] {
  const changes: Change[] = [];
  for (const skill of currentSkills()) {
    const firstIdx = allTags.findIndex((t) => existedAt(t, skill));
    if (firstIdx === -1) continue; // never released yet
    let version = versionAt(allTags[firstIdx], skill) ?? "1.0.0";
    const from = version;
    const hops: string[] = [...allTags.slice(firstIdx), ""]; // "" = worktree HEAD
    let kindSeen = "";
    for (let i = 0; i + 1 < hops.length; i++) {
      const change = skillChanges(hops[i], hops[i + 1]).get(skill) ?? { statuses: [], files: [] };
      const kind = effectiveBump(change, hops[i], hops[i + 1], skill);
      if (kind) {
        version = bumpSemver(version, kind);
        kindSeen = kindSeen ? "mixed" : kind;
      }
    }
    if (version !== from) changes.push({ skill, from, to: version, kind: kindSeen });
  }
  return changes;
}

export function apply(changes: Change[], dryRun: boolean): void {
  for (const c of changes) {
    const file = path.join(REPO, SKILLS, c.skill, "SKILL.md");
    if (!dryRun) writeFileSync(file, setFrontmatterVersion(readFileSync(file, "utf8"), c.to));
    console.log(`  ${c.skill.padEnd(24)} ${c.from} → ${c.to} (${c.kind})`);
  }
  console.log(`${changes.length} skill version(s) ${dryRun ? "would be " : ""}bumped`);
}

// ─────────── CLI ───────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const sinceIdx = args.indexOf("--since");
  const allTags = tags();

  if (args.includes("--backfill")) {
    if (allTags.length === 0) {
      console.log("0 skill version(s) bumped (no v* tags to replay)");
      process.exit(0);
    }
    apply(planBackfill(allTags), dryRun);
  } else {
    const ref = sinceIdx >= 0 ? args[sinceIdx + 1] : allTags.at(-1);
    if (!ref) {
      console.log("0 skill version(s) bumped (no reference tag yet)");
      process.exit(0);
    }
    if (!git(["rev-parse", "--verify", `${ref}^{commit}`]).ok) {
      console.error(`SkillVersionBump: unknown ref "${ref}"`);
      process.exit(1);
    }
    apply(planSince(ref), dryRun);
  }
}
