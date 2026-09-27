/**
 * Centralized Path Resolution
 *
 * Two root directories:
 * - MYOS_DIR (~/.myos/MYOS): myos data: MEMORY, ALGORITHM, TOOLS, RULES, DOCUMENTATION
 * - myos home (~/.myos): Claude Code config dir: settings, skills, hooks, commands, agents
 *
 * Usage:
 *   import { getMyosDir, getClaudeDir, myosPath } from './lib/paths';
 */

import { homedir } from 'os';
import { join } from 'path';

/**
 * Expand shell variables in a path string
 * Supports: $HOME, ${HOME}, ~
 */
export function expandPath(path: string): string {
  const home = homedir();

  return path
    .replace(/^\$HOME(?=\/|$)/, home)
    .replace(/^\$\{HOME\}(?=\/|$)/, home)
    .replace(/^~(?=\/|$)/, home);
}

/**
 * Get the myos data directory (expanded).
 *
 * Priority:
 *   1. CLAUDE_PLUGIN_ROOT (plugin install) → <root>/MYOS
 *   2. MYOS_DIR env var (expanded)
 *   3. <config dir>/MYOS, where the config dir is getClaudeDir()
 *      (CLAUDE_CONFIG_DIR, else ~/.myos): the two roots never disagree
 *
 * The CLAUDE_PLUGIN_ROOT guard MUST precede the MYOS_DIR check: in a packed
 * plugin, the launcher exports MYOS_DIR equal to CLAUDE_PLUGIN_ROOT (the
 * flattened config-dir root), so trusting MYOS_DIR first would drop the trailing
 * /MYOS segment and mis-resolve myosPath() to ROOT/MEMORY instead of
 * ROOT/MYOS/MEMORY. Resolving via getClaudeDir() + MYOS keeps the live
 * ~/.myos/MYOS → plugin ${ROOT}/MYOS mapping the packer's rewrite assumes.
 */
export function getMyosDir(): string {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return join(getClaudeDir(), 'MYOS');
  }

  const envMyosDir = process.env.MYOS_DIR;

  if (envMyosDir) {
    return expandPath(envMyosDir);
  }

  return join(getClaudeDir(), 'MYOS');
}

/**
 * Get the Claude Code home directory.
 *
 * Plugin install: CLAUDE_PLUGIN_ROOT is the flattened plugin root that plays the
 * live ~/.myos role (skills/ and hooks/ sit directly under it, matching live
 * .myos/skills and .myos/hooks). Live default: ~/.myos: byte-identical to
 * pre-plugin behavior, since CLAUDE_PLUGIN_ROOT is unset on a normal install.
 */
export function getClaudeDir(): string {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

  if (pluginRoot) {
    return expandPath(pluginRoot);
  }

  // myos runs Claude Code with CLAUDE_CONFIG_DIR=~/.myos (set by bin/myos);
  // honoring it here keeps hooks working if a PM relocates their myos home.
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir) {
    return expandPath(configDir);
  }

  return join(homedir(), '.myos');
}

/**
 * Get the settings.json path (lives in Claude home)
 */
export function getSettingsPath(): string {
  return join(getClaudeDir(), 'settings.json');
}

/**
 * Get the authoritative .env path (~/.myos/.env).
 * All credentials live here: there is no second .env location.
 */
export function getEnvPath(): string {
  return join(getClaudeDir(), '.env');
}

/**
 * Get a path relative to MYOS_DIR
 */
export function myosPath(...segments: string[]): string {
  return join(getMyosDir(), ...segments);
}

/**
 * Get the hooks directory (lives in Claude home)
 */
export function getHooksDir(): string {
  return join(getClaudeDir(), 'hooks');
}

/**
 * Get the skills directory (lives in Claude home)
 */
export function getSkillsDir(): string {
  return join(getClaudeDir(), 'skills');
}

/**
 * Get the MEMORY directory
 */
export function getMemoryDir(): string {
  return myosPath('MEMORY');
}

/**
 * Where LastResponseCache writes and DriftReminder reads the previous answer:
 * one file per session so concurrent sessions never read each other's; the
 * unkeyed name only when the harness sent no session id.
 */
export function lastResponsePath(sessionId?: string): string {
  const safe = (sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return safe
    ? myosPath('MEMORY', 'STATE', 'last-response', `${safe}.txt`)
    : myosPath('MEMORY', 'STATE', 'last-response.txt');
}
