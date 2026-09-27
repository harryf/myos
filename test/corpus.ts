/**
 * test/corpus.ts: the script and test parity contract, aggregated from four
 * owner modules so parallel work never edits one shared file:
 *   test/corpus/hooks.ts   payload/hooks/*.hook.ts and .sh
 *   test/corpus/gates.ts   Tools/*.ts (repo gates)
 *   test/corpus/tools.ts   payload/MYOS/TOOLS/*.ts and statusline.ts
 *   test/corpus/skills.ts  payload/skills/<Skill>/Tools/*.ts
 * A tool or hook is in the shipped tree exactly when it has a row in one of
 * them. `bun Tools/TestCoverageCheck.ts` fails when the two drift. Row
 * semantics (kind, needs, note) are documented in test/corpus/types.ts.
 */
import type { ToolRow } from "./corpus/types.ts";
import { ROWS as HOOKS } from "./corpus/hooks.ts";
import { ROWS as GATES } from "./corpus/gates.ts";
import { ROWS as TOOLS } from "./corpus/tools.ts";
import { ROWS as SKILLS } from "./corpus/skills.ts";

export type { ToolKind, ToolRow } from "./corpus/types.ts";

export const CORPUS: ToolRow[] = [...HOOKS, ...GATES, ...TOOLS, ...SKILLS];

/** Directories and globs the coverage gate treats as the tool surface. */
export const TOOL_SURFACE = {
  dirs: [
    { dir: "Tools", pattern: /\.ts$/ },
    { dir: "payload/MYOS/TOOLS", pattern: /\.ts$/ },
    // Hooks: only the *.hook.* entrypoints. lib/ and handlers/ are reached
    // through the hooks that own them (listFiles is non-recursive on purpose).
    { dir: "payload/hooks", pattern: /\.hook\.(ts|sh)$/ },
  ],
  /** Every payload/skills/<Skill>/Tools/*.ts. */
  skillTools: "payload/skills",
  /** Individually-named scripts that are tools but live outside a Tools/ dir. */
  extras: ["payload/MYOS/statusline.ts", "bin/myos", "install.sh", "payload/CLAUDE.md"],
};

export function corpusBySource(): Map<string, ToolRow> {
  return new Map(CORPUS.map((row) => [row.source, row]));
}

/** Rows that must have a test file on disk. */
export function rowsRequiringTests(): ToolRow[] {
  return CORPUS.filter((row) => row.kind !== "exempt");
}
