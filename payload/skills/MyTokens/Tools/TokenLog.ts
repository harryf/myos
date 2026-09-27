#!/usr/bin/env bun
/**
 * TokenLog.ts: durable token-consumption log for myos sessions.
 *
 * Claude Code writes per-message usage (fresh input, cache write, cache read,
 * output tokens, model, attributed skill) into the session transcripts under
 * ~/.myos/projects/, plus per-session subagent transcripts under
 * <project>/<session-id>/subagents/, then prunes it all after ~30 days. This
 * tool folds everything into a durable store while it exists, attributing
 * consumption to the user prompt (the "activity") that triggered it:
 *
 *   sync                         scan changed transcripts into the store (idempotent)
 *   report [--days N] [--json]   totals by day, model and activity (default 14)
 *   session <id> [--json]        one session in full: turns, models, skills, tools
 *   dashboard [--days N]         write a self-contained HTML dashboard, print its path
 *
 * Session ids accept any unique prefix; a full id resumes the session with
 * `myos --resume <id>` from the project directory it belongs to.
 *
 * The store lives in MEMORY/OBSERVABILITY/TOKENS/ (sessions.json + cursor.json)
 * and survives transcript pruning and myos upgrades. Everything stays local.
 *
 * The report also folds in `rtk gain` (token savings from the rtk
 * output-filtering proxy) when rtk is on PATH.
 *
 * Paths: the config root is $CLAUDE_CONFIG_DIR (default ~/.myos), the myos tree
 * is $MYOS_DIR (default <root>/MYOS). Env overrides (tests, and the one-off
 * import of older transcripts from another config dir):
 *   MYOS_TOKENLOG_PROJECTS   transcript root (default <root>/projects)
 *   MYOS_TOKENLOG_STORE      store dir (default <tree>/MEMORY/OBSERVABILITY/TOKENS)
 *   MYOS_TOKENLOG_NAMES      session names (default <tree>/MEMORY/STATE/session-names.json)
 *   MYOS_TOKENLOG_NO_RTK     =1 skips the rtk section (tests; rtk output is not ours to fix)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const HOME = process.env.HOME || homedir();
const STORE_VERSION = 2;

function configRoot(): string {
  return process.env.CLAUDE_CONFIG_DIR || resolve(HOME, ".myos");
}
function myosTree(): string {
  return process.env.MYOS_DIR || join(configRoot(), "MYOS");
}
export function projectsDir(): string {
  return process.env.MYOS_TOKENLOG_PROJECTS || join(configRoot(), "projects");
}
export function storeDir(): string {
  return process.env.MYOS_TOKENLOG_STORE || join(myosTree(), "MEMORY", "OBSERVABILITY", "TOKENS");
}
function sessionNamesPath(): string {
  return process.env.MYOS_TOKENLOG_NAMES || join(myosTree(), "MEMORY", "STATE", "session-names.json");
}

/** myos's PromptProcessing hook names sessions; overlay those names at read time. */
export function sessionTitles(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(sessionNamesPath(), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function titleFor(s: SessionLog, names: Record<string, string>): string {
  if (names[s.id]) return names[s.id];
  const firstPrompt = s.turns.find((t) => t.prompt !== "(session start)")?.prompt;
  return firstPrompt ? firstPrompt.slice(0, 48) : "(unnamed session)";
}

// ─────────── Types ───────────

export interface Bucket {
  in: number; // fresh (uncached) input tokens
  cacheW: number; // cache_creation_input_tokens
  cacheR: number; // cache_read_input_tokens
  out: number; // output tokens
  msgs: number;
}

export interface Turn {
  ts: string; // ISO timestamp of the user prompt
  prompt: string; // snippet of what the user asked (or "(session start)")
  models: Record<string, Bucket>;
  skills: string[]; // myos skills attributed to messages in this turn
  subMsgs: number; // subagent messages attributed to this turn
  subOut: number; // output tokens of those subagent messages
}

export interface SessionLog {
  id: string;
  project: string;
  firstTs: string;
  lastTs: string;
  turns: Turn[];
  tools: Record<string, number>; // tool_use histogram across the session
}

interface Store {
  version: number;
  sessions: Record<string, SessionLog>;
}
interface Cursor {
  version?: number;
  files: Record<string, { mtimeMs: number; size: number }>;
}

const zero = (): Bucket => ({ in: 0, cacheW: 0, cacheR: 0, out: 0, msgs: 0 });
const addUsage = (b: Bucket, u: any) => {
  b.in += u.input_tokens ?? 0;
  b.cacheW += u.cache_creation_input_tokens ?? 0;
  b.cacheR += u.cache_read_input_tokens ?? 0;
  b.out += u.output_tokens ?? 0;
  b.msgs += 1;
};

// ─────────── Transcript parsing ───────────

/** Extract the plain text of a user message, or null when it is not a real prompt. */
function promptText(entry: any): string | null {
  if (entry.type !== "user" || entry.isSidechain || entry.isMeta) return null;
  if (entry.toolUseResult !== undefined) return null; // tool results also arrive as type:"user"
  const content = entry.message?.content;
  let text: string | null = null;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    if (content.some((c: any) => c?.type === "tool_result")) return null;
    const t = content.find((c: any) => c?.type === "text");
    if (t?.text) text = t.text;
  }
  if (!text) return null;
  if (text.includes("<local-command-stdout>")) return null; // echo of a `!` command, no work follows
  const cmd = text.match(/<command-name>([^<]+)<\/command-name>/);
  if (cmd) return `/${cmd[1].replace(/^\//, "")}`;
  return text.replace(/\s+/g, " ").trim().slice(0, 120) || null;
}

interface ParsedMsg {
  ts: string;
  model: string;
  usage: any;
  side: boolean;
  skill?: string;
}

/** Parse one JSONL file: usage messages (deduped by message id, last wins) + tool histogram. */
function parseFile(
  path: string,
  onPrompt?: (prompt: string, ts: string) => void,
): { msgs: Map<string, ParsedMsg & { turn: number }>; tools: Record<string, number>; sessionId: string; firstTs: string; lastTs: string; turnCount: () => number } {
  const lines = readFileSync(path, "utf8").split("\n");
  const msgs = new Map<string, ParsedMsg & { turn: number }>();
  const tools: Record<string, number> = {};
  let sessionId = "";
  let firstTs = "";
  let lastTs = "";
  let turns = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // torn write at file end
    }
    if (e.sessionId && !sessionId) sessionId = e.sessionId;
    if (e.timestamp) {
      if (!firstTs) firstTs = e.timestamp;
      lastTs = e.timestamp;
    }
    if (onPrompt) {
      const prompt = promptText(e);
      if (prompt) {
        onPrompt(prompt, e.timestamp ?? lastTs);
        turns++;
        continue;
      }
    }
    if (e.type === "assistant" && e.message?.usage) {
      const id = e.message.id || e.uuid || `${msgs.size}`;
      msgs.set(id, {
        turn: turns - 1,
        ts: e.timestamp ?? lastTs,
        model: e.message.model || "unknown",
        usage: e.message.usage,
        side: !!e.isSidechain,
        skill: typeof e.attributionSkill === "string" ? e.attributionSkill : undefined,
      });
      const content = e.message.content;
      if (Array.isArray(content)) {
        for (const c of content) if (c?.type === "tool_use" && c.name) tools[c.name] = (tools[c.name] ?? 0) + 1;
      }
    }
  }
  return { msgs, tools, sessionId, firstTs, lastTs, turnCount: () => turns };
}

