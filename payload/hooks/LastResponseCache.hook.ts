#!/usr/bin/env bun
/**
 * LastResponseCache.hook.ts (Stop): writes the turn's final assistant text to
 * MEMORY/STATE/last-response/<session>.txt (lib/paths lastResponsePath), in
 * full. DriftReminder reads it on the next prompt to say what the previous response broke, so truncating it would hide
 * breaks near the end (the closer line lives there).
 *
 * Registered before StopGates. Always exits 0.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { lastAssistantText, readHookInput } from "./lib/hook-io";
import { lastResponsePath } from "./lib/paths";

async function main(): Promise<void> {
  const input = await readHookInput();
  if (!input) return;
  const text = input.last_assistant_message || lastAssistantText(input.transcript_path);
  if (!text) return;
  try {
    const path = lastResponsePath(input.session_id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  } catch {
    /* a cache miss only costs DriftReminder one turn */
  }
}

main().finally(() => process.exit(0));
