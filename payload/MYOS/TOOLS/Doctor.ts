#!/usr/bin/env bun
/**
 * @version 1.1.0
 * Doctor: myos capability prober and manifest writer.
 *
 * Probes the core toolchain myos's hooks/skills depend on (bun, rg, git, jq,
 * gh, claude), the optional capabilities that degrade gracefully without them
 * (rtk, interceptor, ffmpeg, whisper), plus the config dir health
 * (MYOS_CONFIG.toml, trial.json, settings.json hooks, MEMORY dirs): and writes
 * an advisory capability manifest. Misses are listed, never fatal. Capabilities
 * that are assumed but never verified degrade silently; anything dormant at
 * rest is invisible to change-scoped checks.
 *
 * Design contract (RedTeam-derived, 2026-07-12):
 *   - The manifest is a TTL'd advisory CACHE, never truth. Readers treat it
 *     as untrusted input; doctrine-critical gates re-verify live.
 *   - Four states: live | broken | declined | stale. Declined is first-class
 *     and permanently silent: opted-out is not a defect.
 *   - No scores, no percentages. Diagnostic register only.
 *   - Never install-fatal: default run always exits 0, every probe is
 *     timeout-bounded, network probes are opt-in (--network) and only fire
 *     for capabilities the user has configured.
 *   - Tamper-evident: manifest carries a salted integrity hash (salt is a
 *     separate 0600 file). Detects casual/model edits, not a determined
 *     local attacker.
 *   - No network probes for MCP connectors: those live claude.ai-side.
 *
 * Usage:
 *   bun Doctor.ts                  # probe (offline checks), table output
 *   bun Doctor.ts --network        # include network probes for configured caps
 *   bun Doctor.ts --json           # machine-readable
 *   bun Doctor.ts --no-network     # explicit offline (default is offline)
 *   bun Doctor.ts decline <cap>    # mark capability declined (silent forever)
 *   bun Doctor.ts enable <cap>     # undo a decline
 *   bun Doctor.ts ack              # acknowledge current broken set (statusline delta)
 *   bun Doctor.ts --statusline     # one glyph if NEW regression since ack, else empty
 *   bun Doctor.ts --verify         # integrity-check the manifest (exit 2 on tamper)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync, accessSync, statSync, constants as fsConstants } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { createHash, randomBytes } from 'crypto';

const HOME = process.env.HOME || '';
// Where state may be written. Resolved, in order, from CLAUDE_CONFIG_DIR, from
// MYOS_DIR, or from this script's own location when it sits in an installed
// tree (<root>/MYOS/TOOLS with <root>/MYOS/VERSION beside it). A run with none
// of those (e.g. straight from the repo payload in a plain shell) probes and
// prints but writes nothing: that is how a stray ~/.myos once got created.
function resolveStateRoot(): string | null {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  if (process.env.MYOS_DIR) return dirname(process.env.MYOS_DIR.replace(/^\$HOME/, HOME).replace(/^~(?=\/)/, HOME));
  const installed = resolvePath(import.meta.dir, '..', '..');
  if (existsSync(join(installed, 'MYOS', 'VERSION'))) return installed;
  return null;
}
const STATE_ROOT = resolveStateRoot();
const CAN_WRITE = STATE_ROOT !== null;
const CONFIG_ROOT = STATE_ROOT ?? join(HOME, '.myos');
const MYOS_DIR = (process.env.MYOS_DIR || join(CONFIG_ROOT, 'MYOS'))
  .replace(/^\$HOME/, HOME).replace(/^~(?=\/)/, HOME);
const STATE_DIR = join(MYOS_DIR, 'MEMORY', 'STATE');
const MANIFEST = join(STATE_DIR, 'capabilities.json');
const SALT_FILE = join(STATE_DIR, '.capabilities-salt');
const HEARTBEAT = join(STATE_DIR, 'doctor-heartbeat.json');
const PROBE_TIMEOUT_MS = 15_000;

type CapState = 'live' | 'broken' | 'declined' | 'stale';

interface CapResult {
  state: CapState;
  checkedAt: string;      // ISO timestamp of last real probe
  ttlHours: number;       // readers treat entries older than this as stale
  detail: string;         // one-line human diagnosis
  fixCmd: string | null;  // copy-paste remediation, null when live/declined
  probeClass: 'offline' | 'network';
}

interface Manifest {
  version: 1;
  updatedAt: string;
  note: string;
  capabilities: Record<string, CapResult>;
  ackedBroken: string[];  // broken set acknowledged via `ack` (statusline delta base)
  integrity?: string;
}

interface CapSpec {
  id: string;
  title: string;
  powers: string;
  ttlHours: number;
  // Returns null when the capability has no local configuration at all , 
  // network probing it would be pre-consent egress (never allowed).
  configured: () => boolean;
  probeOffline: () => Promise<{ ok: boolean; detail: string }>;
  probeNetwork?: () => Promise<{ ok: boolean; detail: string }>;
  fixCmd: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function run(cmd: string[], timeoutMs = PROBE_TIMEOUT_MS): Promise<{ code: number; out: string }> {
  try {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
    // Race the read: a killed child's grandchildren can inherit the stdout pipe
    // and hold it open past the kill, so awaiting stream EOF alone can hang.
    return await Promise.race([
      (async () => {
        const out = await new Response(proc.stdout).text();
        const code = await proc.exited;
        return { code, out: out.trim() };
      })(),
      new Promise<{ code: number; out: string }>(resolve =>
        setTimeout(() => { try { proc.kill(9); } catch {} resolve({ code: 124, out: '' }); }, timeoutMs)),
    ]);
  } catch {
    return { code: 127, out: '' };
  }
}

function which(bin: string): boolean {
  const paths = (process.env.PATH || '').split(':');
  return paths.some(p => p && existsSync(join(p, bin)));
}



// MEMORY/ subdirs the installer creates (install.sh) and hooks write into
// all session long. Kept as one list so Doctor and install.sh can't drift apart.
const CORE_MEMORY_DIRS = ['WORK', 'KNOWLEDGE', 'STATE', 'OBSERVABILITY', 'OBSERVABILITY/TOKENS'];

function memoryDirsWritable(): { ok: boolean; detail: string } {
  const missing: string[] = [];
  const unwritable: string[] = [];
  for (const dir of CORE_MEMORY_DIRS) {
    const dirPath = join(MYOS_DIR, 'MEMORY', dir);
    if (!existsSync(dirPath)) { missing.push(dir); continue; }
    try { accessSync(dirPath, fsConstants.W_OK); } catch { unwritable.push(dir); }
  }
  if (missing.length === 0 && unwritable.length === 0) {
    return { ok: true, detail: `all ${CORE_MEMORY_DIRS.length} MEMORY/ subdirs present + writable` };
  }
  const parts: string[] = [];
  if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
  if (unwritable.length) parts.push(`not writable: ${unwritable.join(', ')}`);
  return { ok: false, detail: parts.join('; ') };
}

// ── capability registry ──────────────────────────────────────────────────────
function isExecutable(file: string): boolean {
  try { accessSync(file, fsConstants.X_OK); return true; } catch { return false; }
}

/** Exported shape for the trial reviewer: a due review is a reminder, not a fault. */
function trialStatus(): { ok: boolean; detail: string } {
  const file = join(MYOS_DIR, 'USER', 'CONFIG', 'trial.json');
  if (!existsSync(file)) return { ok: false, detail: 'trial.json missing' };
  let t: Record<string, unknown>;
  try { t = JSON.parse(readFileSync(file, 'utf8')); } catch { return { ok: false, detail: 'trial.json is not valid JSON' }; }
  const today = new Date().toISOString().slice(0, 10);
  const due: string[] = [];
  if (t.gate_review_done !== true && typeof t.gate_review_due === 'string' && t.gate_review_due <= today) due.push(`gate review due ${t.gate_review_due}`);
  if (t.doctrine_review_done !== true && typeof t.doctrine_review_due === 'string' && t.doctrine_review_due <= today) due.push(`doctrine review due ${t.doctrine_review_due}`);
  return {
    ok: true,
    detail: due.length
      ? `present; REVIEW DUE: ${due.join(', ')}`
      : `present; gate review ${String(t.gate_review_due)}, doctrine review ${String(t.doctrine_review_due)}`,
  };
}

