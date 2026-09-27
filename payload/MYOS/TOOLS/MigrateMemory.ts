#!/usr/bin/env bun
/**
 * MigrateMemory: copy Harry's memories from the pai install into myos, once.
 *
 *   bun MigrateMemory.ts --from-pai [--dry-run] [--source <dir>]
 *
 * Source: --source, else $MYOS_PAI_SOURCE, else ~/.claude-personal.
 * Target: $MYOS_DIR, else $CLAUDE_CONFIG_DIR/MYOS, else ~/.myos/MYOS. The target
 * must be an installed tree (MYOS/VERSION present), so a stray run can never
 * create a myos dir by accident.
 *
 * What moves (copies only; the source is never modified, moved or deleted):
 *   PAI/MEMORY/WORK/<dir>/           -> MEMORY/WORK/<dir>/  byte for byte, every
 *                                        file in the dir; a dir already in the
 *                                        target is skipped whole (idempotent)
 *   PAI/MEMORY/KNOWLEDGE/            -> MEMORY/KNOWLEDGE/   file by file, never
 *                                        overwriting
 *   PAI/MEMORY/STATE/work.json,      -> MEMORY/STATE/       copied when absent;
 *     session-names.json                                    merged when present
 *                                        (a source row is added only when the
 *                                        target has no row under that key)
 *   PAI/USER/PROJECTS/PROJECTS.md    -> USER/PROJECTS.md plus USER/PROJECTS/<slug>.md
 *                                        through SplitProjects
 * Never copied: symlinks, .DS_Store, and literal `${HOME}` / `$HOME` dirs (a
 * shell-expansion artifact some pai hooks left inside WORK dirs).
 *
 * Then a path audit (lines in the migrated files naming `.claude-personal` or a
 * `/Users/<name>/.claude` path; expected 0, reported only), then the one time
 * MyTokens sync over the pai transcripts when the skill is installed.
 * --dry-run prints the same plan and counts and writes nothing.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { applySplit, splitProjects } from "./SplitProjects";

const HOME = process.env.HOME || homedir();
const NEVER_COPY = new Set([".DS_Store", "${HOME}", "$HOME"]);
const STATE_FILES = ["work.json", "session-names.json"];
export const AUDIT_PATTERN = /\.claude-personal|\/Users\/[^/\s]+\/\.claude\b/;

export interface Options {
  source: string;
  myosDir: string;
  dryRun: boolean;
  /** YYYY-MM-DD stamped into per-project files. */
  date: string;
  /** Skip the MyTokens sync (tests that do not install the skill). */
  skipTokens?: boolean;
}

export interface Counts {
  workCopied: number;
  workSkipped: number;
  workFiles: number;
  knowledgeCopied: number;
  knowledgeSkipped: number;
  stateCopied: number;
  stateMerged: number;
  stateRowsAdded: number;
  stateUnchanged: number;
  projectsWritten: number;
  projectsUnchanged: number;
  projectsKeptEdited: string[];
  projectsIndexBytes: number;
  neverCopied: number;
  auditLines: number;
  auditFiles: string[];
  tokens: string;
}

function expand(p: string): string {
  return p.replace(/^~(?=\/|$)/, HOME).replace(/^\$HOME(?=\/|$)/, HOME);
}

export function defaultMyosDir(): string {
  if (process.env.MYOS_DIR) return expand(process.env.MYOS_DIR);
  return join(expand(process.env.CLAUDE_CONFIG_DIR || join(HOME, ".myos")), "MYOS");
}

/** Files under dir (relative), skipping symlinks and the never-copy names. */
function listFiles(dir: string, counts: Counts, base: string = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (NEVER_COPY.has(name)) { counts.neverCopied++; continue; }
    const st = lstatSync(full);
    if (st.isSymbolicLink()) { counts.neverCopied++; continue; }
    if (st.isDirectory()) out.push(...listFiles(full, counts, base));
    else if (st.isFile()) out.push(relative(base, full));
  }
  return out;
}

