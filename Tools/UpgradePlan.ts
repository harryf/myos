#!/usr/bin/env bun

/**
 * UpgradePlan.ts: the installer's eyes.
 *
 * install.sh replaces managed trees wholesale (rm -rf + cp). That is correct for
 * a release upgrade and wrong for anything a PM put there by hand, so before any
 * copying happens the installer asks this tool: what exactly is about to change,
 * and which of it did the user write?
 *
 * The three questions it answers:
 *   1. What will be created, replaced, or deleted (per managed area)?
 *   2. Which of those files did the USER write or edit, rather than a past
 *      install? Those are the only genuinely at-risk files.
 *   3. Where were they backed up?
 *
 * Provenance comes from a manifest ($MYOS_HOME/.install-manifest.json) recording
 * the sha256 of every managed file as the installer last wrote it:
 *
 *   target == manifest, source differs  -> release change, replace silently
 *   target != manifest                  -> user edited it, back it up and say so
 *   no manifest entry, in replace area  -> user added it, back it up and say so
 *   no manifest at all (pre-0.2.0)      -> provenance unknown, back everything up
 *
 * The area table below MIRRORS install.sh. Change one, change the other: a
 * managed path missing here is a path the installer can delete without warning.
 *
 * Usage:
 *   bun Tools/UpgradePlan.ts --repo DIR --home DIR [--backup-dir DIR] [--quiet]
 *   bun Tools/UpgradePlan.ts --repo DIR --home DIR --write-manifest VERSION
 */

import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  statSync, writeFileSync,
} from "node:fs";
import path from "node:path";

const MANIFEST_NAME = ".install-manifest.json";

/** Never copied by the installer, so never compared or backed up. */
const IGNORED_NAMES = new Set([".DS_Store", "node_modules", "bun.lock", ".git"]);

/**
 * How the installer treats an area:
 *  - replace: rm -rf target then copy source. Target-only files are DELETED.
 *  - overlay: copy source over target, additive. Target-only files SURVIVE
 *             (this is what keeps _GIGSPM/CONF.md and other user files alive).
 *  - file:    a single file copied over a single destination.
 */
type AreaMode = "replace" | "overlay" | "file";

type Area = { label: string; source: string; target: string; mode: AreaMode };

type Klass =
  | "create"       // source only -> will be created
  | "release"      // differs, but target matches the manifest -> a release change
  | "unchanged"    // byte-identical to the shipped file
  | "userEdited"   // differs from the manifest -> the user changed it
  | "userAdded"    // no manifest entry, sits in a replace area -> will be deleted
  | "orphan"       // was ours, dropped from this release -> will be deleted
  | "kept";        // target-only in an overlay area -> untouched, no risk

type Item = { area: string; rel: string; klass: Klass; target: string };