export const PROJECTS_CEILING_BYTES = 6000;

// Over the ceiling is a warning: Doctor lists it with a fix and still exits 0.
function projectsIndexSize(): { ok: boolean; detail: string } {
  const file = join(MYOS_DIR, 'USER', 'PROJECTS.md');
  if (!existsSync(file)) return { ok: true, detail: 'no PROJECTS.md yet' };
  const bytes = statSync(file).size;
  return bytes < PROJECTS_CEILING_BYTES
    ? { ok: true, detail: `${bytes} bytes (ceiling ${PROJECTS_CEILING_BYTES})` }
    : { ok: false, detail: `WARNING: ${bytes} bytes, over the ${PROJECTS_CEILING_BYTES} byte ceiling` };
}

function settingsHooks(): { ok: boolean; detail: string } {
  const file = join(CONFIG_ROOT, 'settings.json');
  if (!existsSync(file)) return { ok: false, detail: 'settings.json missing' };
  try {
    const hooks = JSON.parse(readFileSync(file, 'utf8')).hooks;
    const events = hooks && typeof hooks === 'object' ? Object.keys(hooks) : [];
    return events.length
      ? { ok: true, detail: `hooks registered for ${events.length} event(s)` }
      : { ok: false, detail: 'settings.json has no hooks block' };
  } catch {
    return { ok: false, detail: 'settings.json is not valid JSON' };
  }
}

