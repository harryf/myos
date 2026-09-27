/**
 * test/corpus/tools.ts: MYOS/TOOLS, the statusline, the launcher and the
 * installer. Owner: tools work. Aggregated by test/corpus.ts; TestCoverageCheck
 * reads the union. GateReview.ts rows belong to the hooks work (test/corpus/hooks.ts).
 */
import type { ToolRow } from "./types.ts";

export const ROWS: ToolRow[] = [
  // ---------------------------------------------------------------------------
  // MYOS/TOOLS: the system tools every install ships.
  // ---------------------------------------------------------------------------
  { source: "payload/MYOS/TOOLS/BudgetCheck.ts", test: "test/tools/BudgetCheck.test.ts", kind: "static" },
  {
    source: "payload/MYOS/TOOLS/DependencyAudit.ts",
    test: "test/tools/DependencyAudit.test.ts",
    kind: "static",
    note: "probes the environment, so assertions are about the report's shape and its verdict logic, not which tools happen to be installed.",
  },
  {
    source: "payload/MYOS/TOOLS/Doctor.ts",
    test: "test/tools/Doctor.test.ts",
    kind: "static",
    note: "probes this machine, so tests assert the probe list, the config health checks and the write rules, never which binaries are present.",
  },
  {
    source: "payload/MYOS/TOOLS/Inference.ts",
    test: "test/tools/Inference.test.ts",
    kind: "llm",
    note: "the model gateway. Pure exports (levels, executed-model verification, envelope parsing, the advisor prompt) are tested directly; the CLI paths run against a stub `claude` on a sparse PATH, so no model is ever called.",
  },
  { source: "payload/MYOS/TOOLS/MergeSettings.ts", test: "test/tools/MergeSettings.test.ts", kind: "static" },
  {
    source: "payload/MYOS/TOOLS/MigrateMemory.ts",
    test: "test/tools/MigrateMemory.test.ts",
    kind: "static",
    note: "runs only against a fixture pai tree in a sandbox HOME; the real ~/.claude-personal is never read by the tests.",
  },
  { source: "payload/MYOS/TOOLS/models.ts", test: "test/tools/models.test.ts", kind: "static" },
  { source: "payload/MYOS/TOOLS/MyosConfig.ts", test: "test/tools/MyosConfig.test.ts", kind: "static" },
  { source: "payload/MYOS/TOOLS/SplitProjects.ts", test: "test/tools/SplitProjects.test.ts", kind: "static" },
  { source: "payload/MYOS/statusline.ts", test: "test/tools/statusline.test.ts", kind: "static" },

  // ---------------------------------------------------------------------------
  // Outside payload/MYOS: the launcher and the installer.
  // ---------------------------------------------------------------------------
  {
    source: "bin/myos",
    test: "test/tools/launcher.test.ts",
    kind: "static",
    note: "bash; run with a stub `claude` on a sparse PATH (so /bin/bash 3.2 on macOS) and the args it receives are asserted.",
  },
  {
    source: "install.sh",
    test: "test/tools/install.test.ts",
    kind: "static",
    note: "bash; every test runs the real script with HOME and MYOS_HOME in a sandbox, never the real home.",
  },
];
