/**
 * test/corpus/gates.ts: Repo gates (Tools/). Owner: the integrator. Release blocking checks, each tested against a broken fixture too.
 * Aggregated by test/corpus.ts; TestCoverageCheck reads the union.
 */
import type { ToolRow } from "./types.ts";

export const ROWS: ToolRow[] = [
  {
    source: "payload/CLAUDE.md",
    test: "test/doctrine/Doctrine.test.ts",
    kind: "static",
    note: "the doctrine files (CLAUDE.md, the system prompt, the Algorithm, RULES) are budgeted in bytes and probed for the phrases the plan requires; CLAUDE.md stands for the set in the parity contract.",
  },
  // ---------------------------------------------------------------------------
  // Repo gates (Tools/): the release-blocking checks. A gate nobody has watched
  // fail is not a gate, so each of these is tested against a broken fixture too.
  // ---------------------------------------------------------------------------
  { source: "Tools/ContrabandCheck.ts", test: "test/gates/ContrabandCheck.test.ts", kind: "static" },
  { source: "Tools/PermissionRulesCheck.ts", test: "test/gates/PermissionRulesCheck.test.ts", kind: "static" },
  { source: "Tools/Release.ts", test: "test/gates/Release.test.ts", kind: "static" },
  {
    source: "Tools/SkillVersionBump.ts",
    test: "test/gates/SkillVersionBump.test.ts",
    kind: "gated",
    needs: ["bin:git"],
    note: "semver + frontmatter helpers static; plan modes run the real script inside a scratch git repo.",
  },
  { source: "Tools/UpgradePlan.ts", test: "test/gates/UpgradePlan.test.ts", kind: "static" },
  { source: "Tools/TestCoverageCheck.ts", test: "test/gates/TestCoverageCheck.test.ts", kind: "static" },
  {
    source: "Tools/ReleaseCheck.ts",
    test: "test/gates/ReleaseCheck.test.ts",
    kind: "llm",
    note: "the manual pre-release validation runner: live probes drive the installed system through `myos -p` and burn tokens, so they are run by hand before a tag and never by CI or tests. Graders, transcript parsing, trial aggregation and every health check are deterministic and tested against fixture installs; no probe is ever launched here.",
  },

];