// Network probes deliberately stop at this machine's boundary: MCP
// connectors run claude.ai-side, so there is nothing here to probe for them.

const CAPS: CapSpec[] = [
  // ── core toolchain: every hook/tool assumes these are present ──────────
  {
    id: 'bun',
    title: 'bun runtime',
    powers: 'runs every myos hook and tool',
    ttlHours: 24 * 30,
    configured: () => true,
    probeOffline: async () => which('bun')
      ? { ok: true, detail: 'bun on PATH' }
      : { ok: false, detail: 'bun not on PATH' },
    fixCmd: 'install bun: https://bun.sh',
  },
  {
    id: 'ripgrep',
    title: 'ripgrep (rg)',
    powers: 'PreToolGuard scans, ContextReduction rewrites, fast code search',
    ttlHours: 24 * 30,
    configured: () => true,
    probeOffline: async () => which('rg')
      ? { ok: true, detail: 'rg on PATH' }
      : { ok: false, detail: 'rg not on PATH' },
    fixCmd: 'brew install ripgrep  (or your package manager)',
  },
  {
    id: 'git',
    title: 'git',
    powers: 'ISASync/CheckpointPerISC auto-commit, session + repo history',
    ttlHours: 24 * 30,
    configured: () => true,
    probeOffline: async () => which('git')
      ? { ok: true, detail: 'git on PATH' }
      : { ok: false, detail: 'git not on PATH' },
    fixCmd: 'install git (usually preinstalled on macOS; brew install git otherwise)',
  },
  {
    id: 'jq',
    title: 'jq',
    powers: 'ContextReduction hook, Interceptor preflight/profile scripts',
    ttlHours: 24 * 30,
    configured: () => true,
    probeOffline: async () => which('jq')
      ? { ok: true, detail: 'jq on PATH' }
      : { ok: false, detail: 'jq not on PATH' },
    fixCmd: 'brew install jq  (or your package manager)',
  },
  {
    id: 'gh',
    title: 'GitHub CLI (gh)',
    powers: 'repo creation, PRs, Release.ts (gh release create)',
    ttlHours: 24 * 30,
    configured: () => true,
    probeOffline: async () => which('gh')
      ? { ok: true, detail: 'gh on PATH' }
      : { ok: false, detail: 'gh not on PATH' },
    fixCmd: 'brew install gh && gh auth login',
  },
  {
    id: 'claude',
    title: 'claude CLI',
    powers: 'the myos launcher (bin/myos) and every Claude Code session',
    ttlHours: 24 * 30,
    configured: () => true,
    probeOffline: async () => which('claude')
      ? { ok: true, detail: 'claude on PATH' }
      : { ok: false, detail: 'claude not on PATH: install Claude Code' },
    fixCmd: 'install Claude Code, then re-run: bun MYOS/TOOLS/Doctor.ts',
  },

  // ── optional: myos degrades gracefully without these ───────────────────
  {
    id: 'rtk',
    title: 'rtk (context reduction)',
    powers: '60-90% token savings on rewritten Bash commands',
    ttlHours: 24 * 30,
    configured: () => which('rtk'),
    probeOffline: async () => which('rtk')
      ? { ok: true, detail: 'rtk on PATH: ContextReduction hook active' }
      : { ok: false, detail: 'rtk not installed: ContextReduction hook no-ops (harmless)' },
    fixCmd: 'brew install rtk  (no setup after; the hook activates once rtk is on PATH)',
  },
  {
    id: 'interceptor',
    title: 'Interceptor CLI',
    powers: 'real-Chrome verification for the Interceptor skill (Claude-in-Chrome is the fallback)',
    ttlHours: 24 * 7,
    configured: () => true,
    probeOffline: async () => {
      if (which('interceptor')) return { ok: true, detail: 'interceptor on PATH' };
      if (isExecutable(join(HOME, 'bin', 'interceptor'))) return { ok: true, detail: '~/bin/interceptor present' };
      return { ok: false, detail: 'interceptor not found (PATH or ~/bin/interceptor): verify with Claude-in-Chrome instead' };
    },
    fixCmd: 'install the interceptor CLI to ~/bin/interceptor: see skills/Interceptor/SKILL.md',
  },
  {
    id: 'ffmpeg',
    title: 'ffmpeg',
    powers: 'Remotion render, audio and video transcode, Interceptor capture',
    ttlHours: 24 * 30,
    configured: () => which('ffmpeg'),
    probeOffline: async () => which('ffmpeg')
      ? { ok: true, detail: 'ffmpeg on PATH' }
      : { ok: false, detail: 'ffmpeg not installed: needed by Remotion and audio work' },
    fixCmd: 'brew install ffmpeg  (or your package manager)',
  },
  {
    id: 'whisper',
    title: 'whisper (speech to text)',
    powers: 'transcripts for video and audio work (whisper-cli or ~/bin/transcribe)',
    ttlHours: 24 * 30,
    configured: () => true,
    probeOffline: async () => {
      if (which('whisper-cli')) return { ok: true, detail: 'whisper-cli on PATH' };
      if (isExecutable(join(HOME, 'bin', 'transcribe'))) return { ok: true, detail: '~/bin/transcribe present' };
      return { ok: false, detail: 'neither whisper-cli on PATH nor ~/bin/transcribe' };
    },
    fixCmd: 'brew install whisper-cpp  (provides whisper-cli)',
  },

  // ── config + memory wiring ───────────────────────────────────────────────
  {
    id: 'myos-config',
    title: 'MYOS_CONFIG.toml',
    powers: 'your name and timezone, paths, token settings, whether ISA gates may block',
    ttlHours: 24 * 30,
    configured: () => true,
    probeOffline: async () => {
      const configPath = join(MYOS_DIR, 'USER', 'CONFIG', 'MYOS_CONFIG.toml');
      return existsSync(configPath)
        ? { ok: true, detail: `found at ${configPath}` }
        : { ok: false, detail: 'not created yet: myos falls back to defaults' };
    },
    fixCmd: `mkdir -p ${join(MYOS_DIR, 'USER', 'CONFIG')} && cp ${join(MYOS_DIR, 'TOOLS', 'MYOS_CONFIG.toml.example')} ${join(MYOS_DIR, 'USER', 'CONFIG', 'MYOS_CONFIG.toml')}`,
  },
  {
    id: 'trial',
    title: 'trial.json (review schedule)',
    powers: 'the dated gate review and doctrine review of the trial period',
    ttlHours: 24 * 7,
    configured: () => true,
    probeOffline: async () => trialStatus(),
    fixCmd: 're-run ./install.sh from the myos repo (writes MYOS/USER/CONFIG/trial.json when absent)',
  },
  {
    id: 'settings-hooks',
    title: 'settings.json hooks',
    powers: 'every myos hook: without a hooks block nothing fires',
    ttlHours: 24 * 7,
    configured: () => true,
    probeOffline: async () => settingsHooks(),
    fixCmd: 're-run ./install.sh from the myos repo (MergeSettings folds the template hooks in)',
  },
  {
    id: 'projects-index',
    title: 'MYOS/USER/PROJECTS.md size',
    powers: 'the project index imported into every session (ceiling 6,000 bytes)',
    ttlHours: 24,
    configured: () => true,
    probeOffline: async () => projectsIndexSize(),
    fixCmd: 'move long histories into MYOS/USER/PROJECTS/<slug>.md and keep one line per project in the index',
  },
  {
    id: 'memory-dirs',
    title: 'MEMORY/ directories',
    powers: `${CORE_MEMORY_DIRS.join('/')} writable`,
    ttlHours: 24 * 7,
    configured: () => true,
    probeOffline: async () => memoryDirsWritable(),
    fixCmd: `mkdir -p ${CORE_MEMORY_DIRS.map(d => join(MYOS_DIR, 'MEMORY', d)).join(' ')}`,
  },
];

