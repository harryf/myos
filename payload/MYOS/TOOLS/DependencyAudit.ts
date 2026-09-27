#!/usr/bin/env bun
/**
 * @version 1.1.0
 * DependencyAudit: discovery-driven dependency and capability audit.
 *
 * Answers one question: which myos capabilities work on THIS machine, and
 * what would it take to unlock the rest? It discovers every skill and tool
 * dynamically from the filesystem (no registration, no hard-coded skill
 * list), extracts each unit's external dependencies by scanning its code
 * and docs, checks presence, and reports per-unit status with copy-paste
 * install commands.
 *
 * Division of labor vs Doctor.ts:
 *   - Doctor.ts probes a CURATED list of core capabilities and keeps state
 *     (declined/ack/statusline, TTL'd manifest). It answers "is my core
 *     toolchain healthy?"
 *   - DependencyAudit.ts DISCOVERS units and their dependencies from source.
 *     It answers "which of my skills and tools can actually run?" New skills
 *     appear here with zero code changes.
 *
 * Discovery is unit-name-agnostic. The only knowledge base is BINARY_CATALOG,
 * keyed by binary name (install command, alternates group, default
 * optionality). That keeps the audit honest for skills that do not exist yet.
 *
 * Detection sources, in order of trust:
 *   1. Code (.ts/.sh): spawn/exec/$`` call sites, which() probes. These are
 *      real invocations, so a missing binary here marks the unit unavailable.
 *   2. Markdown (SKILL.md, Workflows/): fenced bash blocks, matched against
 *      the catalog only. Docs describe what an agent MAY run, so markdown
 *      findings never mark a unit unavailable, only partial.
 *   3. Env keys: credential-shaped names (API_KEY/TOKEN/SECRET/_BIN) read via
 *      process.env or envKey(). Keys the code delete-scrubs before spawning
 *      children are excluded, they are defenses, not dependencies.
 *   4. npm imports: resolvability is checked from the unit's own directory,
 *      so per-skill node_modules (Evals, Art, Remotion) are respected.
 *
 * Usage:
 *   bun DependencyAudit.ts                  # full audit, human report
 *   bun DependencyAudit.ts Interceptor      # one skill
 *   bun DependencyAudit.ts Doctor           # one MYOS/TOOLS tool (.ts optional)
 *   bun DependencyAudit.ts hooks            # the hooks layer
 *   bun DependencyAudit.ts --json           # machine-readable (for myos itself)
 *   bun DependencyAudit.ts --missing        # distinct missing deps + install commands
 *   bun DependencyAudit.ts --list           # unit names only
 *   bun DependencyAudit.ts --install        # run safe install commands (brew/bun), asks first
 *   bun DependencyAudit.ts --install --yes  # no prompts (still safe subset only)
 *   bun DependencyAudit.ts --verbose        # per-finding provenance in the report
 *   bun DependencyAudit.ts --root <dir>     # audit a different myos root
 *
 * Exit codes: 0 on any audit result (never install-fatal), 2 on usage error.
 * Offline by design: the audit itself makes no network calls.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, basename, relative } from 'path';

const HOME = process.env.HOME || '';
const CONFIG_ROOT = process.env.CLAUDE_CONFIG_DIR || join(HOME, '.myos');
const MAX_FILE_BYTES = 1_000_000;

// ── binary knowledge catalog ─────────────────────────────────────────────────
// Keyed by binary name, never by skill. `group` marks alternates: any present
// member satisfies the whole group. `optional` means the calling code degrades
// gracefully without it, so absence yields partial, not unavailable.

interface BinaryInfo {
  install: string;
  optional?: boolean;
  group?: string;
  note?: string;
}

const BINARY_CATALOG: Record<string, BinaryInfo> = {
  rtk: { install: 'brew install rtk  (no setup after; myos uses it automatically once on PATH)', optional: true, note: 'strongly recommended: 60-90% token savings on shell output; hooks no-op without it' },
  interceptor: { install: 'see skills/Interceptor/SKILL.md (needs >=0.16.0, pin 0.22.2)' },
  'interceptor-daemon': { install: 'see skills/Interceptor/SKILL.md (installed with interceptor)' },
  fabric: { install: "brew install fabric-ai, then alias fabric=fabric-ai (brew's binary is fabric-ai)", optional: true, note: 'only the -y/-u transcript fallback needs it' },
  ffmpeg: { install: 'brew install ffmpeg' },
  ffprobe: { install: 'brew install ffmpeg', note: 'ships with ffmpeg' },
  magick: { install: 'brew install imagemagick' },
  rembg: { install: 'pipx install "rembg[cli]"  (pipx itself: brew install pipx)', note: 'or set REMBG_BIN to an existing binary' },
  whisper: { install: 'pipx install openai-whisper  (pipx itself: brew install pipx)', group: 'transcription' },
  'insanely-fast-whisper': { install: 'pipx install insanely-fast-whisper  (pipx itself: brew install pipx)', group: 'transcription' },
};

// Core toolchain: checked once, globally, and reported before any unit. These
// are what myos AS A SYSTEM assumes on every machine: not what one skill
// needs: so repeating them inside each unit would be noise. Two of them (rg,
// jq) are assumed by the agent's own habits rather than by a hard spawn: the
// permission rules, docs and skills all steer sessions to rg, and ContextSearch
// once died entirely on a machine without it (fixed 0.2.3, found by CI).
// Install commands are macOS-native or Homebrew, since every PM runs macOS.
interface CoreBinaryInfo {
  install: string;
  /** What this binary is to myos: rendered when it is missing. */
  why: string;
  /** myos degrades without it rather than breaking; absence warns, never fails. */
  optional?: boolean;
}

