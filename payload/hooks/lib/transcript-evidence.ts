/**
 * transcript-evidence.ts: what the transcript shows actually happened.
 *
 * The message is a CLAIM; the transcript is the EVIDENCE. This module turns a
 * Claude Code transcript into an ordered list of tool events (the current turn
 * by default, the whole session with `sessionWindow`) and answers questions
 * like "was the deployed site probed after the deploy?". Every ambiguity reads
 * as "no evidence", and absence only ever feeds a PASS through the gates'
 * act-then-claim precondition, so this module is never why a Stop blocks.
 *
 * Browser evidence comes from two drivers, and both count the same:
 *   - Interceptor: Bash `interceptor <verb> ...` and the Interceptor skill
 *   - Claude in Chrome: `mcp__claude-in-chrome__*` tool calls
 *
 * Ported from LifeOS 7.40.4 VerificationGate 1.0.6 (transcript-evidence).
 */
import { readTranscriptTail } from "./hook-io";

export type EventKind =
  | "edit" // Edit/Write/MultiEdit/NotebookEdit
  | "deploy" // wrangler/pages deploy, bun run deploy, ~/bin/publish
  | "probe" // curl/httpie/WebFetch to a URL
  | "browser-nav" // navigate, open, DOM or page-text read, console or network read
  | "browser-interact" // click, type, fill, submit, form input
  | "browser-capture" // screenshot
  | "test-run" // bun test and friends
  | "read-image" // Read of a .png/.jpg/.webp (the model looked at it)
  | "agent-result" // Agent/Task
  | "command" // any other Bash command (keeps its text and its error flag)
  | "tool"; // any other tool call (counts toward staleness, nothing else)

export interface TxEvent {
  seq: number;
  kind: EventKind;
  tool: string;
  /** File path, URL host, or command text: kind specific. */
  target: string;
  /** Text of the paired tool_result. */
  resultText: string;
  /** Tool error flag OR failure markers in the result text. */
  isError: boolean;
  /** The raw tool_result is_error flag, no text heuristics. */
  isToolError: boolean;
  /** Doc edits (.md, MEMORY, ISA) are not code mutations. */
  isCode: boolean;
  /** A capture whose pixels came straight back to the model (no Read needed). */
  viewed?: boolean;
  /** Full Bash command text (up to 2000 chars), whatever the kind. */
  command?: string;
}

const CHROME_PREFIX = "mcp__claude-in-chrome__";

function safeRead(path: string): string | null {
  return readTranscriptTail(path);
}

