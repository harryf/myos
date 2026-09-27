/**
 * test/corpus/hooks.ts: Hooks (payload/hooks/*.hook.ts and .sh) plus the gate
 * trial reader. Owner: hooks work. Every lifecycle hook Claude Code runs,
 * tested through test/hooks/harness.ts as a real subprocess with a sandbox HOME.
 * Aggregated by test/corpus.ts; TestCoverageCheck reads the union.
 */
import type { ToolRow } from "./types.ts";

const hook = (name: string, ext = "ts"): ToolRow => ({
  source: `payload/hooks/${name}.hook.${ext}`,
  test: `test/hooks/${name}.hook.test.ts`,
  kind: "static",
});

export const ROWS: ToolRow[] = [
  // Hooks: the real script as a subprocess with a sandbox HOME, a scrubbed env
  // and a hard timeout. lib/ is covered through the hooks that own it.
  // Cross hook properties (parity, order, anti greps) live in HookContract.test.ts.
  hook("AgentInvocation"),
  {
    source: "payload/hooks/CheckpointPerISC.hook.ts",
    test: "test/hooks/CheckpointPerISC.hook.test.ts",
    kind: "gated",
    needs: ["bin:git"],
    note: "commits opted-in repos on ISC transitions. Commits land in a scratch repo inside the sandbox HOME.",
  },
  {
    source: "payload/hooks/ContextReduction.hook.sh",
    test: "test/hooks/ContextReduction.hook.test.ts",
    kind: "gated",
    needs: ["bin:jq"],
    note: "rtk rewrite rules. rtk itself is only `command -v`-checked, so a stub rtk on PATH exercises every rule; jq is executed for real.",
  },
  hook("DriftReminder"),
  hook("EventLogger"),
  hook("FormatGate"),
  hook("HookHealer"),
  hook("ISACloseGate"),
  hook("ISAFoldGate"),
  hook("ISAGate"),
  hook("ISAStaleWriteGuard"),
  hook("ISASync"),
  hook("LastResponseCache"),
  hook("LoadContext"),
  hook("LoopDetector"),
  hook("ModelRungGuard"),
  hook("PromptProcessing"),
  {
    source: "payload/hooks/PublicPushGate.hook.ts",
    test: "test/hooks/PublicPushGate.hook.test.ts",
    kind: "gated",
    needs: ["bin:git"],
    note: "visibility comes from a stub `gh` on a sparse PATH; the scanned repo is a scratch git repo in the sandbox HOME. No network.",
  },
  hook("Safety"),
  hook("SessionCleanup"),
  hook("StopGates"),
  hook("TaskGovernance"),
  hook("TimeContext"),
  hook("TokenLog"),
  hook("TrialClock"),
  hook("VerificationGate"),

  // The trial reader for the gate logs these hooks write.
  { source: "payload/MYOS/TOOLS/GateReview.ts", test: "test/tools/GateReview.test.ts", kind: "static" },
];
