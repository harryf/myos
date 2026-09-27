#!/usr/bin/env bun
/**
 * ISASync.hook.ts (PostToolUse Write|Edit|MultiEdit): mirrors an ISA's
 * frontmatter and claims into MEMORY/STATE/work.json, the session registry the
 * ISA gates and LoadContext read.
 *
 * Both ISA homes count (MYOS/DOCUMENTATION/IsaFormat.md):
 *   - task ISA:    MYOS/MEMORY/WORK/<slug>/ISA.md (legacy PRD.md too)
 *   - project ISA: <project>/ISA.md anywhere else; without a `slug:` it is
 *                  keyed `project-<dirname>`
 * A Read of a task ISA only bumps that slug's heartbeat; it never writes.
 * Prints {"continue":true} and exits 0 on every path.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  ARTIFACT_FILENAME,
  LEGACY_ARTIFACT_FILENAME,
  bumpLastToolActivityBySlug,
  parseFrontmatter,
  syncToWorkJson,
} from "./lib/isa-utils";

const WORK_SEGMENT = "MEMORY/WORK/";

/** The ISA's home, or null when the path is not an ISA. */
export function isaHome(filePath: string): "task" | "project" | null {
  const name = basename(filePath);
  if (filePath.includes(WORK_SEGMENT)) {
    return name === ARTIFACT_FILENAME || name === LEGACY_ARTIFACT_FILENAME ? "task" : null;
  }
  return name === ARTIFACT_FILENAME ? "project" : null;
}

export function projectSlug(isaPath: string): string {
  const dir = basename(dirname(isaPath)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `project-${dir || "root"}`;
}

function main(): void {
  let input: any;
  try {
    input = JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    return;
  }
  const filePath: string = input?.tool_input?.file_path || "";
  const home = isaHome(filePath);
  if (!home) return;

  if (input.tool_name === "Read") {
    const slug = filePath.match(/MEMORY\/WORK\/([^/]+)\//)?.[1];
    if (slug) bumpLastToolActivityBySlug(slug, input.session_id);
    return;
  }

  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  const fm = parseFrontmatter(content);
  if (!fm) return;
  if (!fm.slug && home === "project") fm.slug = projectSlug(filePath);
  syncToWorkJson(fm, filePath, content, input.session_id);
}

try {
  main();
} catch {
  /* a registry sync must never break a tool call */
}
console.log(JSON.stringify({ continue: true }));
process.exit(0);