// ── manifest io ──────────────────────────────────────────────────────────────

function loadManifest(): Manifest {
  if (existsSync(MANIFEST)) {
    try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch {}
  }
  return {
    version: 1, updatedAt: new Date().toISOString(),
    note: 'Advisory cache, not truth. Written only by MYOS/TOOLS/Doctor.ts. Readers must treat entries past ttlHours as stale and re-verify doctrine-critical capabilities live.',
    capabilities: {}, ackedBroken: [],
  };
}

function salt(create = true): string {
  if (!existsSync(SALT_FILE)) {
    if (!create || !CAN_WRITE) return '';
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(SALT_FILE, randomBytes(32).toString('hex'));
    try { chmodSync(SALT_FILE, 0o600); } catch {}
  }
  return readFileSync(SALT_FILE, 'utf8').trim();
}

function computeIntegrity(m: Manifest, create = true): string {
  const { integrity: _drop, ...body } = m;
  return createHash('sha256').update(salt(create) + JSON.stringify(body)).digest('hex');
}

function saveManifest(m: Manifest): void {
  if (!CAN_WRITE) return;
  m.updatedAt = new Date().toISOString();
  m.integrity = computeIntegrity(m);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
  // Display sidecar for the statusline: precomputed here so the shell script
  // renders with a bare `cat`: no bun spawn, no hash math, per refresh tick.
  const broken = Object.entries(m.capabilities)
    .filter(([, r]) => r.state === 'broken').map(([id]) => id);
  const fresh = broken.filter(id => !(m.ackedBroken || []).includes(id));
  writeFileSync(join(STATE_DIR, 'capabilities-statusline.txt'),
    fresh.length ? `⚠ ${fresh.length} capability regression: myos doctor` : '');
}