function copyFile(from: string, to: string, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/** Add source rows whose key the target lacks. work.json nests rows under `sessions`. */
export function mergeRows(target: Record<string, any>, source: Record<string, any>): number {
  let added = 0;
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (existing === undefined) {
      target[key] = value;
      added++;
    } else if (key === "sessions" && isRecord(existing) && isRecord(value)) {
      added += mergeRows(existing, value);
    }
  }
  return added;
}

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function auditFile(path: string, counts: Counts, label: string): void {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return; }
  if (text.includes("\u0000")) return; // binary
  const hits = text.split("\n").filter((line) => AUDIT_PATTERN.test(line)).length;
  if (hits > 0) {
    counts.auditLines += hits;
    counts.auditFiles.push(`${label} (${hits})`);
  }
}

export function migrate(opts: Options): Counts {
  const counts: Counts = {
    workCopied: 0, workSkipped: 0, workFiles: 0, knowledgeCopied: 0, knowledgeSkipped: 0,
    stateCopied: 0, stateMerged: 0, stateRowsAdded: 0, stateUnchanged: 0,
    projectsWritten: 0, projectsUnchanged: 0, projectsKeptEdited: [], projectsIndexBytes: 0,
    neverCopied: 0, auditLines: 0, auditFiles: [], tokens: "not run",
  };
  const srcMemory = join(opts.source, "PAI", "MEMORY");
  const dstMemory = join(opts.myosDir, "MEMORY");

  // WORK: whole dirs, skipped when present.
  const srcWork = join(srcMemory, "WORK");
  if (existsSync(srcWork)) {
    for (const name of readdirSync(srcWork).sort()) {
      const from = join(srcWork, name);
      const st = lstatSync(from);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      const files = listFiles(from, counts);
      for (const rel of files) auditFile(join(from, rel), counts, `WORK/${name}/${rel}`);
      const to = join(dstMemory, "WORK", name);
      if (existsSync(to)) { counts.workSkipped++; continue; }
      if (!opts.dryRun) mkdirSync(to, { recursive: true });
      for (const rel of files) copyFile(join(from, rel), join(to, rel), opts.dryRun);
      counts.workCopied++;
      counts.workFiles += files.length;
    }
  }

  // KNOWLEDGE: file by file, never overwriting.
  const srcKnowledge = join(srcMemory, "KNOWLEDGE");
  if (existsSync(srcKnowledge)) {
    for (const rel of listFiles(srcKnowledge, counts)) {
      const from = join(srcKnowledge, rel);
      auditFile(from, counts, `KNOWLEDGE/${rel}`);
      const to = join(dstMemory, "KNOWLEDGE", rel);
      if (existsSync(to)) { counts.knowledgeSkipped++; continue; }
      copyFile(from, to, opts.dryRun);
      counts.knowledgeCopied++;
    }
  }

  // STATE: copy when absent, merge rows when present.
  for (const name of STATE_FILES) {
    const from = join(srcMemory, "STATE", name);
    if (!existsSync(from)) continue;
    auditFile(from, counts, `STATE/${name}`);
    const to = join(dstMemory, "STATE", name);
    if (!existsSync(to)) {
      copyFile(from, to, opts.dryRun);
      counts.stateCopied++;
      continue;
    }
    let source: unknown, target: unknown;
    try {
      source = JSON.parse(readFileSync(from, "utf8"));
      target = JSON.parse(readFileSync(to, "utf8"));
    } catch {
      throw new Error(`STATE/${name}: not valid JSON on one side, so it was not merged (nothing written for it)`);
    }
    if (!isRecord(source) || !isRecord(target)) {
      throw new Error(`STATE/${name}: expected a JSON object on both sides`);
    }
    const added = mergeRows(target, source);
    if (added === 0) { counts.stateUnchanged++; continue; }
    if (!opts.dryRun) writeFileSync(to, `${JSON.stringify(target, null, 2)}\n`);
    counts.stateMerged++;
    counts.stateRowsAdded += added;
  }

  // PROJECTS: index plus one file per project.
  const projects = join(opts.source, "PAI", "USER", "PROJECTS", "PROJECTS.md");
  if (existsSync(projects)) {
    auditFile(projects, counts, "USER/PROJECTS/PROJECTS.md");
    const report = applySplit(splitProjects(readFileSync(projects, "utf8"), opts.date), join(opts.myosDir, "USER"), { dryRun: opts.dryRun });
    counts.projectsWritten = report.written.length;
    counts.projectsUnchanged = report.unchanged.length;
    counts.projectsKeptEdited = report.keptEdited;
    counts.projectsIndexBytes = report.indexBytes;
  }

  // MyTokens: one pass over the pai transcripts.
  const configDir = dirname(opts.myosDir);
  const tokenLog = join(configDir, "skills", "MyTokens", "Tools", "TokenLog.ts");
  const transcripts = join(opts.source, "projects");
  if (opts.skipTokens) {
    counts.tokens = "skipped (--no-tokens)";
  } else if (!existsSync(tokenLog)) {
    counts.tokens = "skipped: the MyTokens skill is not installed";
  } else if (!existsSync(transcripts)) {
    counts.tokens = `skipped: no transcripts at ${transcripts}`;
  } else if (opts.dryRun) {
    counts.tokens = `would run TokenLog sync over ${transcripts}`;
  } else {
    const res = spawnSync(process.execPath, [tokenLog, "sync"], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, MYOS_DIR: opts.myosDir, MYOS_TOKENLOG_PROJECTS: transcripts },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    counts.tokens = res.status === 0
      ? `synced (${(res.stdout || "").trim().split("\n").pop() || "ok"})`
      : `FAILED (exit ${res.status}): ${(res.stderr || "").trim().split("\n").pop()}`;
  }

  return counts;
}

