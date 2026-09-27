/**
 * gates.ts: the one place a gate hook asks "am I on, and may I block?".
 *
 * Every Stop gate and every ISA guard in myos calls these three helpers and
 * nothing else decides the answer, so the kill switch and the log-only mode
 * behave the same in all of them.
 *
 *   MYOS_GATES=off    every gate exits 0 with no output (the kill switch)
 *   MYOS_GATES=log    every gate observes and logs, never blocks
 *   MYOS_GATES=block  every gate may block (overrides the config file)
 *   unset             MYOS_CONFIG.toml [gates] blocking decides (default false)
 *
 * A gate that is not blocking still computes its verdict and writes it to
 * MEMORY/OBSERVABILITY/<log>.jsonl. That is what GateReview.ts reads when the
 * two week trial asks whether the gate may be armed.
 *
 * ISA format: an ISA whose frontmatter carries an `effort:` key is a pre
 * 2026-09-28 twelve section ISA. The gates never judge those; they were
 * written against a format that has since changed and they are history.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getMyosDir } from "./paths.ts";
import { readConfigValue } from "./config.ts";

export type GateMode = "off" | "log" | "block";

/** The effective mode after env override and config. */
export function gateMode(): GateMode {
  const env = (process.env.MYOS_GATES ?? "").trim().toLowerCase();
  if (env === "off" || env === "0" || env === "false") return "off";
  if (env === "log") return "log";
  if (env === "block" || env === "on" || env === "1" || env === "true") return "block";
  return configBlocking() ? "block" : "log";
}

/** True when every gate must stay silent. Check this first and exit 0. */
export function gatesOff(): boolean {
  return gateMode() === "off";
}

/** True when a failing verdict may become a block decision. */
export function gateBlocking(): boolean {
  return gateMode() === "block";
}

/**
 * Reads `[gates] blocking = true|false` from MYOS/USER/CONFIG/MYOS_CONFIG.toml
 * without a TOML parser (hooks stay dependency free). Missing file or key
 * means false: a fresh install never blocks.
 */
export function configBlocking(): boolean {
  const path = process.env.MYOS_CONFIG_FILE ?? join(getMyosDir(), "USER", "CONFIG", "MYOS_CONFIG.toml");
  if (!existsSync(path)) return false;
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  const section = body.split(/^\[gates\]\s*$/m)[1];
  if (!section) return false;
  const own = section.split(/^\[/m)[0];
  const m = own.match(/^\s*blocking\s*=\s*(true|false)\s*(#.*)?$/m);
  return m?.[1] === "true";
}

export interface GateRecord {
  gate: string;
  verdict: "pass" | "fail" | "skip";
  reason?: string;
  session?: string;
  blocked?: boolean;
  [extra: string]: unknown;
}

/**
 * Appends one JSON line to MEMORY/OBSERVABILITY/<file>. Never throws: a gate
 * that cannot log must still let the turn finish.
 */
export function gateLog(file: string, record: GateRecord): void {
  try {
    const path = join(getMyosDir(), "MEMORY", "OBSERVABILITY", file);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), mode: gateMode(), ...record }) + "\n");
  } catch {
    /* logging is best effort */
  }
}

/** Legacy detection: the twelve section format always wrote `effort:`. */
export function isLegacyIsa(frontmatter: Record<string, string> | null | undefined): boolean {
  return !!frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, "effort");
}

/**
 * The uniform block shape for a Stop hook: exit 2 with the reason on stderr
 * is what Claude Code reads as "block and show this". Callers use it only
 * when gateBlocking() is true; otherwise they log and exit 0.
 */
export function blockDecision(reason: string): never {
  process.stderr.write(reason.endsWith("\n") ? reason : reason + "\n");
  process.exit(2);
}

/** The mode MYOS_GATES names explicitly, or null when it is unset or unknown. */
export function envGateMode(): GateMode | null {
  const env = (process.env.MYOS_GATES ?? "").trim().toLowerCase();
  if (env === "off" || env === "0" || env === "false") return "off";
  if (env === "log") return "log";
  if (env === "block" || env === "on" || env === "1" || env === "true") return "block";
  return null;
}

/**
 * VerificationGate is the one gate that ships armed. MYOS_GATES still wins
 * (off silences it, log demotes it); otherwise `[gates] verification` in the
 * config may say "log" or "off"; the default is "block".
 */
export function verificationMode(): GateMode {
  const env = envGateMode();
  if (env) return env;
  const cfg = (readConfigValue("gates", "verification") ?? "").toLowerCase();
  if (cfg === "off" || cfg === "log") return cfg;
  return "block";
}

/** A block the dispatcher may emit, or null. */
export type GateDecision = { decision: "block"; reason: string } | null;

/**
 * What a gate hands back to StopGates. `fail` is the verdict whatever the mode;
 * `block` is set only when the gate decided a block is allowed right now.
 */
export interface GateOutcome {
  gate: string;
  fail: boolean;
  reason?: string;
  block?: boolean;
}
