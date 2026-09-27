#!/usr/bin/env bun
/**
 * DriftReminder.hook.ts (UserPromptSubmit): the format contract, stated
 * before the answer is written, plus what the previous answer broke.
 *
 * A Stop hook cannot fix text already on screen (FormatGate only logs), so
 * this is the one enforcement point that runs before generation. The previous
 * answer is measured from this session's last-response file (LastResponseCache
 * writes it in full, lib/paths lastResponsePath); a file older than 30
 * minutes is stale and ignored. Output stays under 12 lines. Never blocks.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { BANNED_VOCAB } from "./lib/banned-vocab";
import { BANNER_PREFIX, breaks, CLOSER_PREFIX, measure } from "./lib/format-contract";
import { lastResponsePath } from "./lib/paths";

const STALE_MS = 30 * 60 * 1000;
const SHOWN_WORDS = 10;

export function previousResponse(sessionId?: string): string | null {
  try {
    const p = lastResponsePath(sessionId);
    if (!existsSync(p)) return null;
    if (Date.now() - statSync(p).mtimeMs > STALE_MS) return null;
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function contract(previous: string | null): string[] {
  const lines = [
    "myos format contract (check before writing, not after):",
    `- first line is the banner \`${BANNER_PREFIX}\`, last line the closer \`${CLOSER_PREFIX} ...\``,
    "- answer first; `🔧 CHANGE` and `✅ VERIFY` lines only when something was changed",
    "- em dashes: zero (use a colon, comma or parentheses)",
    `- avoid: ${BANNED_VOCAB.slice(0, SHOWN_WORDS).join(", ")}`,
  ];
  if (previous !== null && previous.trim()) {
    const m = measure(previous);
    const broke = breaks(m);
    lines.push(broke.length ? `Last response broke: ${broke.join(", ")}.` : `Last response was clean (${m.lines} lines).`);
  }
  return lines;
}

if (import.meta.main) {
  try {
    const raw = await Bun.stdin.text().catch(() => "");
    let sessionId: string | undefined;
    try { sessionId = JSON.parse(raw)?.session_id; } catch { sessionId = undefined; }
    process.stdout.write(contract(previousResponse(sessionId)).join("\n") + "\n");
  } catch {
    /* never block a prompt */
  }
  process.exit(0);
}