const CORE_BINARIES: Record<string, CoreBinaryInfo> = {
  bun: {
    install: 'brew install oven-sh/bun/bun  (or curl -fsSL https://bun.sh/install | bash)',
    why: 'the runtime: every hook, tool and gate is a bun script',
  },
  claude: {
    install: 'native installer at https://code.claude.com',
    why: 'the harness itself: myos is a Claude Code configuration',
  },
  git: {
    install: 'xcode-select --install  (macOS native)',
    why: 'checkpoint commits, IntegrityCheck, and upgrades arrive via git pull',
  },
  rg: {
    install: 'brew install ripgrep',
    why: "the agent's default search (permissions, docs and skills all steer to rg); ContextSearch's ISA and conversation-log sources go dark without it",
  },
  jq: {
    install: 'brew install jq',
    why: 'the ContextReduction hook and shell-side JSON plumbing (hooks no-op without it)',
    optional: true,
  },
};

// Shell builtins, coreutils, and macOS system commands. Invoking these is not
// a dependency worth reporting.
const SHELL_NOISE = new Set([
  'bash', 'sh', 'zsh', 'echo', 'printf', 'cat', 'ls', 'cp', 'mv', 'rm', 'mkdir',
  'rmdir', 'cd', 'pwd', 'test', '[', '[[', 'tail', 'head', 'grep', 'egrep',
  'sed', 'awk', 'cut', 'tr', 'sort', 'uniq', 'wc', 'xargs', 'find', 'fd',
  'date', 'sleep', 'chmod', 'chown', 'ln', 'touch', 'which', 'command', 'type',
  'export', 'set', 'unset', 'source', 'exit', 'return', 'curl', 'wget', 'open',
  'osascript', 'security', 'launchctl', 'id', 'ps', 'kill', 'pkill', 'env',
  'tee', 'dirname', 'basename', 'mktemp', 'read', 'local', 'if', 'then',
  'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac',
  'function', 'true', 'false', 'trap', 'shift', 'eval', 'exec', 'wait',
  'defaults', 'sw_vers', 'uname', 'sysctl', 'pbcopy', 'pbpaste', 'say',
  'file', 'stat', 'du', 'df', 'diff', 'patch', 'tar', 'unzip', 'zip', 'gzip',
  // JS keywords: guard against template-literal extraction slicing into code
  'const', 'let', 'var', 'return', 'await', 'new', 'typeof', 'void', 'delete',
]);

// Node builtins importable without the node: prefix. Not npm dependencies.
const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'util', 'crypto', 'child_process', 'url', 'http',
  'https', 'net', 'dns', 'tls', 'stream', 'events', 'readline', 'zlib',
  'tty', 'assert', 'buffer', 'string_decoder', 'worker_threads', 'perf_hooks',
  'v8', 'vm', 'querystring', 'punycode', 'module', 'cluster', 'dgram',
  'process', 'console', 'timers', 'async_hooks', 'inspector', 'repl',
]);

// Env keys that are path/harness plumbing, not dependencies.
const ENV_NOISE_PREFIXES = ['CLAUDE', 'MYOS_', 'INTERCEPTOR_TEST_', 'INTERCEPTOR_WORKING_'];
const ENV_NOISE = new Set([
  'HOME', 'PATH', 'TMPDIR', 'USER', 'SHELL', 'TERM', 'PWD',
  'PROJECTS_DIR', 'VERIFGATE_OFF', 'NODE_ENV', 'CI',
]);

// A dependency-shaped env key: a credential or an explicit binary override.
const ENV_DEP_PATTERN = /(_API_KEY|_TOKEN|_SECRET|_KEY|_BIN)$/;

// ── types ────────────────────────────────────────────────────────────────────

type FindingKind = 'binary' | 'env' | 'package';
type Source = 'code' | 'markdown';
type UnitKind = 'skill' | 'tool' | 'hooks';
type UnitStatus = 'built-in' | 'ready' | 'partial' | 'unavailable';

interface Finding {
  name: string;
  kind: FindingKind;
  source: Source;
  required: boolean;       // false: absence degrades the unit, never blocks it
  present: boolean;
  probe: boolean;          // only ever probed, never invoked: informational
  satisfiedBy?: string;    // group alternate that covered a missing member
  install: string;
  note?: string;
  files: string[];         // where this dependency was seen (root-relative)
}

interface Unit {
  name: string;
  kind: UnitKind;
  path: string;
  findings: Finding[];
  apis: string[];          // api.* hosts contacted by this unit's code, info only
  status: UnitStatus;
}

// ── filesystem helpers ───────────────────────────────────────────────────────

const WALK_EXCLUDE = new Set(['node_modules', '.git', '.archive', 'dist', 'build']);

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (e) {
    skippedFiles.push({ file: dir, reason: `unreadable directory (${(e as Error).name})` });
    return [];
  }
}

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of safeReaddir(dir)) {
    if (WALK_EXCLUDE.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some(e => entry.endsWith(e))) out.push(full);
  }
  return out;
}