type Manifest = { version?: string; writtenAt?: string; files?: Record<string, string> };

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Relative paths of every file under dir, recursively. Empty if dir is absent. */
function walk(dir: string, base: string = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (IGNORED_NAMES.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

function sameContent(a: string, b: string): boolean {
  try { return readFileSync(a).equals(readFileSync(b)); } catch { return false; }
}

/**
 * The managed-area table, mirroring install.sh step for step. `repo` is the
 * checkout root, `home` is $MYOS_HOME.
 */
function buildAreas(repo: string, home: string): Area[] {
  const payload = path.join(repo, "payload");
  const areas: Area[] = [];

  // [2] skills: _-prefixed ship additively so user files survive; the rest are replaced.
  const skillsRoot = path.join(payload, "skills");
  if (existsSync(skillsRoot)) {
    for (const name of readdirSync(skillsRoot).sort()) {
      if (IGNORED_NAMES.has(name)) continue;
      if (!statSync(path.join(skillsRoot, name)).isDirectory()) continue;
      areas.push({
        label: `skills/${name}`,
        source: path.join(skillsRoot, name),
        target: path.join(home, "skills", name),
        mode: name.startsWith("_") ? "overlay" : "replace",
      });
    }
  }

  // [3] agents and commands: individual .md copies, nothing is deleted.
  for (const dir of ["agents", "commands"]) {
    const src = path.join(payload, dir);
    if (!existsSync(src)) continue;
    for (const name of readdirSync(src).sort()) {
      if (!name.endsWith(".md")) continue;
      areas.push({
        label: dir,
        source: path.join(src, name),
        target: path.join(home, dir, name),
        mode: "file",
      });
    }
  }

  // [3] hooks: whole tree replaced.
  areas.push({
    label: "hooks",
    source: path.join(payload, "hooks"),
    target: path.join(home, "hooks"),
    mode: "replace",
  });

  // [4] MYOS/* except MEMORY and USER: both are user owned trees; the payload ships a USER scaffold that install.sh copies only when a file is absent.
  const myosRoot = path.join(payload, "MYOS");
  if (existsSync(myosRoot)) {
    for (const name of readdirSync(myosRoot).sort()) {
      if (IGNORED_NAMES.has(name) || name === "MEMORY" || name === "USER") continue;
      const src = path.join(myosRoot, name);
      areas.push({
        label: `MYOS/${name}`,
        source: src,
        target: path.join(home, "MYOS", name),
        mode: statSync(src).isDirectory() ? "replace" : "file",
      });
    }
  }

  // [4] MYOS/VERSION comes from the repo root, not the payload.
  areas.push({
    label: "MYOS/VERSION",
    source: path.join(repo, "VERSION"),
    target: path.join(home, "MYOS", "VERSION"),
    mode: "file",
  });

  // [5] top-level docs, and [8] the launcher.
  const singles: Array<[string, string]> = [
    [path.join(payload, "CLAUDE.md"), path.join(home, "CLAUDE.md")],
    [path.join(repo, "docs", "INVENTORY.md"), path.join(home, "INVENTORY.md")],
    [path.join(payload, "HOME_README.md"), path.join(home, "README.md")],
    [path.join(payload, "package.json"), path.join(home, "package.json")],
    [path.join(repo, "bin", "myos"), path.join(home, "bin", "myos")],
  ];
  for (const [source, target] of singles) {
    areas.push({ label: path.relative(home, target), source, target, mode: "file" });
  }

  return areas;
}

function classify(areas: Area[], home: string, manifest: Manifest | null): Item[] {
  const known = manifest?.files ?? {};
  const haveManifest = manifest !== null;
  const items: Item[] = [];

  const judgeExisting = (rel: string, target: string, source: string): Klass => {
    if (sameContent(source, target)) return "unchanged";
    const recorded = known[rel];
    if (!haveManifest) return "userEdited";      // provenance unknown: assume the user's
    if (recorded === undefined) return "userAdded";
    return recorded === sha256(target) ? "release" : "userEdited";
  };

  for (const area of areas) {
    if (area.mode === "file") {
      if (!existsSync(area.source)) continue;
      const rel = path.relative(home, area.target);
      items.push({
        area: area.label,
        rel,
        klass: existsSync(area.target) ? judgeExisting(rel, area.target, area.source) : "create",
        target: area.target,
      });
      continue;
    }

    const sourceFiles = new Set(walk(area.source));
    const targetFiles = walk(area.target);

    for (const sub of sourceFiles) {
      const target = path.join(area.target, sub);
      const rel = path.relative(home, target);
      items.push({
        area: area.label,
        rel,
        klass: existsSync(target)
          ? judgeExisting(rel, target, path.join(area.source, sub))
          : "create",
        target,
      });
    }

    for (const sub of targetFiles) {
      if (sourceFiles.has(sub)) continue;
      const target = path.join(area.target, sub);
      const rel = path.relative(home, target);
      if (area.mode === "overlay") {
        items.push({ area: area.label, rel, klass: "kept", target });
        continue;
      }
      // A replace area is about to delete this file. Was it ours to delete?
      const wasOurs = haveManifest && known[rel] !== undefined;
      items.push({ area: area.label, rel, klass: wasOurs ? "orphan" : "userAdded", target });
    }
  }

  return items;
}

/** Classes whose current content would be lost, so it gets copied out first. */
const AT_RISK: ReadonlySet<Klass> = new Set<Klass>(["userEdited", "userAdded"]);

function backup(items: Item[], home: string, backupDir: string): string[] {
  const saved: string[] = [];
  for (const item of items) {
    if (!AT_RISK.has(item.klass)) continue;
    if (!existsSync(item.target)) continue;
    const dest = path.join(backupDir, item.rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(item.target, dest);
    saved.push(item.rel);
  }
  return saved;
}

function pad(n: number): string {
  return String(n).padStart(4, " ");
}

function report(items: Item[], manifest: Manifest | null, backupDir: string | null): void {
  const count = (k: Klass) => items.filter((i) => i.klass === k).length;
  const list = (k: Klass) => items.filter((i) => i.klass === k).map((i) => i.rel).sort();

  const w = (s: string) => process.stdout.write(`${s}\n`);

  w(`           ${pad(count("create"))} new file(s) from this release`);
  w(`           ${pad(count("release"))} file(s) updated by this release`);
  w(`           ${pad(count("unchanged"))} file(s) already up to date`);
  w(`           ${pad(count("kept"))} user file(s) inside additive skills, left alone`);
  if (count("orphan") > 0) {
    w(`           ${pad(count("orphan"))} file(s) dropped from this release, will be removed`);
  }

  const edited = list("userEdited");
  const added = list("userAdded");

  if (manifest === null && (edited.length > 0 || added.length > 0)) {
    w("");
    w("           NOTE: no install manifest found (install predates 0.2.0), so this");
    w("                 installer cannot tell your edits apart from earlier releases.");
    w("                 Everything that differs is treated as yours and backed up.");
  }

  for (const [label, entries] of [
    ["locally modified, will be replaced", edited],
    ["not from any release, will be removed", added],
  ] as Array<[string, string[]]>) {
    if (entries.length === 0) continue;
    w("");
    w(`           ${entries.length} file(s) ${label}:`);
    for (const rel of entries.slice(0, 20)) w(`             - ${rel}`);
    if (entries.length > 20) w(`             ... and ${entries.length - 20} more`);
  }

  if (backupDir !== null && (edited.length > 0 || added.length > 0)) {
    w("");
    w(`           backed up to: ${backupDir}`);
  } else if (backupDir === null && (edited.length > 0 || added.length > 0)) {
    w("");
    w("           (dry run: nothing copied, nothing backed up)");
  }
}

function readManifest(home: string): Manifest | null {
  const file = path.join(home, MANIFEST_NAME);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;   // corrupt manifest is the same as none: assume the user's
  }
}

/**
 * Record what we just wrote, so the NEXT upgrade can tell a release change from
 * a user edit. Hashes the installed file (not the source) so the manifest always
 * describes what is actually on disk.
 */
function writeManifest(areas: Area[], home: string, version: string): number {
  const files: Record<string, string> = {};
  for (const area of areas) {
    const targets = area.mode === "file"
      ? (existsSync(area.source) ? [area.target] : [])
      : [...walk(area.source)].map((sub) => path.join(area.target, sub));
    for (const target of targets) {
      if (!existsSync(target)) continue;
      files[path.relative(home, target)] = sha256(target);
    }
  }
  const manifest: Manifest = {
    version,
    writtenAt: new Date().toISOString(),
    files: Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]])),
  };
  writeFileSync(path.join(home, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return Object.keys(files).length;
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function main(argv: string[]): number {
  const repo = arg(argv, "--repo");
  const home = arg(argv, "--home");
  if (repo === undefined || home === undefined) {
    process.stderr.write("Usage: bun Tools/UpgradePlan.ts --repo DIR --home DIR " +
      "[--backup-dir DIR | --write-manifest VERSION]\n");
    return 2;
  }

  const areas = buildAreas(repo, home);
  const manifestVersion = arg(argv, "--write-manifest");

  if (manifestVersion !== undefined) {
    const n = writeManifest(areas, home, manifestVersion);
    if (!argv.includes("--quiet")) {
      process.stdout.write(`           recorded ${n} managed file(s) in ${MANIFEST_NAME}\n`);
    }
    return 0;
  }

  const items = classify(areas, home, readManifest(home));
  const backupDir = arg(argv, "--backup-dir") ?? null;
  if (backupDir !== null) backup(items, home, backupDir);
  report(items, readManifest(home), backupDir);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main(Bun.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