function eTLD1(host: string): string {
  const parts = host.replace(/^https?:\/\//, "").split("/")[0]!.split(":")[0]!.split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

function extractHost(cmd: string): string {
  const m = cmd.match(/https?:\/\/([^\s"'/]+)/i);
  return m ? eTLD1(m[1]!) : "";
}

export const DEPLOY_RE =
  /\b(wrangler(@\S+)?\s+(pages\s+)?deploy|bun\s+run\s+deploy|pages\s+deploy)\b|(?:^|[\s;&|(])(?:~|\$HOME|\$\{HOME\}|\/Users\/[^/\s]+)?\/bin\/publish\b/i;
const TEST_RE = /\b(bun\s+test|pytest|go\s+test|cargo\s+test|vitest|npm\s+(run\s+)?test|jest|deno\s+test)\b/i;
const INTERCEPTOR_RE = /(?:^|[\s;&|(])interceptor\s|Interceptor\/Tools/i;
const NAV_RE = /\b(open|navigate|goto|read|inspect)\b/i;
const INTERACT_RE = /\b(click|type|fill|submit|act\b|keys)\b/i; // eval is a read, not an interaction
const CAPTURE_RE = /\b(screenshot|capture|scrub)\b/i;
const PROBE_RE = /\bcurl\b|\bhttpie\b/i;
const IMG_RE = /\.(png|jpe?g|webp)\b/i;
// An HTTP 4xx/5xx status line or explicit failure words. Not a bare "500"
// (matches "500.42 KiB") and not a bare "error" (common in success text).
const ERROR_MARKERS =
  /\bHTTP[/ ]?\d(\.\d)?\s+[45]\d\d\b|\b(internal server error|traceback|connection refused|timed out|command not found|permission denied)\b|"?is_error"?\s*[:=]\s*true|\bexit\s+(code\s+)?[1-9]\d*\b/i;
// A real success status line or session marker, not a bare number.
const HTTP_SUCCESS = /\bHTTP[/ ]?\d(\.\d)?\s+[23]\d\d\b|set-cookie|location:\s*\//i;

/** Claude in Chrome tool name -> evidence kind. */
function chromeKind(short: string, input: Record<string, unknown>): { kind: EventKind; viewed?: boolean } {
  if (short === "computer") {
    const action = String(input.action ?? "");
    if (action === "screenshot" || action === "zoom") return { kind: "browser-capture", viewed: true };
    if (/click|type|key|drag|scroll|hover/.test(action)) return { kind: "browser-interact" };
    return { kind: "browser-nav" };
  }
  if (short === "form_input" || short === "file_upload" || short === "upload_image") return { kind: "browser-interact" };
  if (short === "gif_creator") return { kind: "browser-capture" };
  return { kind: "browser-nav" };
}

export function testResultPassed(text: string): boolean {
  const f = text.match(/\b(\d+)\s+fail/i);
  if (f && Number(f[1]) > 0) return false;
  if (/\b0\s+pass\b/i.test(text)) return false;
  return /\b([1-9]\d*)\s+pass\b/i.test(text) || /\bexit(\s+code)?\s+0\b/i.test(text) || /\ball\s+(tests?\s+)?(pass|green)/i.test(text);
}

interface RawEntry { type?: string; role?: string; message?: any; content?: any; isSidechain?: boolean }

/**
 * Events of the current turn (after the last real user text), or of the whole
 * transcript with `sessionWindow`. [] on any read or parse failure.
 */
export function parseTurnEvents(transcriptPath: string, opts?: { sessionWindow?: boolean }): TxEvent[] {
  const raw = safeRead(transcriptPath);
  if (!raw) return [];

  const results = new Map<string, { text: string; isError: boolean }>();
  const parsed: RawEntry[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.includes("tool_use") && !line.includes("tool_result") && !line.includes('"user"') && !line.includes('"human"')) continue;
    let entry: RawEntry;
    try { entry = JSON.parse(line) as RawEntry; } catch { continue; }
    if (entry.isSidechain === true) continue; // a subagent's own calls are not ours
    parsed.push(entry);
    const content = entry.message?.content ?? entry.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === "tool_result" && b.tool_use_id) {
        const text = typeof b.content === "string" ? b.content
          : Array.isArray(b.content) ? b.content.map((c: any) => c?.text ?? "").join(" ") : "";
        results.set(b.tool_use_id, { text: String(text).slice(0, 4000), isError: b.is_error === true });
      }
    }
  }

  let turnStart = 0;
  if (!opts?.sessionWindow) {
    for (let k = parsed.length - 1; k >= 0; k--) {
      const e = parsed[k]!;
      const role = e.role ?? e.message?.role ?? e.type;
      if (role !== "user" && role !== "human") continue;
      const content = e.message?.content ?? e.content;
      const toolResultOnly = Array.isArray(content) && content.every((b: any) => b?.type === "tool_result");
      const hasText = typeof content === "string" ? content.trim().length > 0
        : Array.isArray(content) && content.some((b: any) => b?.type === "text" && b.text?.trim());
      if (!toolResultOnly && hasText) { turnStart = k; break; }
    }
  }

  const events: TxEvent[] = [];
  let seq = 0;
  for (let k = turnStart; k < parsed.length; k++) {
    const e = parsed[k]!;
    const content = e.message?.content ?? e.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type !== "tool_use") continue;
      const name = String(b.name ?? "");
      const input = (b.input ?? {}) as Record<string, unknown>;
      const res = b.id ? results.get(b.id) : undefined;
      const resultText = res?.text ?? "";
      const isToolError = res?.isError === true;
      const isError = isToolError || (resultText ? ERROR_MARKERS.test(resultText) : false);
      const push = (kind: EventKind, target: string, extra: Partial<TxEvent> = {}) =>
        events.push({ seq: seq++, kind, tool: name, target, resultText, isError, isToolError, isCode: false, ...extra });

      if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") {
        const p = String(input.file_path ?? input.notebook_path ?? "");
        const isCode = !!p && !/\.(md|markdown|txt)$|\/MEMORY\//i.test(p);
        push("edit", p, { isCode });
      } else if (name === "Bash") {
        const cmd = String(input.command ?? "");
        const bash = { command: cmd.slice(0, 2000) };
        if (DEPLOY_RE.test(cmd)) push("deploy", extractHost(cmd), bash);
        else if (INTERCEPTOR_RE.test(cmd)) {
          // Capture first: `screenshot --out navigate.png` is a capture, not a nav.
          if (CAPTURE_RE.test(cmd)) push("browser-capture", extractHost(cmd), bash);
          else if (INTERACT_RE.test(cmd)) push("browser-interact", extractHost(cmd), bash);
          else push("browser-nav", extractHost(cmd), bash);
        } else if (TEST_RE.test(cmd) && !/--dry-run/.test(cmd)) push("test-run", cmd.slice(0, 120), bash);
        else if (PROBE_RE.test(cmd)) push("probe", extractHost(cmd), bash);
        // Kept long: ISAFoldGate matches mutation shapes against this text.
        else push("command", cmd.slice(0, 2000), bash);
      } else if (name === "WebFetch") {
        push("probe", eTLD1(String(input.url ?? "")));
      } else if (name === "Read") {
        const p = String(input.file_path ?? "");
        if (IMG_RE.test(p)) push("read-image", p);
        else push("tool", p);
      } else if (name === "Agent" || name === "Task") {
        push("agent-result", String(input.description ?? name));
      } else if (name === "Skill" && /^interceptor$/i.test(String(input.skill ?? input.command ?? input.name ?? ""))) {
        push("browser-nav", "");
      } else if (name.startsWith(CHROME_PREFIX)) {
        const { kind, viewed } = chromeKind(name.slice(CHROME_PREFIX.length), input);
        push(kind, eTLD1(String(input.url ?? "")), viewed ? { viewed } : {});
      } else {
        push("tool", String(input.file_path ?? input.path ?? input.pattern ?? ""));
      }
    }
  }
  return events;
}

// Query API: absent evidence reads as "no evidence".

export function lastCodeMutationSeq(ev: TxEvent[]): number {
  let s = -1;
  for (const e of ev) if ((e.kind === "edit" && e.isCode) || e.kind === "deploy") s = Math.max(s, e.seq);
  return s;
}
export function hadDeploy(ev: TxEvent[]): boolean { return ev.some((e) => e.kind === "deploy"); }
export function hadCodeEdit(ev: TxEvent[]): boolean { return ev.some((e) => e.kind === "edit" && e.isCode); }
export function hadFrontendEdit(ev: TxEvent[]): boolean {
  return ev.some((e) => e.kind === "edit" && /\.(tsx|jsx|vue|svelte|css|scss|html|liquid|astro|png|svg|webp)$/i.test(e.target));
}
export function spawnedAgent(ev: TxEvent[]): boolean { return ev.some((e) => e.kind === "agent-result"); }
/** Edits to auth or flow files: lets a terse "verified" be typed as a flow claim. */
export function hadFlowEdit(ev: TxEvent[]): boolean {
  return ev.some((e) => e.kind === "edit" && e.isCode && /(auth|login|oauth|sign[\s-]?in|callback|session|checkout|payment)/i.test(e.target));
}

const isBrowser = (k: EventKind) => k === "browser-nav" || k === "browser-capture" || k === "browser-interact";

/** A successful probe or browser look after the LAST deploy. */
export function probedAfterDeploy(ev: TxEvent[], host?: string): boolean {
  const dep = ev.filter((e) => e.kind === "deploy").map((e) => e.seq);
  if (dep.length === 0) return false;
  const after = Math.max(...dep);
  return ev.some(
    (e) => e.seq > after && !e.isError && (e.kind === "probe" || isBrowser(e.kind)) &&
      (!host || !e.target || eTLD1(host) === e.target),
  );
}

/**
 * The flow was EXERCISED, not just rendered: after the last mutation either a
 * browser interaction plus a nav or capture, or a round trip whose result
 * shows a 2xx/3xx, Set-Cookie or redirect. A lone capture is never enough.
 */
export function flowExercised(ev: TxEvent[]): boolean {
  const after = lastCodeMutationSeq(ev);
  const post = ev.filter((e) => e.seq > after);
  const interacted = post.some((e) => e.kind === "browser-interact" && !e.isError);
  const looked = post.some((e) => (e.kind === "browser-nav" || e.kind === "browser-capture") && !e.isError);
  if (interacted && looked) return true;
  return post.some((e) => (e.kind === "probe" || e.kind === "browser-nav") && !e.isError && HTTP_SUCCESS.test(e.resultText));
}

/** Pixels were captured AND viewed after the last code mutation. */
export function pixelViewed(ev: TxEvent[]): boolean {
  const after = lastCodeMutationSeq(ev);
  const post = ev.filter((e) => e.seq > after);
  if (post.some((e) => e.kind === "browser-capture" && e.viewed && !e.isError)) return true;
  const captured = post.some((e) => e.kind === "browser-capture" && !e.isError);
  const read = post.some((e) => e.kind === "read-image");
  return captured && read;
}

export function testPassedAfterEdit(ev: TxEvent[]): boolean {
  const after = lastCodeMutationSeq(ev);
  return ev.some((e) => e.seq > after && e.kind === "test-run" && !e.isError && testResultPassed(e.resultText));
}
