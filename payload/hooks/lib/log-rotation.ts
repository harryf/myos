/**
 * log-rotation.ts: keep an append-only jsonl log from growing forever.
 *
 * Before appending, a writer calls rotateIfLarge(path). When the file is at or
 * over the cap it becomes `<name>.1.jsonl`, the old `.1` becomes `.2`, and the
 * old `.2` is dropped: two generations kept, the live file starts empty.
 * Never throws; a failed rotation just means the file grows a bit longer.
 */
import { existsSync, renameSync, rmSync, statSync } from "node:fs";

export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
export const GENERATIONS = 2;

/** `tool-activity.jsonl` -> `tool-activity.<n>.jsonl`. */
export function generationPath(path: string, n: number): string {
  return /\.jsonl$/.test(path) ? path.replace(/\.jsonl$/, `.${n}.jsonl`) : `${path}.${n}`;
}

/** Rotates when the file is at or over maxBytes. Returns true when it rotated. */
export function rotateIfLarge(path: string, maxBytes: number = DEFAULT_MAX_BYTES): boolean {
  try {
    if (!existsSync(path) || statSync(path).size < maxBytes) return false;
    const oldest = generationPath(path, GENERATIONS);
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let n = GENERATIONS - 1; n >= 1; n--) {
      const from = generationPath(path, n);
      if (existsSync(from)) renameSync(from, generationPath(path, n + 1));
    }
    renameSync(path, generationPath(path, 1));
    return true;
  } catch {
    return false;
  }
}
