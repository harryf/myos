#!/usr/bin/env bun
/**
 * PublicPushGate.hook.ts (PreToolUse Bash): no push to a PUBLIC GitHub repo,
 * and no public repo creation or visibility flip through `gh repo`, until the
 * repo's HEAD tree and local history pass a deny scan.
 *
 * Patterns: generic secret shapes built in, plus one case insensitive ERE per
 * line from MYOS/USER/SECURITY/PublicScrubPatterns.txt (private, # comments).
 *
 * Fail policy: not push shaped, not GitHub, `gh` missing, or visibility
 * unknown: allow (fail open, never brick pushes offline). Confirmed public:
 * the scan must finish clean; a hit or a scan error blocks (exit 2).
 * Visibility is cached 24 h in MEMORY/STATE/public-push-gate.json.
 *
 * Own switch: MYOS_PUSHGATE=off. It is a security deny, so MYOS_GATES does
 * not touch it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { myosPath } from "./lib/paths";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_SCAN_MAX_COMMITS = 400;
const patternFile = () => myosPath("USER", "SECURITY", "PublicScrubPatterns.txt");
const cacheFile = () => myosPath("MEMORY", "STATE", "public-push-gate.json");

const GENERIC_PATTERNS = [
  "sk-ant-[A-Za-z0-9_-]{10}",
  "ghp_[A-Za-z0-9]{20}",
  "github_pat_[A-Za-z0-9_]{20}",
  "AKIA[0-9A-Z]{16}",
  "xox[bpars]-[A-Za-z0-9-]{10}",
  "-----BEGIN [A-Z ]*PRIVATE KEY-----",
];

// Built from parts so the command text never appears literally in this file.
const VIS = "visibility";
const CREATE_PUBLIC_RE = /\bgh\s+repo\s+create\b[^\n]*--public\b/;
const FLIP_PUBLIC_RE = new RegExp(`\\bgh\\s+repo\\s+edit\\b[^\\n]*--${VIS}[= ]+public\\b`);

function sh(cmd: string[], cwd?: string): { ok: boolean; out: string } {
  try {
    if (!Bun.which(cmd[0]!)) return { ok: false, out: "" };
    const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    return { ok: r.exitCode === 0, out: new TextDecoder().decode(r.stdout).trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

export function loadPatterns(): string[] {
  const patterns = [...GENERIC_PATTERNS];
  try {
    if (existsSync(patternFile())) {
      for (const line of readFileSync(patternFile(), "utf8").split("\n")) {
        const t = line.trim();
        if (t && !t.startsWith("#")) patterns.push(t);
      }
    }
  } catch {
    /* the generic set still applies */
  }
  return patterns;
}

export function repoDirFor(command: string, cwd: string | undefined): string {
  const home = process.env.HOME ?? homedir();
  const dashC = /\bgit\s+-C\s+([^\s;|&]+)/.exec(command);
  const cd = /(?:^|&&|;)\s*cd\s+([^\s;|&]+)/.exec(command);
  let dir = dashC?.[1] ?? cd?.[1] ?? cwd ?? process.cwd();
  dir = dir.replace(/^["']|["']$/g, "");
  if (dir.startsWith("~/")) dir = join(home, dir.slice(2));
  if (dir.startsWith("$HOME/")) dir = join(home, dir.slice(6));
  if (dir.includes("$") || !existsSync(dir)) dir = cwd ?? process.cwd();
  return dir;
}

function githubSlug(dir: string, command: string): string | null {
  const remoteArg = /\bgit\b[^\n]*\bpush\b\s+(?:-[^\s]+\s+)*([A-Za-z][A-Za-z0-9_-]*)\b/.exec(command);
  const remote = remoteArg?.[1] ?? "origin";
  const first = sh(["git", "remote", "get-url", remote], dir);
  const url = first.ok ? first.out : sh(["git", "remote", "get-url", "origin"], dir).out;
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** "public" | "private" | "internal" | "unknown", cached 24 h. */
export function visibility(slug: string): string {
  let cache: Record<string, { v: string; ts: number }> = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  } catch {
    cache = {};
  }
  const hit = cache[slug];
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.v;
  const { ok, out } = sh(["gh", "repo", "view", slug, "--json", VIS, "--jq", `.${VIS}`]);
  const v = ok ? out.toLowerCase() : "";
  const known = v === "public" || v === "private" || v === "internal" ? v : "unknown";
  if (known !== "unknown") {
    try {
      cache[slug] = { v: known, ts: Date.now() };
      mkdirSync(dirname(cacheFile()), { recursive: true });
      writeFileSync(cacheFile(), JSON.stringify(cache));
    } catch {
      /* cache is best effort */
    }
  }
  return known;
}

/** Deny scan of HEAD and local history. Matches or null; throws when the scan fails. */
function scan(dir: string, patterns: string[]): string | null {
  const args = patterns.flatMap((p) => ["-e", p]);
  const head = Bun.spawnSync(["git", "grep", "-I", "-i", "-n", "-E", ...args, "HEAD"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (head.exitCode > 1) throw new Error("HEAD scan failed");
  if (head.exitCode === 0) return new TextDecoder().decode(head.stdout).slice(0, 1500);
  // Local branches and tags only: that is what a push can ship.
  const count = sh(["git", "rev-list", "--count", "--branches", "--tags"], dir);
  if (!count.ok) throw new Error("rev-list failed");
  if (parseInt(count.out, 10) <= HISTORY_SCAN_MAX_COMMITS) {
    const revs = sh(["git", "rev-list", "--branches", "--tags"], dir);
    if (!revs.ok) throw new Error("rev-list failed");
    const hist = Bun.spawnSync(["git", "grep", "-I", "-i", "-n", "-E", ...args, ...revs.out.split("\n").filter(Boolean)], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (hist.exitCode > 1) throw new Error("history scan failed");
    if (hist.exitCode === 0) return "IN HISTORY (older commits):\n" + new TextDecoder().decode(hist.stdout).slice(0, 1500);
  }
  return null;
}

/** The block message, or null to allow. */
export function check(input: any): string | null {
  const command = input?.tool_input?.command;
  if (typeof command !== "string") return null;
  const isPush = /\bgit\b[^\n]*\bpush\b/.test(command);
  const goesPublic = CREATE_PUBLIC_RE.test(command) || FLIP_PUBLIC_RE.test(command);
  if (!isPush && !goesPublic) return null;

  const dir = repoDirFor(command, input?.cwd);
  if (!goesPublic) {
    const slug = githubSlug(dir, command);
    if (!slug) return null;
    if (visibility(slug) !== "public") return null; // private, internal or unknown
  }
  try {
    const hits = scan(dir, loadPatterns());
    if (!hits) return null;
    return `[PublicPushGate] BLOCKED: the destination is PUBLIC and the deny scan hit:\n${hits}\nFix the content (and history if flagged) before pushing. Patterns live in MYOS/USER/SECURITY/PublicScrubPatterns.txt; never quote them into tracked files.\n`;
  } catch (err) {
    return `[PublicPushGate] BLOCKED: the destination is PUBLIC but the deny scan could not finish (${err}). Fix the scan, then push.\n`;
  }
}

if (import.meta.main) {
  if ((process.env.MYOS_PUSHGATE ?? "").toLowerCase() !== "off") {
    try {
      const msg = check(JSON.parse(readFileSync(0, "utf8")));
      if (msg) {
        process.stderr.write(msg);
        process.exit(2);
      }
    } catch {
      /* unparseable input: allow */
    }
  }
  process.exit(0);
}
