#!/usr/bin/env bun
/**
 * ModelRungGuard.hook.ts (UserPromptSubmit, async): reports when the session
 * runs below the model pinned in settings.json. It never switches: a hook
 * cannot, and asking is the principal's call.
 *
 * Pin: `model` in <config dir>/settings.json (CLAUDE_CONFIG_DIR or ~/.myos).
 * Live: `message.model` of the last main loop assistant row in the transcript
 * tail (subagent rows skipped). Silent when equal, unknown, or above.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { getClaudeDir } from "./lib/paths";

const TAIL_BYTES = 256 * 1024;
export const RUNGS = ["fable", "opus", "sonnet", "haiku"] as const;
export type Rung = (typeof RUNGS)[number];

export function rungOf(model: string | null | undefined): Rung | null {
  if (!model) return null;
  const m = model.toLowerCase();
  return RUNGS.find((r) => m.includes(r)) ?? null;
}

export function pinnedModel(settingsPath = join(getClaudeDir(), "settings.json")): string | null {
  try {
    if (!existsSync(settingsPath)) return null;
    const s = JSON.parse(readFileSync(settingsPath, "utf8"));
    return typeof s.model === "string" ? s.model : null;
  } catch {
    return null;
  }
}

export function liveModel(transcriptPath: string | undefined): string | null {
  let fd: number | null = null;
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return null;
    const size = statSync(transcriptPath).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.allocUnsafe(size - start);
    fd = openSync(transcriptPath, "r");
    const got = readSync(fd, buf, 0, buf.length, start);
    const lines = buf.subarray(0, got).toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]!);
        if (row.isSidechain === true) continue;
        const model = row?.message?.model;
        if (typeof model === "string" && model.trim() && model !== "<synthetic>") return model;
      } catch { /* partial line */ }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* gone */ }
  }
}

/** Positive when live sits below the pin. */
export function rungGap(pin: Rung | null, live: Rung | null): number {
  if (!pin || !live) return 0;
  return RUNGS.indexOf(live) - RUNGS.indexOf(pin);
}

if (import.meta.main) {
  try {
    const raw = await Bun.stdin.text().catch(() => "");
    let transcript: string | undefined;
    try { transcript = JSON.parse(raw)?.transcript_path; } catch { transcript = undefined; }
    const pin = pinnedModel();
    const model = liveModel(transcript);
    const gap = rungGap(rungOf(pin), rungOf(model));
    if (gap > 0) {
      process.stdout.write(`Model rung: this session runs '${model}', ${gap} rung${gap === 1 ? "" : "s"} below the '${pin}' pin in settings.json. Switch with /model if the work needs the pinned model.\n`);
    }
  } catch {
    /* never block a prompt */
  }
  process.exit(0);
}
