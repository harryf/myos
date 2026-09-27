/**
 * isa-gates.ts: what the three ISA Stop gates share.
 *
 *   - which ISA the session is working on (work.json, bound by ISASync)
 *   - whether the turn touched it
 *   - whether the reply already talks about it
 *   - the one log file (isa-gates.jsonl, `gate` names which gate)
 *
 * Legacy ISAs (frontmatter `effort:`) are never judged: gates.ts isLegacyIsa.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { findActiveSessionByUUID, parseFrontmatter } from "./isa-utils";
import { getMyosDir } from "./paths";
import { isLegacyIsa } from "./gates";
import type { TxEvent } from "./transcript-evidence";

export const ISA_LOG = "isa-gates.jsonl";

export function isIsaPath(p: string): boolean {
  const name = basename(p).toLowerCase();
  return name === "isa.md" || name.endsWith(".isa.md");
}

export interface ActiveIsa {
  slug: string;
  path: string;
  content: string;
  frontmatter: Record<string, string>;
  legacy: boolean;
}

/** The ISA the session's active run points at, or null when there is none. */
export function activeIsa(sessionId: string | undefined): ActiveIsa | null {
  if (!sessionId) return null;
  const hit = findActiveSessionByUUID(sessionId);
  if (!hit) return null;
  const rel = String(hit.session.isa ?? "");
  if (!rel) return null;
  const path = isAbsolute(rel) ? rel : join(getMyosDir(), rel);
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  const frontmatter = parseFrontmatter(content) ?? {};
  return { slug: hit.slug, path, content, frontmatter, legacy: isLegacyIsa(frontmatter) };
}

/** Completion words in a claimable unit ("done", "shipped", "all green"). */
export const COMPLETION_RE =
  /\b(done|complete(d)?|finished|shipped|implemented|built\s+and\s+(verified|tested)|all\s+(\d+\s+)?claims?\s+closed|all\s+(green|passing)|feature\s+(is\s+)?(live|done|complete|in)|task\s+complete|work\s+(is\s+)?(done|complete)|good\s+to\s+go|ready\s+to\s+ship)\b/i;

/** The reply already addresses the ISA ("ISA updated", "no ISA delta needed"). */
export const ISA_ADDRESSED_RE =
  /\bISA(?:'s|s)?\s+(?:is\s+|was\s+|are\s+)?(?:already\s+)?(?:current|up[\s-]?to[\s-]?date|updated|unchanged|fresh|complete|closed|\d+\s*\/\s*\d+)\b|\bno\s+ISA\s+(?:update|delta|change)s?\s+(?:needed|required)\b|\bupdated?\s+the\s+ISA\b|\bISA\s+doesn'?t\s+need\b/i;

const BASH_WRITE_RE = /(write_text|sed\s+-i\b|perl\s+-i\b|>>|\btee\b|git\s+add\b[^&|;]*ISA\.md)/;
const ISA_MENTION_RE = /(?:^|[\s/"'`])(?:ISA\.md|[\w.-]+\.isa\.md)\b/i;

/** An event that wrote an ISA: an edit tool, or a write-shaped shell command naming one. */
export function isIsaWrite(e: TxEvent): boolean {
  if (e.kind === "edit") return isIsaPath(e.target);
  return e.kind === "command" && !e.isToolError && ISA_MENTION_RE.test(e.target) && BASH_WRITE_RE.test(e.target);
}

export function isaEditedIn(ev: TxEvent[]): boolean {
  return ev.some(isIsaWrite);
}

/** Tool calls since the last ISA write in the window (all of them if none). */
export function toolCallsSinceIsaWrite(ev: TxEvent[]): number {
  let last = -1;
  for (const e of ev) if (isIsaWrite(e)) last = e.seq;
  return ev.filter((e) => e.seq > last).length;
}
