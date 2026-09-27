/**
 * format-contract.ts: the myos response format as measurable facts.
 *
 * DriftReminder states the contract before the answer is written and reports
 * what the previous answer broke; FormatGate measures the answer after it is
 * written and logs. Both read the same measure() so they never disagree.
 */
import { firstBannedHit } from "./banned-vocab";

export const EM_DASH = "\u2014";
export const EM_DASH_CAP = 0;
export const BANNER_PREFIX = "════ myos ═══";
export const CLOSER_PREFIX = "🗣️ myos:";

export interface FormatMeasure {
  lines: number;
  emDashes: number;
  banner: boolean;
  closer: boolean;
  banned: string | null;
}

/** Fenced code, inline code and blockquotes are not prose. */
export function stripNonProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n");
}

function visibleLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

export function measure(text: string): FormatMeasure {
  const lines = visibleLines(text);
  const prose = stripNonProse(text);
  return {
    lines: visibleLines(prose).length,
    emDashes: prose.split(EM_DASH).length - 1,
    banner: lines.length > 0 && lines[0]!.startsWith(BANNER_PREFIX),
    closer: lines.length > 0 && lines[lines.length - 1]!.startsWith(CLOSER_PREFIX),
    banned: firstBannedHit(prose),
  };
}

/** What a response broke, in words. Empty when it was clean. */
export function breaks(m: FormatMeasure): string[] {
  const out: string[] = [];
  if (!m.banner) out.push("no banner on the first line");
  if (!m.closer) out.push("no closer on the last line");
  if (m.emDashes > EM_DASH_CAP) out.push(`${m.emDashes} em dash${m.emDashes === 1 ? "" : "es"}`);
  if (m.banned) out.push(`banned word '${m.banned}'`);
  return out;
}