function isStale(r: CapResult): boolean {
  return Date.now() - Date.parse(r.checkedAt) > r.ttlHours * 3_600_000;
}

// ── commands ─────────────────────────────────────────────────────────────────

async function probeAll(network: boolean): Promise<Manifest> {
  const m = loadManifest();
  for (const cap of CAPS) {
    const prev = m.capabilities[cap.id];
    if (prev?.state === 'declined') continue; // declined is silent and sticky

    if (!cap.configured()) {
      m.capabilities[cap.id] = {
        state: 'broken', checkedAt: new Date().toISOString(), ttlHours: cap.ttlHours,
        detail: 'not set up on this machine', fixCmd: cap.fixCmd, probeClass: 'offline',
      };
      continue;
    }
    let res = await cap.probeOffline();
    let probeClass: 'offline' | 'network' = 'offline';
    if (res.ok && network && cap.probeNetwork) {
      res = await cap.probeNetwork();
      probeClass = 'network';
    }
    m.capabilities[cap.id] = {
      state: res.ok ? 'live' : 'broken',
      checkedAt: new Date().toISOString(), ttlHours: cap.ttlHours,
      detail: res.detail, fixCmd: res.ok ? null : cap.fixCmd, probeClass,
    };
  }
  saveManifest(m);
  if (CAN_WRITE) writeFileSync(HEARTBEAT, JSON.stringify({ ranAt: new Date().toISOString(), network }, null, 2));
  return m;
}

