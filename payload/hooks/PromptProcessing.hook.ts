#!/usr/bin/env bun
/**
 * PromptProcessing.hook.ts (UserPromptSubmit, async): names the session from
 * its first prompt, deterministically.
 *
 * The name is the first real prompt, whitespace collapsed and cut to 48
 * characters, written once to MEMORY/STATE/session-names.json (ContextSearch
 * and MyTokens read it). No model is called and nothing is spawned. System
 * text, task notifications and bare ratings never name a session.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { myosPath } from "./lib/paths";

export const NAME_MAX = 48;
const namesPath = () => myosPath("MEMORY", "STATE", "session-names.json");

/** The session name a prompt yields, or null when it should not name one. */
export function nameFromPrompt(prompt: string): string | null {
  const text = prompt.trim();
  if (!text) return null;
  if (/^<(system-reminder|task-notification|local-command|command-stdout|user-prompt-submit-hook)/i.test(text)) return null;
  if (/^\d{1,2}(\s*\/\s*10)?$/.test(text)) return null; // a bare rating
  // The harness expands a slash command as <command-name>/x</command-name>.
  const cmd = text.match(/<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/);
  const source = cmd ? cmd[1]! + text.replace(/<[^>]+>[^<]*<\/[^>]+>/g, " ") : text.replace(/<[^>]+>/g, " ");
  const flat = source.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > NAME_MAX ? flat.slice(0, NAME_MAX).trimEnd() : flat;
}

function readNames(): Record<string, string> {
  try {
    return existsSync(namesPath()) ? JSON.parse(readFileSync(namesPath(), "utf8")) : {};
  } catch {
    return {};
  }
}

if (import.meta.main) {
  try {
    const input = JSON.parse(await Bun.stdin.text());
    const session = String(input?.session_id ?? "");
    const name = nameFromPrompt(String(input?.prompt ?? ""));
    if (session && name) {
      const names = readNames();
      if (!names[session]) {
        names[session] = name;
        const p = namesPath();
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(`${p}.tmp`, JSON.stringify(names, null, 2) + "\n");
        renameSync(`${p}.tmp`, p);
      }
    }
  } catch {
    /* naming is never worth a failed prompt */
  }
  process.exit(0);
}
