#!/usr/bin/env bun
/**
 * TokenLog.hook.ts: SessionEnd: fold this session's transcript into the
 * durable token log (MEMORY/OBSERVABILITY/TOKENS/) before Claude Code's
 * ~30-day transcript pruning can eat it.
 *
 * Thin by design: all logic lives in skills/MyTokens/Tools/TokenLog.ts
 * (`sync` is incremental: unchanged transcripts are skipped by mtime+size, so
 * this costs one directory scan plus a parse of the session that just ended).
 * A token log must never break a session teardown: every failure path is a
 * silent exit 0.
 */

import { sync } from "../skills/MyTokens/Tools/TokenLog.ts";

async function main(): Promise<void> {
  try {
    await Bun.stdin.text(); // consume the SessionEnd payload; sync needs none of it
  } catch {
    // stdin may be closed already; irrelevant
  }
  try {
    sync({ quiet: true });
  } catch {
    // never block teardown over bookkeeping
  }
}

await main();
process.exit(0);
