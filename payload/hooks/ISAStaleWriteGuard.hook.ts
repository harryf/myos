#!/usr/bin/env bun
/**
 * ISAStaleWriteGuard.hook.ts: stops a whole file Write from silently wiping
 * ISA changes this session never saw.
 *
 * Two entry points in one file, chosen by hook_event_name:
 *   PreToolUse  Write|Edit                 check: Write over a moved ISA fails
 *   PostToolUse Read|Write|Edit|MultiEdit  record: remember the hash this
 *                                          session now believes is on disk
 *
 * Edit is safe by construction (it replaces an exact string against what is
 * on disk), so only Write can fail. Not a lock: a crashed session leaves
 * nothing that blocks anyone. Legacy ISAs are exempt. Mode: lib/gates.ts
 * (off passes, log logs would-block to isa-gates.jsonl, block exits 2).
 * Fails open on every error.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateLog, gateMode, isLegacyIsa } from "./lib/gates";
import { ISA_LOG, isIsaPath } from "./lib/isa-gates";
import { parseFrontmatter } from "./lib/isa-utils";
import { myosPath } from "./lib/paths";

export const GATE = "ISAStaleWriteGuard";
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const stateDir = () => myosPath("MEMORY", "STATE", "isa-session-view");

function hashOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function viewFile(sessionId: string): string {
  return join(stateDir(), `${sessionId.replace(/[^A-Za-z0-9_-]/g, "")}.json`);
}

function readViews(sessionId: string): Record<string, string> {
  try {
    const f = viewFile(sessionId);
    if (!existsSync(f)) return {};
    const parsed = JSON.parse(readFileSync(f, "utf8"));
    return parsed && typeof parsed.views === "object" ? parsed.views : {};
  } catch {
    return {};
  }
}

function pruneStale(): void {
  try {
    const now = Date.now();
    for (const entry of readdirSync(stateDir())) {
      const p = join(stateDir(), entry);
      try { if (now - statSync(p).mtimeMs > PRUNE_AFTER_MS) rmSync(p, { force: true }); } catch { /* next */ }
    }
  } catch { /* best effort */ }
}

export function recordView(sessionId: string, filePath: string): void {
  try {
    if (!sessionId || !isIsaPath(filePath) || !existsSync(filePath)) return;
    mkdirSync(stateDir(), { recursive: true });
    const f = viewFile(sessionId);
    if (!existsSync(f)) pruneStale();
    const views = readViews(sessionId);
    views[filePath] = hashOf(readFileSync(filePath, "utf8"));
    writeFileSync(`${f}.tmp`, JSON.stringify({ session_id: sessionId, views, updated: new Date().toISOString() }));
    renameSync(`${f}.tmp`, f);
  } catch { /* a missing view fails open in check() */ }
}

/** The reason to refuse, or null to allow. */
export function check(input: any): string | null {
  try {
    if (input?.tool_name !== "Write") return null;
    const filePath = input?.tool_input?.file_path;
    if (!filePath || !isIsaPath(filePath) || !existsSync(filePath)) return null;
    const sessionId = input?.session_id;
    if (!sessionId) return null;
    const recorded = readViews(sessionId)[filePath];
    if (!recorded) return null;
    const content = readFileSync(filePath, "utf8");
    if (isLegacyIsa(parseFrontmatter(content))) return null;
    const current = hashOf(content);
    if (current === recorded) return null;
    return [
      `STALE ISA WRITE [ISAStaleWriteGuard]: ${filePath}`,
      "This ISA changed on disk after this session last saw it; a whole file Write would discard those changes.",
      `on disk ${current.slice(0, 12)}, your view ${recorded.slice(0, 12)}.`,
      "Read the file again, then apply your change with Edit (it keeps the other changes).",
    ].join("\n");
  } catch {
    return null;
  }
}

if (import.meta.main) {
  let input: any = null;
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { input = null; }
  if (input) {
    if (input.hook_event_name === "PreToolUse") {
      const mode = gateMode();
      const reason = mode === "off" ? null : check(input);
      if (reason) {
        const session = input.session_id;
        if (mode === "block") {
          gateLog(ISA_LOG, { gate: GATE, verdict: "fail", reason, session, blocked: true });
          process.stderr.write(reason + "\n");
          process.exit(2);
        }
        gateLog(ISA_LOG, { gate: GATE, verdict: "fail", reason, session, would_block: true });
      }
    } else {
      const tool = input.tool_name;
      if (tool === "Read" || tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
        recordView(input.session_id, input.tool_input?.file_path || "");
      }
    }
  }
  process.exit(0);
}
