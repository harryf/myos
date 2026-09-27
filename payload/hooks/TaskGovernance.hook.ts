#!/usr/bin/env bun
/**
 * TaskGovernance.hook.ts (TaskCreated): cheap insurance against runaway
 * subagent task spawning.
 *
 *   1. A task description under 10 characters is blocked.
 *   2. At most 50 tasks per session; the count lives in
 *      MEMORY/STATE/task-governance/<session>.json (tmp file then rename).
 *
 * exit 0 allows, exit 2 blocks with the reason on stderr. Unparseable or
 * empty stdin allows: a blocking hook fails open.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readHookInput } from "./lib/hook-io";
import { safeSessionId } from "./lib/latch";
import { myosPath } from "./lib/paths";

export const MAX_TASKS_PER_SESSION = 50;
export const counterPath = (sessionId?: string) =>
  join(myosPath("MEMORY", "STATE", "task-governance"), `${safeSessionId(sessionId)}.json`);

function readCount(path: string): number {
  try {
    return existsSync(path) ? Number(JSON.parse(readFileSync(path, "utf8")).count) || 0 : 0;
  } catch {
    return 0;
  }
}

async function main(): Promise<number> {
  const input = await readHookInput();
  if (!input) return 0;
  const description = String(input.task_description ?? "");
  if (description.trim().length < 10) {
    process.stderr.write(
      `Task creation blocked: description too short (${description.length} chars). Provide a meaningful task description of at least 10 characters.`,
    );
    return 2;
  }
  const path = counterPath(input.session_id);
  const count = readCount(path);
  if (count >= MAX_TASKS_PER_SESSION) {
    process.stderr.write(
      `Task creation blocked: session limit of ${MAX_TASKS_PER_SESSION} tasks reached. This prevents runaway task spawning. Complete existing tasks before creating new ones.`,
    );
    return 2;
  }
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify({ count: count + 1 }));
    renameSync(`${path}.tmp`, path);
  } catch {
    /* a lost count only loosens the cap */
  }
  return 0;
}

main().then((code) => process.exit(code), () => process.exit(0));
