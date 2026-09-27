#!/usr/bin/env bun
/**
 * SplitProjects: turn one long PROJECTS.md into a short index plus one history
 * file per project.
 *
 * Input shape (Harry's pai PROJECTS.md): a `# Projects` heading, a
 * `## Open Sessions to Resume` heading, then one bullet per project,
 *   - **Name (context...)**: long history...
 * optionally followed by indented continuation paragraphs (`  UPDATE ...`) that
 * belong to the same project.
 *
 * Output, under the user dir (default <MYOS_DIR>/USER):
 *   PROJECTS.md              the index: both headings, then one line per project
 *                            `- **Name**: <first sentence, max 160 chars> (see PROJECTS/<slug>.md)`
 *                            Budget: under 6,000 bytes (it is imported into every session).
 *   PROJECTS/<slug>.md       `# Name`, the full original text verbatim, then
 *                            `Source: PROJECTS.md, migrated <date>`.
 *
 * Deterministic and idempotent: the same input gives the same bytes (the date
 * line is ignored when comparing, so a rerun on another day is still a no-op).
 * A per-project file that differs from what would be generated is left alone
 * and reported: Harry may have edited it. The index is written when absent,
 * identical, or still the shipped scaffold; otherwise it is left alone too.
 *
 * Usage:
 *   bun SplitProjects.ts <PROJECTS.md> [--out <userDir>] [--date YYYY-MM-DD] [--dry-run] [--check]
 *     --dry-run  print the plan, write nothing
 *     --check    write nothing; exit 1 when the index would exceed the budget
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export const INDEX_BUDGET_BYTES = 6000;
export const SUMMARY_MAX_CHARS = 160;
export const SLUG_MAX_CHARS = 60;
/** The line the shipped scaffold PROJECTS.md carries, so a migration may replace it. */
export const SCAFFOLD_MARKER = "Scaffold: the first `install.sh --from-pai` replaces this file.";

export interface Project {
  name: string;
  slug: string;
  /** The bullet and its continuation lines, verbatim. */
  text: string;
  summary: string;
}

export interface Split {
  index: string;
  projects: Project[];
  /** path relative to the user dir -> file content */
  files: Map<string, string>;
}

const BULLET = /^- \*\*(.+?)\*\*:?\s*(.*)$/;

