#!/usr/bin/env bun
/**
 * MyosConfig.ts: typed user-config loader.
 *
 * The interface between system code (this file ships with myos) and user data
 * (the values, in MYOS/USER/CONFIG/MYOS_CONFIG.toml). System code reads
 * identity, path roots and switches through `loadMyosConfig()`; the path
 * rooting happens here.
 *
 * Format: TOML, parsed by Bun's native require() (no dependency).
 *
 * Sections:
 *   [principal]  name, timezone (required), pronunciation (optional)
 *   [paths]      user_dir, memory_dir, code (all optional, ~ expanded)
 *   [tokens]     dir: where MyTokens keeps its session ledger (optional)
 *   [gates]      blocking (bool, default false): may the ISA Stop gates block?
 *                verification ("block" | "log" | "off", default "block")
 * The hooks read [gates] themselves with a tiny parser (hooks/lib/gates.ts),
 * so the key names here and there must stay the same.
 *
 * The config file is optional to every consumer: install.sh writes it on the
 * first install from MYOS/TOOLS/MYOS_CONFIG.toml.example; `myosUserDir()` shows
 * the fallback pattern for code that must work without it.
 *
 * Location: $MYOS_CONFIG_PATH, else $MYOS_CONFIG_FILE (the name the hooks use),
 * else <MYOS_DIR>/USER/CONFIG/MYOS_CONFIG.toml, where MYOS_DIR defaults to
 * $CLAUDE_CONFIG_DIR/MYOS, else ~/.myos/MYOS.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

// ─────────── Types ───────────

export interface MyosPrincipal {
  name: string;
  pronunciation?: string;
  timezone: string;
}

export interface MyosPaths {
  userDir: string;
  memoryDir: string;
  /** Where Harry's code lives (default ~/Code). */
  code: string;
}

export interface MyosTokens {
  /** MyTokens' ledger dir (default <memoryDir>/OBSERVABILITY/TOKENS). */
  dir: string;
}

export type VerificationMode = "block" | "log" | "off";

export interface MyosGates {
  /** May the ISA Stop gates block a response? Default false: log only. */
  blocking: boolean;
  /** VerificationGate mode. Default "block" (the one gate that ships armed). */
  verification: VerificationMode;
}

export interface MyosConfig {
  principal: MyosPrincipal;
  paths: MyosPaths;
  tokens: MyosTokens;
  gates: MyosGates;
}

// ─────────── Resolution ───────────

const DEFAULT_HOME = process.env.HOME || homedir();

// Expand a leading `~` or `~/`. node:fs never expands tildes, so every path
// this loader returns must be absolute.
function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return DEFAULT_HOME;
  if (p.startsWith("~/")) return resolve(DEFAULT_HOME, p.slice(2));
  return p;
}

function defaultMyosDir(): string {
  if (process.env.MYOS_DIR) return expandHome(process.env.MYOS_DIR);
  const configRoot = process.env.CLAUDE_CONFIG_DIR || resolve(DEFAULT_HOME, ".myos");
  return resolve(expandHome(configRoot), "MYOS");
}

export function defaultConfigPath(): string {
  return (
    process.env.MYOS_CONFIG_PATH ??
    process.env.MYOS_CONFIG_FILE ??
    resolve(defaultMyosDir(), "USER/CONFIG/MYOS_CONFIG.toml")
  );
}

let cache: { config: MyosConfig; mtime: number; path: string } | null = null;

export function loadMyosConfig(opts: { path?: string; force?: boolean } = {}): MyosConfig {
  const path = opts.path ?? defaultConfigPath();

  if (!existsSync(path)) {
    throw new Error(
      `MyosConfig: config file not found at ${path}. ` +
        `Copy MYOS/TOOLS/MYOS_CONFIG.toml.example to that path, or set MYOS_CONFIG_PATH.`,
    );
  }

  const mtime = statSync(path).mtimeMs;
  if (!opts.force && cache && cache.path === path && cache.mtime === mtime) {
    return cache.config;
  }

  // Invalidate Bun's require cache so re-reads pick up edits.
  try {
    delete require.cache[require.resolve(path)];
  } catch {
    // first read: nothing cached yet
  }

  const raw = require(path) as unknown;
  const validated = validateAndNormalize(raw, path);
  cache = { config: validated, mtime, path };
  return validated;
}

export function clearMyosConfigCache(): void {
  cache = null;
}

/**
 * The user directory, falling back to the conventional location when there is
 * no config yet. Used by hooks/lib/identity and anything composing user paths.
 */
export function myosUserDir(): string {
  try {
    return loadMyosConfig().paths.userDir;
  } catch {
    return resolve(defaultMyosDir(), "USER");
  }
}

// ─────────── Validation ───────────

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function validateAndNormalize(raw: unknown, path: string): MyosConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`MyosConfig: ${path} did not parse to an object`);
  }
  const root = raw as Record<string, any>;

  const principal = root.principal ?? {};
  if (!str(principal.name)) {
    throw new Error(`MyosConfig: [principal] requires a non-empty name: see ${path}`);
  }
  if (!str(principal.timezone)) {
    throw new Error(`MyosConfig: [principal] requires a non-empty timezone: see ${path}`);
  }

  const myosDir = defaultMyosDir();
  const memoryDir = expandHome(
    str(root.paths?.memory_dir) ?? str(root.paths?.memoryDir) ?? resolve(myosDir, "MEMORY"),
  );

  const gates = root.gates ?? {};
  if (gates.blocking !== undefined && typeof gates.blocking !== "boolean") {
    throw new Error(`MyosConfig: [gates] blocking must be true or false: see ${path}`);
  }
  const verification = str(gates.verification)?.toLowerCase();
  if (verification !== undefined && !["block", "log", "off"].includes(verification)) {
    throw new Error(`MyosConfig: [gates] verification must be "block", "log" or "off": see ${path}`);
  }

  return {
    principal: {
      name: principal.name,
      pronunciation: str(principal.pronunciation),
      timezone: principal.timezone,
    },
    paths: {
      userDir: expandHome(str(root.paths?.user_dir) ?? str(root.paths?.userDir) ?? resolve(myosDir, "USER")),
      memoryDir,
      code: expandHome(str(root.paths?.code) ?? resolve(DEFAULT_HOME, "Code")),
    },
    tokens: {
      dir: expandHome(str(root.tokens?.dir) ?? resolve(memoryDir, "OBSERVABILITY/TOKENS")),
    },
    gates: {
      blocking: gates.blocking === true,
      verification: (verification as VerificationMode | undefined) ?? "block",
    },
  };
}

// ─────────── CLI entry ───────────

if (import.meta.main) {
  try {
    console.log(JSON.stringify(loadMyosConfig(), null, 2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
