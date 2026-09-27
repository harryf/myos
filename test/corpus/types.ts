/**
 * test/corpus.ts: the script ⇔ test parity contract.
 *
 * Same idea as INVENTORY.md: a tool or hook script is in the shipped tree ⇔ it
 * has a row here. `bun Tools/TestCoverageCheck.ts` fails when the two drift, so
 * a script added without a test is a red build rather than a quiet gap.
 *
 * `kind` says what a test can honestly assert about the tool:
 *
 *   static      Deterministic logic. Tested for real behaviour against fixtures.
 *   gated       Real work needs something this machine may not have (ffmpeg, a
 *               browser, a vendor key). The test covers argument handling and the
 *               clean-failure path always, and the live path only when `needs` is
 *               satisfied. Skips are printed, never silent.
 *   llm         The main path calls a model. Tests cover the deterministic helpers
 *               around it and assert no model is ever spawned (doctrine rule 8).
 *   exempt      Nothing worth asserting. Needs a `note` saying why, so "exempt"
 *               stays a decision somebody made rather than an oversight.
 *
 * `needs` entries are read by the tests themselves:
 *   bin:<name>     executable on PATH
 *   module:<spec>  resolvable node module (i.e. someone ran `bun install`)
 *   env:<NAME>     credential present in the real environment (value never used)
 *   installed      a real ~/.myos install to read
 */

export type ToolKind = "static" | "gated" | "llm" | "exempt";

export interface ToolRow {
  /** Repo-relative path to the tool script. */
  source: string;
  /** Repo-relative path to its test file. Absent only for `exempt`. */
  test?: string;
  kind: ToolKind;
  /** Optional-dependency tokens the live-path tests gate on. */
  needs?: string[];
  /** Why this row reads the way it does. Required for `exempt` and `llm`. */
  note?: string;
}

export const CORPUS: ToolRow[] = [