// Files the scanner could not inspect (oversized, compiled, unreadable).
// Surfaced in the JSON so a silent skip can never masquerade as a clean scan.
const skippedFiles: { file: string; reason: string }[] = [];

// The .env holding credentials lives at the install's config root. When the
// audited root IS an install (~/.myos), use its .env; when auditing a repo
// checkout, fall back to this machine's config root so key checks still mean
// something. Set once in main after --root is resolved.
let envFile = join(CONFIG_ROOT, '.env');

function readText(path: string, rel?: string): string | null {
  try {
    const st = statSync(path);
    if (st.size > MAX_FILE_BYTES) {
      skippedFiles.push({ file: rel || path, reason: 'larger than 1 MB' });
      return null;
    }
    const buf = readFileSync(path);
    if (buf.subarray(0, 1024).includes(0)) {
      skippedFiles.push({ file: rel || path, reason: 'compiled or binary content' });
      return null;
    }
    return buf.toString('utf-8');
  } catch (e) {
    skippedFiles.push({ file: rel || path, reason: `unreadable (${(e as Error).name})` });
    return null;
  }
}

// ── extraction ───────────────────────────────────────────────────────────────

interface RawDep {
  name: string;
  kind: FindingKind;
  source: Source;
  file: string;
  probe?: boolean; // seen only via which()/command -v: the code handles absence
  soft?: boolean;  // resolved on demand (bunx): absence degrades, never blocks
}

function firstToken(command: string): string | null {
  let s = command.trim();
  // strip leading VAR=value assignments and wrapper commands
  for (;;) {
    const m = s.match(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+|command\s+|exec\s+|nohup\s+|time\s+)/);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  const tok = s.split(/\s+/)[0] || '';
  if (!tok || tok.startsWith('$') || tok.startsWith('-') || tok.startsWith('#')
    || tok.startsWith('"') || tok.startsWith("'") || tok.startsWith('`')
    || tok.startsWith('|') || tok.startsWith('&') || tok.startsWith('(')
    || tok.startsWith('<') || tok.startsWith('>')) return null;
  // path-invoked binary: judge by basename, but skip relative script calls
  if (tok.includes('/')) {
    const base = basename(tok);
    if (base.endsWith('.ts') || base.endsWith('.sh') || base.endsWith('.js')) return null;
    return base;
  }
  if (tok.endsWith('.ts') || tok.endsWith('.sh') || tok.endsWith('.js')) return null;
  return tok;
}

function isReportableBinary(name: string | null): name is string {
  if (!name) return false;
  if (SHELL_NOISE.has(name)) return false;
  if (name in CORE_BINARIES) return false; // checked globally instead
  if (name === 'bunx') return false;        // handled as npm-runtime
  if (!/^[a-z][a-z0-9._-]*$/i.test(name)) return false;
  return true;
}

function scrubbedEnvKeys(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/delete\s+[\w.]*?(?:env|ENV)[\w]*\.([A-Z][A-Z0-9_]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/delete\s+process\.env\.([A-Z][A-Z0-9_]+)/g)) out.add(m[1]);
  return out;
}

function envKeyIsDep(key: string): boolean {
  if (ENV_NOISE.has(key)) return false;
  if (ENV_NOISE_PREFIXES.some(p => key.startsWith(p))) return false;
  return ENV_DEP_PATTERN.test(key);
}

function packageRoot(spec: string): string | null {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~')) return null;
  if (spec.startsWith('node:') || spec === 'bun' || spec.startsWith('bun:')) return null;
  const parts = spec.split('/');
  let root = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  // strip a version pin from bunx-style specs: remotion@4 -> remotion
  root = root.startsWith('@') ? root.replace(/(.)@[^@]*$/, '$1') : root.split('@')[0];
  if (NODE_BUILTINS.has(root)) return null;
  return root || null;
}

// Comments are prose, and prose about spawn("cmd") is not a dependency.
// Colons guard URLs (https://) from the line-comment pattern.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');
}