/** The display name: the bold text up to the first `(` or `:`. */
export function shortName(bold: string): string {
  const cut = bold.search(/[(:]/);
  const name = (cut === -1 ? bold : bold.slice(0, cut)).trim();
  return name || bold.trim();
}

/** Kebab case, ASCII only, at most 60 chars, never empty. */
export function slugify(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = ascii.slice(0, SLUG_MAX_CHARS).replace(/-+$/g, "");
  return cut || "project";
}

/** First sentence of the text after the bold name, at most 160 chars. */
export function firstSentence(rest: string): string {
  const flat = rest.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  let sentence = end === -1 ? flat : flat.slice(0, end + 1);
  if (sentence.length > SUMMARY_MAX_CHARS) {
    const room = SUMMARY_MAX_CHARS - 3;
    const space = sentence.lastIndexOf(" ", room);
    sentence = `${sentence.slice(0, space > room / 2 ? space : room).trimEnd()}...`;
  }
  return sentence;
}

export function splitProjects(input: string, date: string): Split {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const title = lines.find((l) => /^# /.test(l)) ?? "# Projects";
  const section = lines.find((l) => /^## /.test(l)) ?? "## Open Sessions to Resume";

  // Group lines into bullets: a bullet runs until the next bullet or heading;
  // indented and blank lines in between belong to it.
  const groups: Array<{ bold: string; rest: string; lines: string[] }> = [];
  let current: { bold: string; rest: string; lines: string[] } | null = null;
  for (const line of lines) {
    const bullet = line.match(BULLET);
    if (bullet) {
      current = { bold: bullet[1]!, rest: bullet[2]!, lines: [line] };
      groups.push(current);
    } else if (/^#{1,6} /.test(line)) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }

  const used = new Map<string, number>();
  const projects: Project[] = groups.map((g) => {
    const name = shortName(g.bold);
    const base = slugify(name);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    const slug = seen === 1 ? base : `${base.slice(0, SLUG_MAX_CHARS - String(seen).length - 1)}-${seen}`;
    while (g.lines.length > 1 && g.lines[g.lines.length - 1]!.trim() === "") g.lines.pop();
    return { name, slug, text: g.lines.join("\n"), summary: firstSentence(g.rest) };
  });

  const index = [
    title,
    "",
    section,
    "",
    ...projects.map((p) => `- **${p.name}**: ${p.summary} (see PROJECTS/${p.slug}.md)`),
    "",
  ].join("\n");

  const files = new Map<string, string>();
  files.set("PROJECTS.md", index);
  for (const p of projects) {
    files.set(`PROJECTS/${p.slug}.md`, `# ${p.name}\n\n${p.text}\n\nSource: PROJECTS.md, migrated ${date}\n`);
  }
  return { index, projects, files };
}

/** Same content apart from the migrated-date line. */
export function sameIgnoringDate(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/^Source: PROJECTS\.md, migrated \d{4}-\d{2}-\d{2}$/m, "Source: PROJECTS.md");
  return strip(a) === strip(b);
}

export interface ApplyReport {
  written: string[];
  unchanged: string[];
  /** Existing files that differ from the generated ones: left alone. */
  keptEdited: string[];
  indexBytes: number;
  overBudget: boolean;
}

export function applySplit(split: Split, userDir: string, opts: { dryRun?: boolean } = {}): ApplyReport {
  const report: ApplyReport = {
    written: [],
    unchanged: [],
    keptEdited: [],
    indexBytes: Buffer.byteLength(split.index),
    overBudget: Buffer.byteLength(split.index) >= INDEX_BUDGET_BYTES,
  };
  for (const [rel, content] of split.files) {
    const target = join(userDir, rel);
    if (existsSync(target)) {
      const existing = readFileSync(target, "utf8");
      const isScaffold = rel === "PROJECTS.md" && existing.includes(SCAFFOLD_MARKER);
      if (sameIgnoringDate(existing, content)) {
        report.unchanged.push(rel);
        continue;
      }
      if (!isScaffold) {
        report.keptEdited.push(rel);
        continue;
      }
    }
    if (!opts.dryRun) {
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content);
    }
    report.written.push(rel);
  }
  return report;
}

function defaultUserDir(): string {
  const home = process.env.HOME || homedir();
  if (process.env.MYOS_DIR) return join(process.env.MYOS_DIR, "USER");
  return join(process.env.CLAUDE_CONFIG_DIR || join(home, ".myos"), "MYOS", "USER");
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv: string[]): number {
  const input = argv.find((a, i) => !a.startsWith("--") && !["--out", "--date"].includes(argv[i - 1] ?? ""));
  if (!input || argv.includes("--help")) {
    console.error("Usage: bun SplitProjects.ts <PROJECTS.md> [--out <userDir>] [--date YYYY-MM-DD] [--dry-run] [--check]");
    return input ? 0 : 2;
  }
  if (!existsSync(input)) {
    console.error(`SplitProjects: ${input} not found`);
    return 2;
  }
  const date = arg(argv, "--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`SplitProjects: --date must be YYYY-MM-DD, got ${date}`);
    return 2;
  }
  const userDir = resolve(arg(argv, "--out") ?? defaultUserDir());
  const check = argv.includes("--check");
  const dryRun = argv.includes("--dry-run") || check;

  const split = splitProjects(readFileSync(input, "utf8"), date);
  const report = applySplit(split, userDir, { dryRun });
  const verb = dryRun ? "would write" : "wrote";
  console.log(`SplitProjects: ${split.projects.length} project(s) from ${input} into ${userDir}`);
  console.log(`  index ${report.indexBytes} bytes (budget ${INDEX_BUDGET_BYTES})${report.overBudget ? "  OVER BUDGET" : ""}`);
  console.log(`  ${verb} ${report.written.length}, unchanged ${report.unchanged.length}, left alone ${report.keptEdited.length}`);
  for (const rel of report.keptEdited) console.log(`  left alone (differs from the generated file, maybe edited): ${rel}`);
  if (check && report.overBudget) return 1;
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
