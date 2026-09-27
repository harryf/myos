/**
 * isa-fixtures.ts: the golden ISA fixtures and a helper that binds one to
 * the test session the way a real run does (ISASync on a Write).
 */
import { readFileSync } from "node:fs";

import { repoPath } from "../harness.ts";
import { events, runHook, type myosHome } from "./harness.ts";

export const CURRENT = readFileSync(repoPath("test/fixtures/isa/current.md"), "utf8");
export const LEGACY = readFileSync(repoPath("test/fixtures/isa/legacy.md"), "utf8");
export const CURRENT_SLUG = "20260928-090000_report-json-flag";
export const LEGACY_SLUG = "20260814-101500_rotate-deploy-credential";

/** The current fixture with every claim closed, progress 4/4, phase complete. */
export function closedCurrent(): string {
  return CURRENT.replace("phase: climbing", "phase: complete")
    .replace("progress: 1/4", "progress: 4/4")
    .replace(/- \[ \] /g, "- [x] ")
    .replace(/## Not yet specified\n\n- [^\n]*\n\n/, "");
}

type Home = ReturnType<typeof myosHome>;

/** Writes the ISA into a project dir and binds it to the session via ISASync. */
export async function bindIsa(home: Home, content: string, rel = "Code/report-tool/ISA.md"): Promise<string> {
  const path = home.write(rel, content);
  await runHook("payload/hooks/ISASync.hook.ts", { home, stdin: events.postToolUse("Write", { file_path: path }) });
  return path;
}

/** n harmless tool calls as transcript lines. */
export function busyWork(n: number, assistantToolUse: (name: string, input: Record<string, unknown>, id?: string) => string, toolResult: (id: string, text: string) => string): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(assistantToolUse("Grep", { pattern: `thing${i}` }, `g${i}`), toolResult(`g${i}`, "no matches"));
  }
  return out;
}
