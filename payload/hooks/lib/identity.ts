/**
 * Central Identity Loader
 * Single source of truth for assistant display name and Principal identity
 *
 * Reads from frontmatter in:
 *   - MYOS/USER/DIGITAL_ASSISTANT/DA_IDENTITY.md (optional display-name override)
 *   - MYOS/USER/PRINCIPAL/PRINCIPAL_IDENTITY.md  (canonical Principal identity)
 *
 * Falls back to settings.json daidentity/principal blocks, then to the myos
 * defaults below. All hooks and tools should import from here.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { loadMyosConfig } from '../../MYOS/TOOLS/MyosConfig';

const HOME = process.env.HOME!;
const SETTINGS_PATH = join(HOME, '.myos/settings.json');

// Identity-file paths derive from MyosConfig's userDir. On fresh installs where
// MYOS_CONFIG.toml hasn't been created yet, fall back to the conventional
// MYOS/USER/ location so identity loading still bootstraps. Lazy try/catch so
// a malformed MyosConfig never breaks identity bootstrap.
function myosUserDir(): string {
  try {
    return loadMyosConfig().paths.userDir;
  } catch {
    return join(HOME, '.myos/MYOS/USER');
  }
}
const DA_IDENTITY_PATH = join(myosUserDir(), 'DIGITAL_ASSISTANT/DA_IDENTITY.md');
const PRINCIPAL_IDENTITY_PATH = join(myosUserDir(), 'PRINCIPAL/PRINCIPAL_IDENTITY.md');

const DEFAULT_IDENTITY = {
  name: 'myos',
  fullName: 'myos',
  displayName: 'myos',
  color: '#3B82F6',
};

const DEFAULT_PRINCIPAL = {
  name: 'User',
  pronunciation: '',
  timezone: 'UTC',
};

export interface Identity {
  name: string;
  fullName: string;
  displayName: string;
  color: string;
}

export interface Principal {
  name: string;
  pronunciation: string;
  timezone: string;
}

export interface Settings {
  daidentity?: Partial<Identity>;
  principal?: Partial<Principal>;
  env?: Record<string, string>;
  [key: string]: unknown;
}

let cachedSettings: Settings | null = null;
let cachedDaFm: Record<string, any> | null = null;
let cachedPrincipalFm: Record<string, any> | null = null;

function loadFrontmatter(path: string): Record<string, any> | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    return parseYaml(match[1]) || null;
  } catch {
    return null;
  }
}

function loadDaFrontmatter(): Record<string, any> {
  if (cachedDaFm) return cachedDaFm;
  cachedDaFm = loadFrontmatter(DA_IDENTITY_PATH) ?? {};
  return cachedDaFm;
}

function loadPrincipalFrontmatter(): Record<string, any> {
  if (cachedPrincipalFm) return cachedPrincipalFm;
  cachedPrincipalFm = loadFrontmatter(PRINCIPAL_IDENTITY_PATH) ?? {};
  return cachedPrincipalFm;
}

function loadSettings(): Settings {
  if (cachedSettings) return cachedSettings;
  try {
    if (!existsSync(SETTINGS_PATH)) {
      cachedSettings = {};
      return cachedSettings;
    }
    const content = readFileSync(SETTINGS_PATH, 'utf-8');
    cachedSettings = JSON.parse(content);
    return cachedSettings!;
  } catch {
    cachedSettings = {};
    return cachedSettings;
  }
}

/**
 * Get assistant identity (display name + colour).
 * Reads settings.daidentity first (canonical runtime read point),
 * falls back to DA_IDENTITY.md frontmatter (authoring source), then to the
 * myos defaults.
 */
export function getIdentity(): Identity {
  const settings = loadSettings();
  const daidentity = (settings.daidentity || {}) as any;

  if (daidentity.name) {
    const envDA = settings.env?.DA;
    return {
      name: daidentity.name || envDA || DEFAULT_IDENTITY.name,
      fullName: daidentity.fullName || daidentity.name || envDA || DEFAULT_IDENTITY.fullName,
      displayName: daidentity.displayName || daidentity.name || envDA || DEFAULT_IDENTITY.displayName,
      color: daidentity.color || DEFAULT_IDENTITY.color,
    };
  }

  // Fallback: DA_IDENTITY.md frontmatter (authoring source)
  const fm = loadDaFrontmatter();
  const core = fm.core ?? {};
  return {
    name: core.name || DEFAULT_IDENTITY.name,
    fullName: core.full_name || core.name || DEFAULT_IDENTITY.fullName,
    displayName: core.display_name || core.name || DEFAULT_IDENTITY.displayName,
    color: core.color || DEFAULT_IDENTITY.color,
  };
}

/**
 * Get Principal (human owner) identity.
 * Reads frontmatter from PRINCIPAL_IDENTITY.md first, falls back to settings.principal.
 */
export function getPrincipal(): Principal {
  const fm = loadPrincipalFrontmatter();
  const core = fm.core ?? {};

  if (core.name) {
    return {
      name: core.name,
      pronunciation: core.pronunciation || DEFAULT_PRINCIPAL.pronunciation,
      timezone: core.timezone || DEFAULT_PRINCIPAL.timezone,
    };
  }

  // Fallback
  const settings = loadSettings();
  const principal = settings.principal || {};
  const envPrincipal = settings.env?.PRINCIPAL;
  return {
    name: principal.name || envPrincipal || DEFAULT_PRINCIPAL.name,
    pronunciation: principal.pronunciation || DEFAULT_PRINCIPAL.pronunciation,
    timezone: principal.timezone || DEFAULT_PRINCIPAL.timezone,
  };
}

/**
 * Clear cache (useful for testing or when source files change)
 */
export function clearCache(): void {
  cachedSettings = null;
  cachedDaFm = null;
  cachedPrincipalFm = null;
}

export function getPrincipalName(): string {
  return getPrincipal().name;
}

export function getSettings(): Settings {
  return loadSettings();
}

export function getDefaultIdentity(): Identity {
  return { ...DEFAULT_IDENTITY };
}

export function getDefaultPrincipal(): Principal {
  return { ...DEFAULT_PRINCIPAL };
}

/**
 * Read principal preferences (e.g. temperature_unit) from frontmatter.
 */
export function getPrincipalPreferences(): Record<string, any> {
  return loadPrincipalFrontmatter().preferences ?? {};
}

/**
 * Read principal tech_stack from frontmatter.
 */
export function getTechStack(): Record<string, any> {
  return loadPrincipalFrontmatter().tech_stack ?? {};
}