function scanCodeFile(path: string, rel: string): { deps: RawDep[]; apis: string[] } {
  const raw = readText(path, rel);
  if (raw === null) return { deps: [], apis: [] };
  const src = path.endsWith('.sh') ? raw : stripComments(raw);
  const deps: RawDep[] = [];
  const apis = new Set<string>();
  const scrubbed = scrubbedEnvKeys(src);
  const push = (name: string | null, kind: FindingKind, probe = false) => {
    if (kind === 'binary' && !isReportableBinary(name)) return;
    if (name) deps.push({ name, kind, source: 'code', file: rel, probe });
  };

  // which/command -v probes: the probed name matters, but a probe means the
  // code already handles absence, so these never drive unit status
  for (const m of src.matchAll(/(?:Bun\.)?which\(\s*["']([^"']+)["']/g)) push(m[1], 'binary', true);
  for (const m of src.matchAll(/spawn(?:Sync)?\(\s*\[\s*["'](?:which|command)["']\s*,\s*(?:["']-v["']\s*,\s*)?["']([^"']+)["']/g)) push(m[1], 'binary', true);
  for (const m of src.matchAll(/command\s+-v\s+["']?([\w.-]+)/g)) push(m[1], 'binary', true);
  if (path.endsWith('.sh')) {
    // line-based so prose like "which profile" in comments never matches
    for (const line of src.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#')) continue;
      const m = t.match(/^(?:if\s+!?\s*)?which\s+([\w.-]+)/);
      if (m) push(m[1], 'binary', true);
      // direct command lines: catalog binaries only, to keep prose out
      const tok = firstToken(t);
      if (tok && tok in BINARY_CATALOG) push(tok, 'binary');
    }
  }

  // spawn/exec call sites with a literal command
  for (const m of src.matchAll(/(?:Bun\.)?spawn(?:Sync)?\(\s*\[\s*["'`]([^"'`,\]]+)["'`]/g)) {
    const name = m[1];
    if (name !== 'which' && name !== 'command') push(firstToken(name), 'binary');
  }
  for (const m of src.matchAll(/\bexec(?:FileSync|File|Sync)\(\s*["'`]([^"'`]+)["'`]/g)) push(firstToken(m[1]), 'binary');
  // node-style spawn("cmd", [args]) with a string first argument
  for (const m of src.matchAll(/\bspawn(?:Sync)?\(\s*["']([^"'\s]+)["']\s*,/g)) push(firstToken(m[1]), 'binary');
  // Bun shell templates. Gated on an actual Bun-shell import, because the
  // two-char sequence $` also shows up when a template literal ends with a
  // regex $ anchor, and matching those slices real code into fake commands.
  const usesBunShell = /import\s*\{[^}]*\$[^}]*\}\s*from\s*["']bun["']/.test(src) || /Bun\.\$`/.test(src);
  if (usesBunShell) {
    for (const m of src.matchAll(/(?<![\\\w])\$`([^`]*)`/gs)) {
      for (const line of m[1].split('\n')) {
        const probeMatch = line.trim().match(/^(?:which|command\s+-v)\s+([\w.-]+)/);
        if (probeMatch) push(probeMatch[1], 'binary', true);
        else push(firstToken(line), 'binary');
      }
    }
  }

  // bunx <package>: fetched on demand at first use, so absence never blocks
  for (const m of src.matchAll(/\bbunx\s+(?:--?\S+\s+)*([a-zA-Z0-9@][\w@/.-]*)/g)) {
    const pkg = packageRoot(m[1]);
    if (pkg) deps.push({ name: pkg, kind: 'package', source: 'code', file: rel, soft: true });
  }

  // env keys
  const envKeys = new Set<string>();
  for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) envKeys.add(m[1]);
  for (const m of src.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g)) envKeys.add(m[1]);
  for (const m of src.matchAll(/envKey\(\s*["']([A-Z][A-Z0-9_]+)["']/g)) envKeys.add(m[1]);
  for (const key of envKeys) {
    if (scrubbed.has(key)) continue;   // scrubbing a key is a defense, not a need
    if (envKeyIsDep(key)) deps.push({ name: key, kind: 'env', source: 'code', file: rel });
  }

  // npm imports (checked for resolvability later, .ts only)
  if (path.endsWith('.ts') || path.endsWith('.js')) {
    const specs = new Set<string>();
    for (const m of src.matchAll(/^\s*import\s+(?:[\s\S]*?from\s+)?["']([^"']+)["']/gm)) specs.add(m[1]);
    for (const m of src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);
    for (const spec of specs) {
      const pkg = packageRoot(spec);
      if (pkg) deps.push({ name: pkg, kind: 'package', source: 'code', file: rel });
    }
  }

  for (const m of src.matchAll(/https:\/\/(api\.[a-z0-9.-]+)/gi)) apis.add(m[1].toLowerCase());
  return { deps, apis: [...apis] };
}

// Markdown: fenced bash blocks only, matched against the catalog only. Docs
// show what an agent MAY run, and examples are often illustrative, so this
// path is deliberately conservative.
function scanMarkdownFile(path: string, rel: string): RawDep[] {
  const src = readText(path, rel);
  if (src === null) return [];
  const deps: RawDep[] = [];
  for (const m of src.matchAll(/```(?:bash|sh|zsh|shell)\n([\s\S]*?)```/g)) {
    for (const line of m[1].split('\n')) {
      const tok = firstToken(line);
      if (tok && tok in BINARY_CATALOG) deps.push({ name: tok, kind: 'binary', source: 'markdown', file: rel });
    }
  }
  return deps;
}

// ── presence checks ──────────────────────────────────────────────────────────

// Hook-spawned and GUI-launched processes on Apple Silicon often get a PATH
// without /opt/homebrew/bin, which would fake a machine-wide outage. Check
// the standard install locations explicitly.
const BIN_FALLBACK_DIRS = [
  '/opt/homebrew/bin', '/usr/local/bin',
  join(HOME, '.local/bin'), join(HOME, '.bun/bin'),
];

const binaryCache = new Map<string, boolean>();
function binaryPresent(name: string): boolean {
  if (binaryCache.has(name)) return binaryCache.get(name)!;
  const found = Bun.which(name) !== null
    || BIN_FALLBACK_DIRS.some(d => existsSync(join(d, name)));
  binaryCache.set(name, found);
  return found;
}

let envFileCache: string | null | undefined;
function envPresent(key: string): boolean {
  if (process.env[key]) return true;
  if (envFileCache === undefined) {
    try {
      envFileCache = existsSync(envFile) ? readFileSync(envFile, 'utf-8') : null;
    } catch {
      envFileCache = null; // unreadable .env reads as "no keys set", never a crash
    }
  }
  if (!envFileCache) return false;
  return new RegExp(`^${key}=.+`, 'm').test(envFileCache);
}

// Nearest ancestor (up to and including stopAt) holding a package.json, so
// install advice never points at a directory bun cannot install from.
function packageJsonDir(startDir: string, stopAt: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dir === stopAt) return stopAt;
    const parent = resolve(dir, '..');
    if (parent === dir) return stopAt;
    dir = parent;
  }
}

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function packagePresent(pkg: string, fromDir: string): boolean {
  try { return Boolean(Bun.resolveSync(pkg, fromDir)); } catch { return false; }
}

// ── unit assembly ────────────────────────────────────────────────────────────

function groupMembers(group: string): string[] {
  return Object.entries(BINARY_CATALOG).filter(([, i]) => i.group === group).map(([n]) => n);
}

function buildFindings(raw: RawDep[], resolveFrom: string): Finding[] {
  const merged = new Map<string, Finding>();
  for (const d of raw) {
    const info = d.kind === 'binary' ? BINARY_CATALOG[d.name] : undefined;
    // alternates collapse into one finding per group: any member satisfies it
    const displayName = info?.group || d.name;
    const key = `${d.kind}:${displayName}`;
    const prior = merged.get(key);
    if (prior) {
      if (!prior.files.includes(d.file)) prior.files.push(d.file);
      if (d.source === 'code') prior.source = 'code';
      if (!d.probe && d.source === 'code') prior.probe = false; // docs cannot upgrade a probe
      // a real invocation or import outranks a probe, a doc mention, and a
      // soft bunx sighting of the same dependency
      if (d.source === 'code' && !d.probe && !d.soft
        && !(d.kind === 'binary' && BINARY_CATALOG[d.name]?.optional)) {
        prior.required = true;
        if (prior.kind === 'package') prior.note = undefined; // drop the bunx on-demand note
      }
      continue;
    }
    let present = false;
    let required = d.source === 'code' && !d.probe;
    let install = '';
    let note: string | undefined;
    let satisfiedBy: string | undefined;

    if (d.kind === 'binary') {
      if (info?.group) {
        const members = groupMembers(info.group);
        satisfiedBy = members.find(binaryPresent);
        present = Boolean(satisfiedBy);
        install = members.map(m => BINARY_CATALOG[m].install).join('  or  ');
        note = `any one of: ${members.join(', ')}`;
      } else {
        present = binaryPresent(d.name);
        install = info?.install || `install ${d.name} (not in the catalog, check the unit docs)`;
        note = info?.note;
      }
      if (info?.optional) required = false;
    } else if (d.kind === 'env') {
      present = envPresent(d.name);
      required = false; // a missing key limits the unit, it does not brick it
      install = `add ${d.name}=... to ${envFile}`;
      if (d.name.endsWith('_BIN')) {
        // path override, not a dependency: the binary itself is the dependency
        d.probe = true;
        note = 'optional path override, only set it when the binary lives somewhere unusual';
      }
    } else {
      present = packagePresent(d.name, resolveFrom);
      install = `cd ${shellQuote(resolveFrom)} && bun install`;
      if (d.soft) {
        required = false;
        note = 'fetched on first use by bunx. Install ahead of time to skip the wait';
      }
    }
    merged.set(key, {
      name: displayName, kind: d.kind, source: d.source, required, present,
      probe: Boolean(d.probe), satisfiedBy, install, note, files: [d.file],
    });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Probe-only findings never drive status: code that checks before calling
// already degrades on its own. They stay visible in JSON and --verbose.
function unitStatus(findings: Finding[]): UnitStatus {
  const real = findings.filter(f => !f.probe);
  if (real.length === 0) return findings.length === 0 ? 'built-in' : 'ready';
  if (real.every(f => f.present)) return 'ready';
  if (real.some(f => !f.present && f.required)) return 'unavailable';
  return 'partial';
}

function auditSkill(root: string, name: string): Unit {
  const dir = join(root, 'skills', name);
  const raw: RawDep[] = [];
  const apis = new Set<string>();
  const codeFiles = walk(dir, ['.ts', '.js', '.sh']);
  for (const f of codeFiles) {
    const res = scanCodeFile(f, relative(root, f));
    raw.push(...res.deps);
    res.apis.forEach(a => apis.add(a));
  }
  const mdFiles = [join(dir, 'SKILL.md'), ...walk(join(dir, 'Workflows'), ['.md'])];
  for (const f of mdFiles) {
    if (existsSync(f)) raw.push(...scanMarkdownFile(f, relative(root, f)));
  }
  // per-skill node_modules live next to the package.json, wherever it is;
  // skills without their own fall back to the shared runtime at the root
  let resolveFrom = packageJsonDir(dir, root);
  if (existsSync(join(dir, 'Tools', 'package.json'))) resolveFrom = join(dir, 'Tools');
  const findings = buildFindings(raw, resolveFrom);
  return { name, kind: 'skill', path: dir, findings, apis: [...apis].sort(), status: unitStatus(findings) };
}

function auditTool(root: string, file: string): Unit {
  const path = join(root, 'MYOS/TOOLS', file);
  const res = scanCodeFile(path, relative(root, path));
  const findings = buildFindings(res.deps, packageJsonDir(join(root, 'MYOS/TOOLS'), root));
  return { name: file.replace(/\.ts$/, ''), kind: 'tool', path, findings, apis: res.apis, status: unitStatus(findings) };
}

function auditHooks(root: string): Unit {
  const dir = join(root, 'hooks');
  const raw: RawDep[] = [];
  const apis = new Set<string>();
  for (const f of walk(dir, ['.ts', '.sh'])) {
    const res = scanCodeFile(f, relative(root, f));
    raw.push(...res.deps);
    res.apis.forEach(a => apis.add(a));
  }
  const findings = buildFindings(raw, packageJsonDir(dir, root));
  return { name: 'hooks', kind: 'hooks', path: dir, findings, apis: [...apis].sort(), status: unitStatus(findings) };
}

function discoverUnits(root: string): { skills: string[]; tools: string[] } {
  const skillsDir = join(root, 'skills');
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter(d => existsSync(join(skillsDir, d, 'SKILL.md'))).sort()
    : [];
  const toolsDir = join(root, 'MYOS/TOOLS');
  const tools = existsSync(toolsDir)
    ? readdirSync(toolsDir).filter(f => f.endsWith('.ts')).sort()
    : [];
  return { skills, tools };
}

// ── report rendering ─────────────────────────────────────────────────────────
// Style contract: plain prose, no em dashes, no filler words. Specifics only.

const GLYPH: Record<UnitStatus, string> = { 'built-in': 'ok', ready: 'ok', partial: '..', unavailable: 'XX' };

function missingLabel(f: Finding): string {
  if (f.kind === 'env') return `${f.name} not set`;
  if (f.kind === 'package') return `${f.name} not installed`;
  return `${f.name} missing`;
}

interface MissingDep {
  name: string;
  kind: FindingKind;
  install: string;
  manager: 'brew' | 'bun' | 'env' | 'manual';
  safe: boolean;      // true: --install may run this command itself
  note?: string;
  blocks: string[];   // units that cannot run without it
  limits: string[];   // units that lose features without it
}

function installManager(m: { kind: FindingKind; install: string }): MissingDep['manager'] {
  if (m.kind === 'env') return 'env';
  if (m.install.includes('  or  ')) return 'manual'; // alternates need a human choice
  if (m.install.startsWith('brew install ')) return 'brew';
  if (/^(cd .+ && )?bun install/.test(m.install)) return 'bun';
  return 'manual';
}

function collectMissing(units: Unit[]): MissingDep[] {
  const map = new Map<string, MissingDep>();
  for (const u of units) {
    for (const f of u.findings) {
      if (f.present || f.probe) continue;
      const key = `${f.kind}:${f.name}`;
      // package installs are per-directory, keep them distinct
      const mapKey = f.kind === 'package' ? `${key}:${f.install}` : key;
      const entry = map.get(mapKey) || {
        name: f.name, kind: f.kind, install: f.install,
        manager: installManager(f), safe: false, note: f.note, blocks: [], limits: [],
      };
      entry.safe = entry.manager === 'brew' ? binaryPresent('brew') : entry.manager === 'bun';
      (f.required ? entry.blocks : entry.limits).push(u.name);
      map.set(mapKey, entry);
    }
  }
  return [...map.values()].sort((a, b) => (b.blocks.length - a.blocks.length) || a.name.localeCompare(b.name));
}

/** Absent core binaries, as MissingDep rows so --missing and --install treat
 * the core exactly like any other gap: first in the list, named for what
 * they really block. */
function coreMissing(): MissingDep[] {
  return Object.entries(CORE_BINARIES)
    .filter(([name]) => !binaryPresent(name))
    .map(([name, info]) => ({
      name,
      kind: 'binary' as FindingKind,
      install: info.install,
      manager: info.install.startsWith('brew ') ? 'brew' as const : 'manual' as const,
      safe: info.install.startsWith('brew ') && binaryPresent('brew'),
      note: info.why,
      blocks: info.optional ? [] : ['core toolchain'],
      limits: info.optional ? ['core toolchain'] : [],
    }));
}

function renderCore(): string[] {
  const lines = ['Core toolchain (what myos assumes on every machine: not skill-specific)'];
  const present = Object.keys(CORE_BINARIES).filter(binaryPresent);
  const absent = Object.keys(CORE_BINARIES).filter(b => !binaryPresent(b));
  if (present.length) lines.push(`  ok  ${present.join(', ')}`);
  for (const b of absent) {
    const info = CORE_BINARIES[b];
    const glyph = info.optional ? '~~' : 'XX';
    lines.push(`  ${glyph}  ${b} missing${info.optional ? ' (degrades, not fatal)' : ''}: ${info.why}`);
    lines.push(`        install: ${info.install}`);
  }
  return lines;
}

function summaryLine(units: Unit[]): string {
  const skills = units.filter(u => u.kind === 'skill');
  const tools = units.filter(u => u.kind === 'tool');
  const count = (list: Unit[], s: UnitStatus[]) => list.filter(u => s.includes(u.status)).length;
  const parts: string[] = [];
  // Core state leads: a broken core makes the per-unit numbers below moot.
  const coreAbsent = Object.entries(CORE_BINARIES).filter(([name]) => !binaryPresent(name));
  const coreRequired = coreAbsent.filter(([, info]) => !info.optional);
  if (coreRequired.length) {
    parts.push(`CORE TOOLCHAIN INCOMPLETE: ${coreRequired.map(([n]) => n).join(', ')} missing (see Core toolchain below)`);
  } else if (coreAbsent.length) {
    parts.push(`core ok except optional ${coreAbsent.map(([n]) => n).join(', ')}`);
  }
  if (skills.length) {
    parts.push(`${count(skills, ['built-in', 'ready'])} of ${skills.length} skills work now, ${count(skills, ['partial'])} partial, ${count(skills, ['unavailable'])} blocked`);
  }
  if (tools.length) {
    parts.push(`${count(tools, ['built-in', 'ready'])} of ${tools.length} tools work now`);
  }
  const hooks = units.find(u => u.kind === 'hooks');
  if (hooks) parts.push(`hooks ${hooks.status === 'built-in' || hooks.status === 'ready' ? 'ok' : hooks.status}`);
  return `Summary: ${parts.join('. ')}.`;
}

function renderUnit(u: Unit, verbose: boolean): string[] {
  const lines: string[] = [];
  const pad = (s: string) => s.padEnd(2);
  if (u.status === 'built-in') {
    lines.push(`  ${pad(GLYPH[u.status])}  ${u.name} (built in, no external dependencies)`);
    return lines;
  }
  const label = u.status === 'ready' ? 'ready' : u.status;
  const missing = u.findings.filter(f => !f.present && !f.probe);
  const presentNames = u.findings.filter(f => f.present && !f.probe).map(f => f.satisfiedBy && f.satisfiedBy !== f.name ? `${f.name} via ${f.satisfiedBy}` : f.name);
  let head = `  ${pad(GLYPH[u.status])}  ${u.name}: ${label}`;
  if (u.status === 'ready' && presentNames.length) head += ` (${presentNames.join(', ')})`;
  lines.push(head);
  for (const f of missing) {
    lines.push(`        ${missingLabel(f)}. install: ${f.install}${f.note ? ` (${f.note})` : ''}`);
  }
  if (verbose) {
    for (const f of u.findings) {
      lines.push(`        [${f.kind}] ${f.name}: ${f.present ? 'present' : 'absent'}, ${f.required ? 'required' : 'nice to have'}, seen in ${f.files.join(', ')}`);
    }
    if (u.apis.length) lines.push(`        talks to: ${u.apis.join(', ')}`);
  }
  return lines;
}

function renderReport(units: Unit[], root: string, verbose: boolean): string {
  const lines: string[] = ['myos dependency audit', `Root: ${root}`, ''];
  lines.push(summaryLine(units), '');
  lines.push(...renderCore(), '');
  const skills = units.filter(u => u.kind === 'skill');
  const tools = units.filter(u => u.kind === 'tool');
  const hooks = units.filter(u => u.kind === 'hooks');
  const order: UnitStatus[] = ['unavailable', 'partial', 'ready', 'built-in'];
  const sortByStatus = (a: Unit, b: Unit) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name);
  if (skills.length) {
    lines.push('Skills');
    for (const u of [...skills].sort(sortByStatus)) lines.push(...renderUnit(u, verbose));
    lines.push('');
  }
  if (tools.length) {
    lines.push('Tools (MYOS/TOOLS)');
    for (const u of [...tools].sort(sortByStatus)) lines.push(...renderUnit(u, verbose));
    lines.push('');
  }
  for (const u of hooks) {
    lines.push('Hooks');
    lines.push(...renderUnit(u, verbose));
    lines.push('');
  }
  const missing = [...coreMissing(), ...collectMissing(units)];
  if (missing.length) {
    lines.push('What is missing, and what each install unlocks');
    lines.push(...renderMissing(missing));
  } else {
    lines.push('Nothing is missing. Every discovered capability can run on this machine.');
  }
  return lines.join('\n');
}

function renderMissing(missing: MissingDep[]): string[] {
  const lines: string[] = [];
  if (missing.some(m => m.manager === 'brew') && !binaryPresent('brew')) {
    lines.push('  Note: some commands below use Homebrew, which is not installed. Get it first: https://brew.sh');
  }
  if (process.platform !== 'darwin') {
    lines.push('  Note: install commands assume macOS. Substitute your package manager.');
  }
  for (const m of missing) {
    const effect: string[] = [];
    if (m.blocks.length) effect.push(`unblocks ${m.blocks.join(', ')}`);
    if (m.limits.length) effect.push(`improves ${m.limits.join(', ')}`);
    lines.push(`  ${m.name}: ${m.install}`);
    lines.push(`      ${effect.join('; ')}${m.note ? ` (${m.note})` : ''}`);
  }
  return lines;
}

// ── install assist ───────────────────────────────────────────────────────────
// Safe subset only: brew and bun commands. Everything else prints for the
// human (or the calling AI) to decide on. Never runs without confirmation
// unless --yes is passed.

async function runInstalls(missing: MissingDep[], yes: boolean): Promise<void> {
  const todo = missing.filter(m => m.safe);
  const manual = missing.filter(m => !m.safe);
  if (!todo.length) {
    console.log('Nothing here is auto-installable. Commands to run by hand:');
    for (const m of manual) console.log(`  ${m.name}: ${m.install}`);
    return;
  }
  if (!yes && !process.stdin.isTTY) {
    console.log('No terminal to confirm in. Re-run with --yes, or run these yourself:');
    for (const m of todo) console.log(`  ${m.install}`);
    return;
  }
  for (const m of todo) {
    const label = `${m.name} (${m.install})`;
    if (!yes) {
      const answer = prompt(`Install ${label}? [y/N] `);
      if (!answer || !/^y/i.test(answer)) { console.log(`  skipped ${m.name}`); continue; }
    }
    console.log(`  running: ${m.install}`);
    const proc = Bun.spawnSync(['sh', '-c', m.install], { stdout: 'inherit', stderr: 'inherit' });
    console.log(proc.exitCode === 0 ? `  installed ${m.name}` : `  FAILED ${m.name} (exit ${proc.exitCode}), run it by hand`);
  }
  if (manual.length) {
    console.log('Needs a manual step:');
    for (const m of manual) console.log(`  ${m.name}: ${m.install}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const KNOWN_FLAGS = new Set(['--json', '--missing', '--install', '--yes', '--list', '--verbose', '--root']);
const flags = new Set(argv.filter(a => a.startsWith('--')));
for (const f of flags) {
  if (!KNOWN_FLAGS.has(f)) {
    const hint = f.startsWith('--root=') ? ' (--root takes its value as a separate argument: --root <dir>)' : '';
    console.error(`Unknown flag ${f}. Known: ${[...KNOWN_FLAGS].join(', ')}${hint}`);
    process.exit(2);
  }
}
const rootFlagIdx = argv.indexOf('--root');
if (rootFlagIdx >= 0 && (!argv[rootFlagIdx + 1] || argv[rootFlagIdx + 1].startsWith('--'))) {
  console.error('--root needs a directory: --root <dir>');
  process.exit(2);
}
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--root');
const root = rootFlagIdx >= 0 ? resolve(argv[rootFlagIdx + 1]) : resolve(import.meta.dir, '../..');

if (!existsSync(join(root, 'skills')) && !existsSync(join(root, 'MYOS/TOOLS'))) {
  console.error(`No myos payload found at ${root} (no skills/ or MYOS/TOOLS/). Use --root <dir>.`);
  process.exit(2);
}

// key checks read the audited install's .env when it has one
if (existsSync(join(root, '.env'))) envFile = join(root, '.env');

const { skills, tools } = discoverUnits(root);

if (flags.has('--list')) {
  const hookUnit = existsSync(join(root, 'hooks')) ? ['hooks'] : [];
  console.log([...hookUnit, ...skills, ...tools.map(t => t.replace(/\.ts$/, ''))].join('\n'));
  process.exit(0);
}

let units: Unit[];
if (positional.length) {
  const want = positional[0].toLowerCase();
  const skillMatch = skills.find(s => s.toLowerCase() === want);
  const toolMatch = tools.find(t => t.toLowerCase() === want || t.toLowerCase() === `${want}.ts`);
  if (skillMatch) units = [auditSkill(root, skillMatch)];
  else if (toolMatch) units = [auditTool(root, toolMatch)];
  else if (want === 'hooks' && existsSync(join(root, 'hooks'))) units = [auditHooks(root)];
  else {
    console.error(`Unknown unit "${positional[0]}". Available: hooks, ${skills.join(', ')}, ${tools.map(t => t.replace(/\.ts$/, '')).join(', ')}`);
    process.exit(2);
  }
} else {
  units = [
    ...skills.map(s => auditSkill(root, s)),
    ...tools.map(t => auditTool(root, t)),
    ...(existsSync(join(root, 'hooks')) ? [auditHooks(root)] : []),
  ];
}

const missing = [...coreMissing(), ...collectMissing(units)];

if (flags.has('--json')) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    root,
    platform: process.platform,
    generatedAt: new Date().toISOString(),
    // status enum: built-in (no deps), ready (every invoked dep present),
    // partial (all required present, something limiting is absent),
    // unavailable (a required invoked dep is absent)
    core: Object.entries(CORE_BINARIES).map(([b, info]) => ({
      name: b,
      present: binaryPresent(b),
      install: info.install,
      why: info.why,
      optional: info.optional ?? false,
    })),
    units: units.map(u => ({ name: u.name, kind: u.kind, status: u.status, findings: u.findings, apis: u.apis })),
    missing,
    skipped: skippedFiles,
  }, null, 2));
} else if (flags.has('--missing')) {
  console.log(summaryLine(units));
  if (!missing.length) console.log('Nothing is missing.');
  else {
    console.log('Missing dependencies:');
    console.log(renderMissing(missing).join('\n'));
  }
} else if (flags.has('--install')) {
  if (!missing.length) console.log('Nothing is missing, nothing to install.');
  else await runInstalls(missing, flags.has('--yes'));
} else {
  console.log(renderReport(units, root, flags.has('--verbose')));
}
process.exit(0);