/** A session log is a pure function of its transcript file + subagent files. */
export function parseTranscript(path: string, project: string, agentFiles: string[] = []): SessionLog | null {
  const turns: Turn[] = [];
  const main = parseFile(path, (prompt, ts) => {
    turns.push({ ts, prompt, models: {}, skills: [], subMsgs: 0, subOut: 0 });
  });
  if (!main.sessionId && main.msgs.size === 0) return null;

  // Work that precedes any prompt (resumed sessions, hooks) gets a pseudo-turn.
  const pre: Turn = { ts: main.firstTs, prompt: "(session start)", models: {}, skills: [], subMsgs: 0, subOut: 0 };
  let preUsed = false;
  const applyTo = (turn: Turn, m: ParsedMsg, sub: boolean) => {
    addUsage((turn.models[m.model] ??= zero()), m.usage);
    if (m.skill && !turn.skills.includes(m.skill)) turn.skills.push(m.skill);
    if (sub) {
      turn.subMsgs += 1;
      turn.subOut += m.usage.output_tokens ?? 0;
    }
  };
  for (const m of main.msgs.values()) {
    const turn = m.turn >= 0 ? turns[m.turn] : ((preUsed = true), pre);
    applyTo(turn, m, m.side);
  }

  // Subagent transcripts (<session-id>/subagents/agent-*.jsonl): attribute each
  // message to the parent turn active at its timestamp.
  const tools = { ...main.tools };
  for (const af of agentFiles) {
    let parsed;
    try {
      parsed = parseFile(af);
    } catch {
      continue;
    }
    for (const [name, n] of Object.entries(parsed.tools)) tools[name] = (tools[name] ?? 0) + n;
    for (const m of parsed.msgs.values()) {
      let turn: Turn | undefined;
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].ts <= m.ts) {
          turn = turns[i];
          break;
        }
      }
      if (!turn) {
        preUsed = true;
        turn = pre;
      }
      applyTo(turn, m, true);
    }
  }
  if (preUsed) turns.unshift(pre);

  const kept = turns.filter((t) => Object.keys(t.models).length > 0);
  if (!main.sessionId || kept.length === 0) return null;
  return { id: main.sessionId, project, firstTs: main.firstTs, lastTs: main.lastTs, turns: kept, tools };
}