function renderTable(m: Manifest): string {
  const lines: string[] = ['', 'myos doctor: capability check', ''];
  for (const cap of CAPS) {
    const r = m.capabilities[cap.id];
    if (!r) continue;
    const stale = r.state !== 'declined' && isStale(r);
    const icon = r.state === 'live' ? (stale ? '◌' : '✅')
      : r.state === 'declined' ? '⏸'
      : r.state === 'broken' ? '❌' : '◌';
    const label = r.state === 'declined' ? 'off (declined)' : stale ? `${r.state} (stale: re-run doctor)` : r.state;
    lines.push(`${icon} ${cap.title}: ${label}`);
    lines.push(`   powers: ${cap.powers}`);
    if (r.state !== 'declined') lines.push(`   ${r.detail}`);
    if (r.state === 'broken' && r.fixCmd) lines.push(`   fix: ${r.fixCmd}`);
    lines.push('');
  }
  lines.push('Re-run any time: bun <configRoot>/MYOS/TOOLS/Doctor.ts  (add --network for live auth checks)');
  lines.push('Opt out of a capability forever: bun ... Doctor.ts decline <name> : declined is silent, never nagged.');
  return lines.join('\n');
}

function statuslineGlyph(): string {
  if (!existsSync(MANIFEST)) return '';
  let m: Manifest;
  try { m = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return ''; }
  if (m.integrity && m.integrity !== computeIntegrity(m, false)) return '⚠ doctor: manifest tampered';
  const broken = Object.entries(m.capabilities)
    .filter(([, r]) => r.state === 'broken').map(([id]) => id);
  const fresh = broken.filter(id => !(m.ackedBroken || []).includes(id));
  return fresh.length ? `⚠ ${fresh.length} capability regression: myos doctor` : '';
}

// ── main ─────────────────────────────────────────────────────────────────────

// ── reconciler: declared (hooks on disk) vs registered (settings.json) ──────
// v1 scope: hooks only, two inventories. "Observed" (fire evidence from
// observability logs) is deferred: noted in the output so absence is loud.
function reconcileHooks(): { unwired: string[]; missing: string[]; note: string } {
  const hooksDir = join(CONFIG_ROOT, 'hooks');
  const settingsPath = join(CONFIG_ROOT, 'settings.json');
  const declared = existsSync(hooksDir)
    ? readdirSync(hooksDir).filter(f => f.endsWith('.hook.ts') || f.endsWith('.hook.sh'))
    : [];
  let registeredBlob = '';
  try {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'));
    registeredBlob = JSON.stringify(s.hooks || {});
  } catch {}
  // Direct registration by filename, then expand through dispatcher imports:
  // registered hooks that import sibling hook files wire them indirectly
  // (e.g. a PreToolUse dispatcher invoking per-domain guards). Without this
  // expansion the reconciler cries wolf on every dispatched hook.
  const registered = new Set(declared.filter(f => registeredBlob.includes(f)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of [...registered]) {
      let src = '';
      try { src = readFileSync(join(hooksDir, f), 'utf8'); } catch { continue; }
      for (const g of declared) {
        if (registered.has(g)) continue;
        const base = g.replace(/\.hook\.(ts|sh)$/, '');
        // Real import/require statements only: a comment mention is not wiring.
        if (new RegExp(`(?:from\\s+['"]\\./${base}\\.hook['"]|require\\(['"]\\./${base}\\.hook['"]\\)|import\\(['"]\\./${base}\\.hook['"]\\))`).test(src)) {
          registered.add(g); grew = true;
        }
      }
    }
  }
  const unwired = declared.filter(f => !registered.has(f));
  // wired-but-missing: registered commands referencing hook files not on disk
  const missing = [...registeredBlob.matchAll(/([A-Za-z0-9_-]+\.hook\.(?:ts|sh))/g)]
    .map(m => m[1]).filter((f, i, a) => a.indexOf(f) === i)
    .filter(f => !declared.includes(f));
  return { unwired, missing, note: 'v1 reconciles declared (hooks/ dir) vs registered (settings.json); observed-fire evidence deferred' };
}

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);