function arg(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const USAGE = "Usage: bun MigrateMemory.ts --from-pai [--dry-run] [--source <dir>]";

function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); return 0; }
  if (!argv.includes("--from-pai")) { console.error(USAGE); return 2; }
  const dryRun = argv.includes("--dry-run");
  const source = resolve(expand(arg(argv, "--source") ?? process.env.MYOS_PAI_SOURCE ?? join(HOME, ".claude-personal")));
  const myosDir = resolve(defaultMyosDir());
  const date = new Date().toISOString().slice(0, 10);

  if (!existsSync(join(source, "PAI"))) {
    console.error(`MigrateMemory: no pai install at ${source} (expected ${join(source, "PAI")}). Use --source <dir>.`);
    return 1;
  }
  if (!existsSync(join(myosDir, "VERSION"))) {
    console.error(`MigrateMemory: ${myosDir} is not an installed myos tree (no VERSION). Run install.sh first.`);
    return 1;
  }
  if (resolve(source) === resolve(dirname(myosDir))) {
    console.error("MigrateMemory: source and target are the same install: nothing to do.");
    return 1;
  }

  const tag = dryRun ? "[dry-run] " : "";
  const would = dryRun ? "would copy" : "copied";
  console.log(`${tag}Migrating from: ${source}`);
  console.log(`${tag}Migrating to:   ${myosDir}`);
  let c: Counts;
  try {
    c = migrate({ source, myosDir, dryRun, date, skipTokens: argv.includes("--no-tokens") });
  } catch (e) {
    console.error(`MigrateMemory: ${(e as Error).message}`);
    return 1;
  }
  console.log(`  WORK:      ${would} ${c.workCopied} dir(s) (${c.workFiles} files), ${c.workSkipped} already present`);
  console.log(`  KNOWLEDGE: ${would} ${c.knowledgeCopied} file(s), ${c.knowledgeSkipped} already present`);
  console.log(`  STATE:     ${would} ${c.stateCopied} file(s), merged ${c.stateMerged} (${c.stateRowsAdded} new rows), ${c.stateUnchanged} unchanged`);
  console.log(`  PROJECTS:  ${dryRun ? "would write" : "wrote"} ${c.projectsWritten} file(s), ${c.projectsUnchanged} unchanged, index ${c.projectsIndexBytes} bytes`);
  for (const rel of c.projectsKeptEdited) console.log(`             left alone (differs, maybe edited): USER/${rel}`);
  console.log(`  never copied (symlinks, .DS_Store, literal $HOME dirs): ${c.neverCopied}`);
  console.log(`  path audit: ${c.auditLines} line(s) naming .claude-personal or a /Users/<name>/.claude path (expected 0)`);
  for (const f of c.auditFiles.slice(0, 10)) console.log(`             ${f}`);
  console.log(`  MyTokens:  ${c.tokens}`);
  console.log(`${tag}Source install was not modified.`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