// ─────────── Store ───────────

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadStore(): Store {
  return readJson<Store>(join(storeDir(), "sessions.json"), { version: STORE_VERSION, sessions: {} });
}

export function sync(opts: { quiet?: boolean } = {}): { scanned: number; skipped: number; sessions: number } {
  const root = projectsDir();
  const dir = storeDir();
  mkdirSync(dir, { recursive: true });
  let store = loadStore();
  let cursor = readJson<Cursor>(join(dir, "cursor.json"), { version: STORE_VERSION, files: {} });
  // A store written by an older parser misses fields; rebuild it from what is
  // still on disk rather than serving mixed shapes.
  if (store.version !== STORE_VERSION || cursor.version !== STORE_VERSION) {
    store = { version: STORE_VERSION, sessions: {} };
    cursor = { version: STORE_VERSION, files: {} };
  }
  let scanned = 0;
  let skipped = 0;

  if (existsSync(root)) {
    for (const project of readdirSync(root)) {
      if (project.includes("myos-release-probe")) continue; // installer self-tests, noise
      const pdir = join(root, project);
      let entries: string[];
      try {
        entries = readdirSync(pdir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of entries) {
        const mainPath = join(pdir, f);
        const sid = basename(f, ".jsonl");
        const agentDir = join(pdir, sid, "subagents");
        let agentFiles: string[] = [];
        if (existsSync(agentDir)) {
          try {
            agentFiles = readdirSync(agentDir)
              .filter((a) => a.endsWith(".jsonl"))
              .map((a) => join(agentDir, a));
          } catch {
            /* unreadable agent dir: parse the main file alone */
          }
        }
        const group = [mainPath, ...agentFiles];
        const stats = group.map((p) => {
          try {
            const st = statSync(p);
            return { p, mtimeMs: st.mtimeMs, size: st.size };
          } catch {
            return { p, mtimeMs: 0, size: 0 };
          }
        });
        const dirty = stats.some((s) => {
          const seen = cursor.files[s.p];
          return !seen || seen.mtimeMs !== s.mtimeMs || seen.size !== s.size;
        });
        if (!dirty) {
          skipped++;
          continue;
        }
        const log = parseTranscript(mainPath, project, agentFiles);
        for (const s of stats) cursor.files[s.p] = { mtimeMs: s.mtimeMs, size: s.size };
        scanned++;
        if (log) store.sessions[log.id] = log; // re-parse replaces: idempotent
      }
    }
  }

  writeFileSync(join(dir, "sessions.json"), JSON.stringify(store));
  writeFileSync(join(dir, "cursor.json"), JSON.stringify(cursor));
  const result = { scanned, skipped, sessions: Object.keys(store.sessions).length };
  if (!opts.quiet) console.log(`TokenLog sync: ${scanned} session(s) parsed, ${skipped} unchanged, ${result.sessions} in store`);
  return result;
}

// ─────────── Reporting ───────────

export interface Report {
  days: number;
  since: string;
  totals: Bucket;
  byDay: Record<string, Bucket>;
  byModel: Record<string, Bucket>;
  bySkill: Record<string, number>; // output tokens per attributed skill
  activities: Array<{
    day: string;
    session: string;
    sessionFull: string;
    title: string;
    project: string;
    prompt: string;
    models: string[];
    skills: string[];
    out: number;
    cacheR: number;
    subMsgs: number;
    subOut: number;
  }>;
  topSessions: Array<{
    session: string;
    sessionFull: string;
    title: string;
    project: string;
    days: string; // first..last active day inside the window
    out: number;
    cacheR: number;
    activities: number;
    subMsgs: number;
    subOut: number;
    models: string[];
    skills: string[];
    topPrompt: string; // most expensive prompt inside the window
  }>;
  sessions: number;
  cacheEfficiency: number; // cacheR / (cacheR + cacheW)
}

const addBucket = (a: Bucket, b: Bucket) => {
  a.in += b.in;
  a.cacheW += b.cacheW;
  a.cacheR += b.cacheR;
  a.out += b.out;
  a.msgs += b.msgs;
};

export function buildReport(days: number): Report {
  const store = loadStore();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const totals = zero();
  const byDay: Record<string, Bucket> = {};
  const byModel: Record<string, Bucket> = {};
  const bySkill: Record<string, number> = {};
  const activities: Report["activities"] = [];
  const sessions = new Set<string>();
  const names = sessionTitles();

  for (const s of Object.values(store.sessions)) {
    for (const t of s.turns) {
      if (t.ts < since) continue;
      sessions.add(s.id);
      const day = t.ts.slice(0, 10);
      let out = 0;
      let cacheR = 0;
      const models: string[] = [];
      for (const [model, b] of Object.entries(t.models)) {
        addBucket(totals, b);
        addBucket((byDay[day] ??= zero()), b);
        addBucket((byModel[model] ??= zero()), b);
        out += b.out;
        cacheR += b.cacheR;
        models.push(model);
      }
      for (const sk of t.skills ?? []) bySkill[sk] = (bySkill[sk] ?? 0) + out;
      activities.push({
        day,
        session: s.id.slice(0, 8),
        sessionFull: s.id,
        title: titleFor(s, names),
        project: s.project.replace(/^-Users-[^-]+-/, ""),
        prompt: t.prompt,
        models,
        skills: t.skills ?? [],
        out,
        cacheR,
        subMsgs: t.subMsgs,
        subOut: t.subOut,
      });
    }
  }
  activities.sort((a, b) => b.out - a.out);

  // One row per session: the same long session owns many expensive activities,
  // and a per-activity list reads as duplicated sessions.
  const bySession = new Map<string, Report["topSessions"][number]>();
  for (const a of activities) {
    let s = bySession.get(a.sessionFull);
    if (!s) {
      s = {
        session: a.session,
        sessionFull: a.sessionFull,
        title: a.title,
        project: a.project,
        days: a.day,
        out: 0,
        cacheR: 0,
        activities: 0,
        subMsgs: 0,
        subOut: 0,
        models: [],
        skills: [],
        topPrompt: a.prompt, // activities are sorted by out, so the first seen is the biggest
      };
      bySession.set(a.sessionFull, s);
    }
    s.out += a.out;
    s.cacheR += a.cacheR;
    s.activities += 1;
    s.subMsgs += a.subMsgs;
    s.subOut += a.subOut;
    const dayLo = a.day < s.days.slice(0, 10) ? a.day : s.days.slice(0, 10);
    const dayHi = a.day > s.days.slice(-10) ? a.day : s.days.slice(-10);
    s.days = dayLo === dayHi ? dayLo : `${dayLo}..${dayHi}`;
    for (const m of a.models) if (!s.models.includes(m)) s.models.push(m);
    for (const sk of a.skills) if (!s.skills.includes(sk)) s.skills.push(sk);
  }
  const topSessions = [...bySession.values()].sort((a, b) => b.out - a.out).slice(0, 25);

  return {
    days,
    since: since.slice(0, 10),
    totals,
    byDay,
    byModel,
    bySkill,
    activities: activities.slice(0, 40),
    topSessions,
    sessions: sessions.size,
    cacheEfficiency: totals.cacheR + totals.cacheW ? totals.cacheR / (totals.cacheR + totals.cacheW) : 0,
  };
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

function printReport(r: Report): void {
  console.log(`Token consumption, last ${r.days} days (since ${r.since}) · ${r.sessions} session(s)`);
  console.log(
    `  output ${fmt(r.totals.out)} · fresh in ${fmt(r.totals.in)} · cache write ${fmt(r.totals.cacheW)} · cache read ${fmt(r.totals.cacheR)} · cache efficiency ${(r.cacheEfficiency * 100).toFixed(0)}%`,
  );
  console.log("\nBy day (output / cache write / cache read):");
  for (const day of Object.keys(r.byDay).sort()) {
    const b = r.byDay[day];
    console.log(`  ${day}  ${fmt(b.out).padStart(8)} / ${fmt(b.cacheW).padStart(8)} / ${fmt(b.cacheR).padStart(8)}`);
  }
  console.log("\nBy model:");
  for (const [model, b] of Object.entries(r.byModel).sort((a, b) => b[1].out - a[1].out)) {
    console.log(`  ${model.padEnd(28)} ${fmt(b.out).padStart(8)} out · ${String(b.msgs).padStart(5)} msgs · ${fmt(b.cacheR)} cache read`);
  }
  const skills = Object.entries(r.bySkill).sort((a, b) => b[1] - a[1]);
  if (skills.length) {
    console.log("\nBy attributed skill (output tokens of turns using it):");
    for (const [sk, out] of skills) console.log(`  ${sk.padEnd(28)} ${fmt(out).padStart(8)}`);
  }
  console.log("\nTop sessions by output tokens (resume with: myos --resume <id>; detail: session <id>):");
  for (const s of r.topSessions.slice(0, 8)) {
    const sub = s.subMsgs ? ` · sub ${s.subMsgs}msg/${fmt(s.subOut)}` : "";
    console.log(`  ${s.days.padEnd(21)} ${fmt(s.out).padStart(7)} out · ${String(s.activities).padStart(2)} activities${sub}  ${s.session}  ${s.title.slice(0, 48)}`);
  }
  console.log("\nTop activities by output tokens:");
  for (const a of r.activities.slice(0, 12)) {
    const sub = a.subMsgs ? ` (+${a.subMsgs} subagent msgs, ${fmt(a.subOut)} out)` : "";
    console.log(`  ${a.day} ${fmt(a.out).padStart(7)} out  ${a.session}  [${a.models.map((m) => m.replace("claude-", "")).join(",")}]${sub}  ${a.prompt.slice(0, 60)}`);
  }
}

// ─────────── rtk savings ───────────

/** The summary block of `rtk gain` (the token-savings proxy), or null when rtk
 * is absent or uncooperative. rtk's output is theirs, so this passes lines
 * through rather than parsing numbers that may change shape. */
export function rtkGainLines(): string[] | null {
  if (process.env.MYOS_TOKENLOG_NO_RTK === "1") return null;
  if (!Bun.which("rtk")) return null;
  try {
    const r = spawnSync("rtk", ["gain"], { encoding: "utf8", timeout: 8000 });
    if (r.status !== 0 || !r.stdout) return null;
    const lines = r.stdout.split("\n").map((l) => l.trimEnd());
    // Keep the header block up to (not including) the per-command table.
    const cut = lines.findIndex((l) => l.startsWith("By Command"));
    const block = (cut > 0 ? lines.slice(0, cut) : lines.slice(0, 10)).filter((l) => l.trim() && !/^[═─]+$/.test(l.trim()));
    return block.length ? block : null;
  } catch {
    return null;
  }
}

function printRtk(lines: string[] | null): void {
  if (!lines) return;
  console.log(`\nrtk savings (rtk gain):`);
  for (const l of lines) console.log(`  ${l}`);
}

// ─────────── Session detail ───────────

export function sessionDetail(idPrefix: string): { session?: SessionLog; matches: string[] } {
  const store = loadStore();
  const matches = Object.keys(store.sessions).filter((id) => id.startsWith(idPrefix));
  if (matches.length === 1) return { session: store.sessions[matches[0]], matches };
  return { matches };
}

function printSession(s: SessionLog): void {
  const root = projectsDir();
  const transcript = join(root, s.project, `${s.id}.jsonl`);
  const totals = zero();
  for (const t of s.turns) for (const b of Object.values(t.models)) addBucket(totals, b);
  console.log(`Session ${s.id}: "${titleFor(s, sessionTitles())}"`);
  console.log(`  project    ${s.project}`);
  console.log(`  span       ${s.firstTs.slice(0, 16)} → ${s.lastTs.slice(0, 16)} · ${s.turns.length} activities`);
  console.log(`  totals     ${fmt(totals.out)} out · ${fmt(totals.in)} fresh in · ${fmt(totals.cacheW)} cache write · ${fmt(totals.cacheR)} cache read`);
  console.log(`  transcript ${existsSync(transcript) ? transcript : "(pruned: log data only)"}`);
  console.log(`  resume     myos --resume ${s.id}   (from the project directory)`);
  const tools = Object.entries(s.tools ?? {}).sort((a, b) => b[1] - a[1]);
  if (tools.length) {
    console.log(`  tools      ${tools.slice(0, 10).map(([n, c]) => `${n}×${c}`).join(" · ")}`);
  }
  console.log("\nActivities (output tokens / cache read):");
  for (const t of s.turns) {
    const models = Object.keys(t.models).map((m) => m.replace("claude-", "")).join(",");
    let out = 0;
    let cacheR = 0;
    for (const b of Object.values(t.models)) {
      out += b.out;
      cacheR += b.cacheR;
    }
    const sk = t.skills?.length ? ` skills:${t.skills.join(",")}` : "";
    const sub = t.subMsgs ? ` sub:${t.subMsgs}msg/${fmt(t.subOut)}` : "";
    console.log(`  ${t.ts.slice(5, 16)} ${fmt(out).padStart(7)} / ${fmt(cacheR).padStart(7)}  [${models}]${sk}${sub}  ${t.prompt.slice(0, 64)}`);
  }
}

// ─────────── Dashboard ───────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function barChart(byDay: Record<string, Bucket>, key: keyof Bucket, title: string, color: string): string {
  const days = Object.keys(byDay).sort();
  if (days.length === 0) return `<p>No data.</p>`;
  const max = Math.max(...days.map((d) => byDay[d][key] as number), 1);
  const w = 18;
  const left = 30; // margin so the leftmost rotated label stays inside the viewBox
  const base = 118; // bar baseline; rotated labels swing ~24px below and left of their anchor
  const width = days.length * w + left + 12;
  const step = Math.max(1, Math.ceil(days.length / 6)); // at most ~6 labels, rotated
  const bars = days
    .map((d, i) => {
      const v = byDay[d][key] as number;
      const h = Math.max(Math.round((v / max) * 108), 1);
      const cx = left + i * w + w / 2;
      return (
        `<rect x="${left + i * w + 2}" y="${base - h}" width="${w - 4}" height="${h}" fill="${color}"><title>${d}: ${fmt(v)}</title></rect>` +
        (i % step === 0 || i === days.length - 1
          ? `<text x="${cx}" y="${base + 12}" font-size="9" fill="currentColor" text-anchor="end" transform="rotate(-45 ${cx} ${base + 12})">${d.slice(5)}</text>`
          : "")
      );
    })
    .join("");
  return `<figure><figcaption>${title} (max ${fmt(max)}/day)</figcaption><svg viewBox="0 0 ${width} 158" width="100%" height="178" preserveAspectRatio="xMinYMid meet" role="img">${bars}</svg></figure>`;
}

export function buildDashboard(days: number): string {
  const r = buildReport(days);
  const modelRows = Object.entries(r.byModel)
    .sort((a, b) => b[1].out - a[1].out)
    .map(([m, b]) => `<tr><td>${esc(m)}</td><td>${fmt(b.out)}</td><td>${b.msgs}</td><td>${fmt(b.in)}</td><td>${fmt(b.cacheW)}</td><td>${fmt(b.cacheR)}</td></tr>`)
    .join("");
  const rtk = rtkGainLines();
  const rtkHtml = rtk ? `<h2>rtk savings (rtk gain)</h2><pre>${esc(rtk.join("\n"))}</pre>` : "";
  const sessRows = r.topSessions
    .slice(0, 20)
    .map(
      (s) =>
        `<tr><td>${s.days}</td><td>${fmt(s.out)}</td><td>${s.activities}</td><td>${esc(s.models.map((m) => m.replace("claude-", "")).join(", "))}</td><td>${esc(s.skills.join(", "))}</td><td>${s.subMsgs || ""}</td><td title="biggest activity: ${esc(s.topPrompt.slice(0, 160))}">${esc(s.title)}<br><small>${esc(s.project)}·<span class="sid" data-sid="${esc(s.sessionFull)}" title="click to copy ${esc(s.sessionFull)}">${s.session}</span></small></td></tr>`,
    )
    .join("");
  let theme = "";
  try {
    theme = readFileSync(join(storeDir(), "theme.css"), "utf8");
  } catch {
    /* unthemed: base styles only */
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>myos token use</title><style>
  body{font:14px/1.5 -apple-system,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#fff}
  @media(prefers-color-scheme:dark){body{color:#e8e8e8;background:#141414}}
  h1{font-size:1.3rem} figure{margin:1rem 0} figcaption{font-size:.85rem;opacity:.7}
  .cards{display:flex;gap:1rem;flex-wrap:wrap}.card{border:1px solid #8884;border-radius:8px;padding:.7rem 1rem;min-width:9rem}
  .card b{display:block;font-size:1.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.85rem}
  td,th{border-bottom:1px solid #8883;padding:.3rem .5rem;text-align:left;vertical-align:top}
  small{opacity:.6}
  .sid{cursor:pointer;text-decoration:underline dotted}.sid:hover{opacity:1;text-decoration:underline}
  .howto{border:1px solid #8884;border-radius:8px;padding:.5rem .8rem;font-size:.9rem}
  pre{font-size:.8rem;border:1px solid #8884;border-radius:8px;padding:.6rem .8rem;overflow-x:auto}
  </style>${theme ? `<style>${theme}</style>` : ""}</head><body>
  <h1>myos token consumption, last ${r.days} days</h1>
  <p>Generated ${new Date().toISOString().slice(0, 16)}Z · ${r.sessions} session(s) · local data only</p>
  <div class="cards">
   <div class="card"><b>${fmt(r.totals.out)}</b>output tokens</div>
   <div class="card"><b>${fmt(r.totals.in)}</b>fresh input</div>
   <div class="card"><b>${fmt(r.totals.cacheW)}</b>cache write</div>
   <div class="card"><b>${fmt(r.totals.cacheR)}</b>cache read</div>
   <div class="card"><b>${(r.cacheEfficiency * 100).toFixed(0)}%</b>cache efficiency</div>
  </div>
  ${barChart(r.byDay, "out", "Output tokens per day", "#4a7dbd")}
  ${barChart(r.byDay, "cacheR", "Cache-read tokens per day (volume, cheap)", "#7dbd7d")}
  <h2>By model</h2>
  <table><tr><th>Model</th><th>Output</th><th>Msgs</th><th>Fresh in</th><th>Cache write</th><th>Cache read</th></tr>${modelRows}</table>
  <h2>Top sessions by output tokens</h2>
  <p class="howto">To resume a session: <code>myos --resume &lt;session_id&gt;</code><br>
  Per-activity detail for any session: <code>bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts session &lt;session_id&gt;</code><br>
  Click on session ids below to copy.</p>
  <table><tr><th>Active</th><th>Out</th><th>Activities</th><th>Models</th><th>Skills</th><th>Sub msgs</th><th>Session (click id to copy · hover for biggest activity)</th></tr>${sessRows}</table>
  ${rtkHtml}
  <script>
  document.addEventListener("click", async (e) => {
    const el = e.target.closest(".sid");
    if (!el) return;
    const id = el.dataset.sid;
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      // file:// without clipboard permission: legacy path
      const t = document.createElement("textarea");
      t.value = id; document.body.appendChild(t); t.select();
      document.execCommand("copy"); t.remove();
    }
    const original = el.textContent;
    el.textContent = "copied ✓";
    setTimeout(() => { el.textContent = original; }, 900);
  });
  </script>
  </body></html>`;
}

// ─────────── CLI ───────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--days");
  const cmd = positional[0] ?? "sync";
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 14 : 14;
  const quiet = args.includes("--quiet");

  if (cmd === "sync") {
    sync({ quiet });
  } else if (cmd === "report") {
    sync({ quiet: true });
    const r = buildReport(days);
    const rtk = rtkGainLines();
    if (args.includes("--json")) console.log(JSON.stringify({ ...r, rtk }, null, 1));
    else {
      printReport(r);
      printRtk(rtk);
    }
  } else if (cmd === "session") {
    sync({ quiet: true });
    const idPrefix = positional[1];
    if (!idPrefix) {
      console.error("TokenLog: session needs an id (any unique prefix)");
      process.exit(1);
    }
    const { session, matches } = sessionDetail(idPrefix);
    if (!session) {
      console.error(
        matches.length === 0
          ? `TokenLog: no session starts with "${idPrefix}"`
          : `TokenLog: ambiguous prefix "${idPrefix}": matches ${matches.slice(0, 5).join(", ")}`,
      );
      process.exit(1);
    }
    if (args.includes("--json")) console.log(JSON.stringify(session, null, 1));
    else printSession(session);
  } else if (cmd === "dashboard") {
    sync({ quiet: true });
    const path = join(storeDir(), "dashboard.html");
    writeFileSync(path, buildDashboard(days));
    console.log(path);
  } else {
    console.error(`TokenLog: unknown command "${cmd}" (sync | report [--days N] [--json] | session <id> [--json] | dashboard [--days N])`);
    process.exit(1);
  }
}
