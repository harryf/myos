/**
 * latch.ts: "this block already fired once", per session.
 *
 * One small JSON array per session under MEMORY/STATE/<name>/<session>.json,
 * written to a tmp file and renamed, so two sessions never rewrite each
 * other's list and a crash never leaves a torn file. Never throws.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { myosPath } from "./paths";

const MAX_ENTRIES = 400;

export function safeSessionId(sessionId: string | undefined): string {
  return (sessionId ?? "").replace(/[^A-Za-z0-9_-]/g, "") || "unknown";
}

function latchFile(name: string, sessionId: string | undefined): string {
  return join(myosPath("MEMORY", "STATE", name), `${safeSessionId(sessionId)}.json`);
}

function read(file: string): string[] {
  try {
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isLatched(name: string, sessionId: string | undefined, key: string): boolean {
  return read(latchFile(name, sessionId)).includes(key);
}

export function setLatch(name: string, sessionId: string | undefined, key: string): void {
  try {
    const file = latchFile(name, sessionId);
    mkdirSync(join(file, ".."), { recursive: true });
    const list = [...read(file), key].slice(-MAX_ENTRIES);
    writeFileSync(`${file}.tmp`, JSON.stringify(list));
    renameSync(`${file}.tmp`, file);
  } catch {
    /* best effort: a lost latch costs one repeat block */
  }
}
