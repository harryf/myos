#!/usr/bin/env bun
/**
 * ContrabandCheck: the mechanical guarantee behind "no voice, no
 * notifications, no servers, no life coaching" in myos.
 *
 * Scans the shippable surface for banned behaviour signatures and exits 1 on
 * any hit. CI and the release workflow run it; run it by hand before tagging.
 *
 * Scope: everything that executes or instructs (hooks, skills, agents,
 * commands, TOOLS, launcher, installer, settings, CLAUDE.md, system prompt,
 * Algorithm). Excluded: MYOS/DOCUMENTATION and MYOS/RULES, reference docs
 * that may describe what upstream ships and myos does not; they instruct
 * nothing. docs/ (the plan and research) is not shipped and not scanned.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const REPO = new URL("..", import.meta.url).pathname;

/** [signature, why it is banned]. Plain substring match, case sensitive unless listed in CASE_INSENSITIVE. */
const BANNED: [string, string][] = [
  ["localhost:31337", "Pulse voice or notify server call"],
  ["127.0.0.1:31337", "Pulse voice or notify server call"],
  ["voice_enabled", "voice notification payload"],
  ["VoiceNotification", "voice handler reference"],
  ["VoiceCompletion", "voice completion hook"],
  ["elevenlabs", "text to speech vendor"],
  ["ntfy", "push notification channel"],
  ["display notification", "macOS notification via osascript"],
  ["PULSE.toml", "Pulse config reference"],
  ["MYOS/PULSE", "Pulse web interface path"],
  ["Bun.serve(", "a local web server in shipped code"],
  [".listen(", "a local server socket in shipped code"],
  ["launchctl load", "a background service installed by shipped code (the Scheduler writes plists only on the user's command, with bootstrap)"],
  ["/tmp/pai-", "PAI shared tmp state (must be /tmp/myos-)"],
  ["com.lifeos.", "LifeOS launchd service reference"],
  ["TELOS", "life coaching surface"],
  ["kitty @", "kitty terminal remote control"],
  ["telegram", "messaging channel"],
];
const CASE_INSENSITIVE = new Set(["elevenlabs", "telegram"]);

const SCAN_ROOTS = [
  "payload/hooks", "payload/skills", "payload/agents", "payload/commands",
  "payload/MYOS/TOOLS", "payload/MYOS/ALGORITHM", "payload/MYOS/USER",
  "payload/CLAUDE.md", "payload/MYOS/MYOS_SYSTEM_PROMPT.md", "payload/MYOS/statusline.ts",
  "payload/settings.template.json", "bin", "install.sh",
];
const TEXT = /\.(md|ts|sh|json|yaml|yml|toml|txt|hbs|mjs|js|example)$/;

let hits = 0;
function scanFile(p: string) {
  const body = readFileSync(p, "utf8");
  const lower = body.toLowerCase();
  const lines = body.split("\n");
  for (const [sig, why] of BANNED) {
    const ci = CASE_INSENSITIVE.has(sig);
    if (!(ci ? lower : body).includes(sig)) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = ci ? lines[i].toLowerCase() : lines[i];
      if (line.includes(sig)) {
        console.error(`CONTRABAND ${relative(REPO, p)}:${i + 1}: ${sig} (${why})`);
        hits++;
      }
    }
  }
}
function walk(p: string) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) {
      if (e === "node_modules" || e === ".git") continue;
      walk(join(p, e));
    }
  } else if (TEXT.test(p) || /(^|\/)(myos|VERSION|LATEST)$/.test(p)) {
    scanFile(p);
  }
}

for (const root of SCAN_ROOTS) {
  try { walk(join(REPO, root)); } catch {}
}
if (hits > 0) {
  console.error(`\n${hits} contraband hit(s). Release blocked.`);
  process.exit(1);
}
console.log("ContrabandCheck: shippable surface clean.");
