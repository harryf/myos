/**
 * test/corpus/skills.ts: Skill tools (payload/skills/<Skill>/Tools/*.ts). Owner: skills work.
 * Aggregated by test/corpus.ts; TestCoverageCheck reads the union.
 */
import type { ToolRow } from "./types.ts";

export const ROWS: ToolRow[] = [
  {
    source: "payload/skills/ContextSearch/Tools/ContextSearch.ts",
    test: "test/skills/ContextSearch/Tools/ContextSearch.test.ts",
    kind: "static",
    note: "searches a sandbox HOME's work registry, ISAs and transcripts. The rg-backed sources are exercised when rg is on PATH and come back empty (not failing) without it.",
  },
  {
    source: "payload/skills/Interceptor/Tools/FrameScrub.ts",
    test: "test/skills/Interceptor/Tools/FrameScrub.test.ts",
    kind: "gated",
    needs: ["bin:ffmpeg"],
    note: "extracts frames from a screen recording.",
  },
  {
    source: "payload/skills/Interceptor/Tools/VerifyImageProbe.ts",
    test: "test/skills/Interceptor/Tools/VerifyImageProbe.test.ts",
    kind: "gated",
    needs: ["bin:magick"],
    note: "the blank-frame degeneracy probe. With magick present the test builds a blank and a textured image and asserts the classification both ways.",
  },
  {
    source: "payload/skills/MyTokens/Tools/TokenLog.ts",
    test: "test/skills/MyTokens/Tools/TokenLog.test.ts",
    kind: "static",
    note: "transcripts in, aggregates out, from fixtures; the CLI runs against a fixture store in a sandbox HOME. rtk is suppressed with MYOS_TOKENLOG_NO_RTK.",
  },
  {
    source: "payload/skills/Scheduler/Tools/Scheduler.ts",
    test: "test/skills/Scheduler/Tools/Scheduler.test.ts",
    kind: "static",
    note: "plists are written into a sandbox HOME's Library/LaunchAgents; launchctl and myos are stubs on a sparse PATH, so the real launchctl is never reached.",
  },
  { source: "payload/skills/Writing/Tools/StyleCheck.ts", test: "test/skills/Writing/Tools/StyleCheck.test.ts", kind: "static" },
];
