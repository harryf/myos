#!/usr/bin/env bun
/**
 * myos statusline: deliberately lean.
 * Shows: myos version │ model │ context-window state │ cwd │ loaded context files.
 * Nothing else. No STATE dimensions, no weather, no location, no quotes.
 *
 * Input: Claude Code statusline JSON on stdin.
 * Fields used: model.display_name, workspace.current_dir (fallback cwd),
 *              context_window.used_percentage / total_input_tokens / context_window_size.
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const HOME = homedir();
const MYOS_HOME = process.env.CLAUDE_CONFIG_DIR || join(HOME, ".myos");

function tilde(p: string): string {
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
}

let input: any = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {}

const version = (() => {
  try { return readFileSync(join(MYOS_HOME, "MYOS", "VERSION"), "utf8").trim(); }
  catch { return "?"; }
})();

const model: string = input?.model?.display_name || input?.model?.id || "";
const cwd: string = input?.workspace?.current_dir || input?.cwd || process.cwd();

// Context window state
const cw = input?.context_window || {};
let ctx = "ctx ?";
if (typeof cw.used_percentage === "number") {
  ctx = `ctx ${Math.round(cw.used_percentage)}%`;
  if (typeof cw.context_window_size === "number" && typeof cw.total_input_tokens === "number") {
    const freeK = Math.max(0, Math.round((cw.context_window_size - cw.total_input_tokens) / 1000));
    ctx += ` (${freeK}k free)`;
  }
} else if (typeof cw.total_input_tokens === "number" && typeof cw.context_window_size === "number") {
  ctx = `ctx ${Math.round((cw.total_input_tokens / cw.context_window_size) * 100)}%`;
}

// Significant context files (full paths): myos-global + project-local CLAUDE.md files.
const ctxFiles: string[] = [];
const globalMd = join(MYOS_HOME, "CLAUDE.md");
if (existsSync(globalMd)) ctxFiles.push(tilde(globalMd));
// Walk up from cwd collecting CLAUDE.md files (Claude Code loads these).
let dir = cwd;
const seen = new Set<string>();
while (dir && dir !== HOME && !seen.has(dir)) {
  seen.add(dir);
  for (const cand of [join(dir, "CLAUDE.md"), join(dir, ".claude", "CLAUDE.md")]) {
    if (existsSync(cand)) ctxFiles.push(tilde(cand));
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

const parts = [
  `myos v${version}`,
  model,
  ctx,
  tilde(cwd),
  ctxFiles.length ? `ctx-files: ${ctxFiles.join(" · ")}` : "",
].filter(Boolean);

console.log(parts.join(" │ "));
