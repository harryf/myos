/**
 * banned-vocab.ts: words that mark text as machine written. Short on purpose:
 * DriftReminder prints part of it every turn and FormatGate logs the first hit.
 * Trimmed from the LifeOS list to the words that actually recur.
 */

export const BANNED_VOCAB: readonly string[] = [
  "delve",
  "leverage",
  "robust",
  "seamless",
  "seamlessly",
  "comprehensive",
  "cutting-edge",
  "meticulous",
  "pivotal",
  "testament to",
  "game-changer",
  "utilize",
  "landscape",
  "tapestry",
  "realm",
  "embark",
  "vibrant",
  "deep dive",
  "dive into",
  "intricate",
  "holistic",
  "actionable",
  "impactful",
  "synergy",
  "streamline",
  "empower",
  "elevate",
  "unleash",
  "crucial",
  "ecosystem",
  "myriad",
  "paramount",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
}

export const BANNED_VOCAB_RE: RegExp = new RegExp(`\\b(?:${BANNED_VOCAB.map(escapeRegExp).join("|")})\\b`, "iu");

/** The first banned word in the text, lower case, or null. */
export function firstBannedHit(text: string): string | null {
  const hit = BANNED_VOCAB_RE.exec(text);
  return hit?.[0].toLowerCase().replace(/\s+/g, " ") ?? null;
}