// --help prints usage and writes nothing (a bare run probes AND writes the manifest).
if (flag('--help') || flag('-h')) {
  console.log('Usage: bun Doctor.ts [--json] [--network|--no-network] [--statusline] [--verify] [--reconcile]');
  console.log('       bun Doctor.ts decline|enable <capability>   bun Doctor.ts ack');
  console.log(`capabilities: ${CAPS.map(c => c.id).join(', ')}`);
  process.exit(0);
}

if (flag('--statusline')) {
  console.log(statuslineGlyph());
  process.exit(0);
}

if (flag('--reconcile')) {
  const r = reconcileHooks();
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

if (flag('--verify')) {
  if (!existsSync(MANIFEST)) { console.log('no manifest yet: run Doctor first'); process.exit(0); }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const ok = !!m.integrity && existsSync(SALT_FILE) && m.integrity === computeIntegrity(m, false);
  console.log(ok ? 'integrity OK' : 'INTEGRITY FAILURE: manifest was edited outside Doctor. Re-run Doctor to regenerate.');
  process.exit(ok ? 0 : 2);
}

if (['decline', 'enable', 'ack'].includes(args[0] ?? '') && !CAN_WRITE) {
  console.error('Doctor: no config dir resolved (set CLAUDE_CONFIG_DIR or MYOS_DIR, or run the installed copy), so there is nowhere to record that.');
  process.exit(1);
}

if (args[0] === 'decline' || args[0] === 'enable') {
  const id = args[1];
  const cap = CAPS.find(c => c.id === id);
  if (!cap) { console.log(`unknown capability "${id}": known: ${CAPS.map(c => c.id).join(', ')}`); process.exit(0); }
  const m = loadManifest();
  if (args[0] === 'decline') {
    m.capabilities[id] = {
      state: 'declined', checkedAt: new Date().toISOString(), ttlHours: 24 * 365,
      detail: 'declined by user: permanently silent', fixCmd: null, probeClass: 'offline',
    };
    m.ackedBroken = (m.ackedBroken || []).filter(x => x !== id);
    console.log(`${cap.title}: off (declined). It will never warn or nag. Re-enable: bun ... Doctor.ts enable ${id}`);
  } else {
    delete m.capabilities[id];
    console.log(`${cap.title}: re-enabled: run Doctor to probe it.`);
  }
  saveManifest(m);
  process.exit(0);
}

if (args[0] === 'ack') {
  const m = loadManifest();
  m.ackedBroken = Object.entries(m.capabilities)
    .filter(([, r]) => r.state === 'broken').map(([id]) => id);
  saveManifest(m);
  console.log(`acknowledged ${m.ackedBroken.length} broken capabilit${m.ackedBroken.length === 1 ? 'y' : 'ies'}: statusline stays quiet until something NEW regresses.`);
  process.exit(0);
}

const network = flag('--network') && !flag('--no-network');
const m = await probeAll(network);
if (flag('--json')) {
  console.log(JSON.stringify(m, null, 2));
} else {
  console.log(renderTable(m));
  if (!CAN_WRITE) console.log('(no config dir resolved from CLAUDE_CONFIG_DIR, MYOS_DIR or an installed tree: nothing was written)');
}
process.exit(0);
