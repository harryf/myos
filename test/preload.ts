/**
 * test/preload.ts: runs once before any test file (wired in bunfig.toml).
 *
 * Two jobs:
 *
 * 1. Scrub the in-process environment. Tests spawn tools with `testEnv`, but a
 *    tool imported directly still reads `process.env` at module load, and
 *    `MYOS_DIR` / `CLAUDE_CONFIG_DIR` / `HOME` decide where it writes. Pointing
 *    all three at a sandbox is what keeps a test from appending to the
 *    developer's real ~/.myos/MYOS/MEMORY.
 *
 *    Caveat worth knowing: `os.homedir()` is resolved at process start in Bun,
 *    so it keeps pointing at the real home whatever we do here. Anything that
 *    resolves paths through `os.homedir()` has to be tested in a subprocess.
 *
 * 2. Print the skip ledger. `bun test` reports a skip count but not what was
 *    skipped or why, and "3 skip" reads like a pass. Release runs need to see
 *    "ffmpeg absent" spelled out, so a gap is a decision rather than an accident.
 */

import { afterAll, setDefaultTimeout } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";

import { REPO, removeSandboxHome, sandboxHomeDir, skipLedger, snapshotRealEnv } from "./harness.ts";

// Subprocess-spawning tests run in ~0.5s locally but have blown bun's 5s
// default on loaded CI runners twice (MemoryReviewer 2026-07-30, LoopDetector
// same day). One global default per the testing doctrine (no per-test
// timeouts); bun 1.3.8 ignores a bunfig [test] timeout key, so it lives here.
// Hangs are still caught fast: the hook harness kills its children at 15s.
setDefaultTimeout(30_000);

snapshotRealEnv();

const home = sandboxHomeDir();
process.env.HOME = home;
process.env.CLAUDE_CONFIG_DIR = `${home}/.myos`;
process.env.MYOS_DIR = `${home}/.myos/MYOS`;
process.env.TZ = "Etc/UTC";
process.env.CI = "1";
process.env.NO_COLOR = "1";

for (const key of Object.keys(process.env)) {
  if (/API_KEY|AUTH_TOKEN|OAUTH|API_TOKEN|^FAL_KEY$/.test(key)) delete process.env[key];
  if (key.startsWith("BUN_DEBUG")) delete process.env[key];
}

afterAll(() => {
  // Sweep the scratch root tempCopy uses. Each copy disposes itself, so this only
  // matters after a crash, but a stale copy inside the repo is confusing to find.
  rmSync(path.join(REPO, ".test-tmp"), { recursive: true, force: true });

  if (skipLedger.size > 0) {
    const lines = [...skipLedger.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, reason]) => `  · ${label}: ${reason}`);
    console.log(`\nOptional tests skipped (${skipLedger.size}): dependency not present:\n${lines.join("\n")}`);
  }
  removeSandboxHome();
});
