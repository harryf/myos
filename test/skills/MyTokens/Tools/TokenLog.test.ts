/**
 * TokenLog.ts is pure fixture-testable logic: transcripts in, aggregates out.
 * Fixtures mirror the real Claude Code JSONL shapes (verified against live
 * transcripts 2026-07-31): user prompts, tool results arriving as type:"user",
 * sidechain (subagent) traffic, retried message ids, torn final lines.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bunExe, envScope, repoPath, run, tempDir, tempHome } from "../../../harness.ts";
import {
  buildDashboard,
  buildReport,
  loadStore,
  parseTranscript,
  rtkGainLines,
  sessionDetail,
  sync,
} from "../../../../payload/skills/MyTokens/Tools/TokenLog.ts";

// ── fixture builders ─────────────────────────────────────────────────────────

const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
let uuidN = 0;
const ts = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

function userLine(text: string, minAgo: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    timestamp: ts(minAgo),
    sessionId: SID,
    uuid: `u-${uuidN++}`,
    message: { role: "user", content: text },
    ...extra,
  });
}

function toolResultLine(minAgo: number): string {
  return JSON.stringify({
    type: "user",
    timestamp: ts(minAgo),
    sessionId: SID,
    uuid: `u-${uuidN++}`,
    toolUseResult: { stdout: "ok" },
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-1", content: "ok" }] },
  });
}

function assistantLine(
  msgId: string,
  out: number,
  minAgo: number,
  opts: { model?: string; side?: boolean; cacheR?: number; cacheW?: number; in?: number; skill?: string; tool?: string } = {},
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts(minAgo),
    sessionId: SID,
    uuid: `a-${uuidN++}`,
    isSidechain: opts.side ?? false,
    ...(opts.skill ? { attributionSkill: opts.skill } : {}),
    message: {
      id: msgId,
      model: opts.model ?? "claude-fable-5",
      role: "assistant",
      ...(opts.tool ? { content: [{ type: "tool_use", id: "tu-x", name: opts.tool, input: {} }] } : {}),
      usage: {
        input_tokens: opts.in ?? 2,
        cache_creation_input_tokens: opts.cacheW ?? 100,
        cache_read_input_tokens: opts.cacheR ?? 1000,
        output_tokens: out,
      },
    },
  });
}

const lines = (...ls: string[]) => ls.join("\n") + "\n";

// ── parseTranscript ──────────────────────────────────────────────────────────

describe("parseTranscript", () => {
  test("attributes usage to the triggering prompt, per model", () => {
    using dir = tempDir("tokenlog-parse", {
      "t.jsonl": lines(
        userLine("first task", 30),
        assistantLine("m1", 500, 29),
        assistantLine("m2", 300, 28, { model: "claude-opus-5" }),
        userLine("second task", 20),
        assistantLine("m3", 700, 19),
      ),
    });
    const log = parseTranscript(dir.join("t.jsonl"), "proj")!;
    expect(log.id).toBe(SID);
    expect(log.turns.length).toBe(2);
    expect(log.turns[0].prompt).toBe("first task");
    expect(log.turns[0].models["claude-fable-5"].out).toBe(500);
    expect(log.turns[0].models["claude-opus-5"].out).toBe(300);
    expect(log.turns[1].models["claude-fable-5"].out).toBe(700);
  });

  test("tool results and sidechain prompts never start turns; sidechain usage is tracked", () => {
    using dir = tempDir("tokenlog-side", {
      "t.jsonl": lines(
        userLine("fan out", 30),
        toolResultLine(29),
        userLine("subagent prompt", 28, { isSidechain: true }),
        assistantLine("m1", 400, 27, { side: true }),
        assistantLine("m2", 100, 26),
      ),
    });
    const log = parseTranscript(dir.join("t.jsonl"), "proj")!;
    expect(log.turns.length).toBe(1);
    expect(log.turns[0].models["claude-fable-5"].out).toBe(500);
    expect(log.turns[0].subMsgs).toBe(1);
    expect(log.turns[0].subOut).toBe(400);
  });

  test("repeated message ids count once, last wins; torn lines are skipped", () => {
    using dir = tempDir("tokenlog-dedupe", {
      "t.jsonl":
        lines(userLine("task", 30), assistantLine("m1", 100, 29), assistantLine("m1", 150, 28)) +
        '{"type":"assistant","message":{"usage"', // torn write at file end
    });
    const log = parseTranscript(dir.join("t.jsonl"), "proj")!;
    expect(log.turns[0].models["claude-fable-5"].out).toBe(150);
    expect(log.turns[0].models["claude-fable-5"].msgs).toBe(1);
  });

  test("pre-prompt usage lands in a session-start pseudo-turn; commands get slash labels", () => {
    using dir = tempDir("tokenlog-pre", {
      "t.jsonl": lines(
        assistantLine("m0", 50, 40),
        userLine("<command-name>/compact</command-name> <command-message>compact</command-message>", 30),
        assistantLine("m1", 60, 29),
        userLine("ran a thing<local-command-stdout>output</local-command-stdout>", 28),
      ),
    });
    const log = parseTranscript(dir.join("t.jsonl"), "proj")!;
    expect(log.turns.length).toBe(2);
    expect(log.turns[0].prompt).toBe("(session start)");
    expect(log.turns[0].models["claude-fable-5"].out).toBe(50);
    expect(log.turns[1].prompt).toBe("/compact");
  });

  test("a transcript with no usage yields null", () => {
    using dir = tempDir("tokenlog-empty", { "t.jsonl": lines(userLine("hello", 5)) });
    expect(parseTranscript(dir.join("t.jsonl"), "proj")).toBeNull();
  });

  test("subagent files merge into the turn active at their timestamp", () => {
    using dir = tempDir("tokenlog-agents", {
      "t.jsonl": lines(
        userLine("first", 60),
        assistantLine("m1", 100, 59),
        userLine("fan out here", 30),
        assistantLine("m2", 200, 29, { tool: "Bash" }),
      ),
      "agent-a.jsonl": lines(
        assistantLine("am1", 400, 25, { side: true, tool: "Read" }),
        assistantLine("am2", 50, 24, { side: true, model: "claude-haiku-4-5-20251001" }),
      ),
    });
    const log = parseTranscript(dir.join("t.jsonl"), "proj", [dir.join("agent-a.jsonl")])!;
    expect(log.turns.length).toBe(2);
    expect(log.turns[0].subMsgs).toBe(0);
    expect(log.turns[1].subMsgs).toBe(2);
    expect(log.turns[1].subOut).toBe(450);
    expect(log.turns[1].models["claude-fable-5"].out).toBe(600); // 200 main + 400 agent
    expect(log.turns[1].models["claude-haiku-4-5-20251001"].out).toBe(50);
    expect(log.tools).toEqual({ Bash: 1, Read: 1 });
  });

  test("attributionSkill lands on the turn's skills list, deduplicated", () => {
    using dir = tempDir("tokenlog-skill", {
      "t.jsonl": lines(
        userLine("check my projects", 30),
        assistantLine("m1", 100, 29, { skill: "GigsLinear" }),
        assistantLine("m2", 100, 28, { skill: "GigsLinear" }),
        assistantLine("m3", 100, 27, { skill: "Writing" }),
      ),
    });
    const log = parseTranscript(dir.join("t.jsonl"), "proj")!;
    expect(log.turns[0].skills).toEqual(["GigsLinear", "Writing"]);
  });
});

// ── sync + store ─────────────────────────────────────────────────────────────

describe("sync", () => {
  test("scans, skips unchanged, replaces on change, excludes release probes", async () => {
    using projects = tempDir("tokenlog-projects");
    using store = tempDir("tokenlog-store");
    using _env = envScope({
      MYOS_TOKENLOG_PROJECTS: projects.path,
      MYOS_TOKENLOG_STORE: store.path,
    });

    projects.write("-Users-x-proj/s1.jsonl", lines(userLine("task", 30), assistantLine("m1", 100, 29)));
    projects.write("-tmp-myos-release-probe-abc/s2.jsonl", lines(userLine("probe", 30), assistantLine("m9", 999, 29)));

    const first = sync({ quiet: true });
    expect(first).toEqual({ scanned: 1, skipped: 0, sessions: 1 });

    const second = sync({ quiet: true });
    expect(second).toEqual({ scanned: 0, skipped: 1, sessions: 1 });

    // Grow the transcript: re-parse replaces the session, nothing double-counts.
    await Bun.sleep(5); // distinct mtime
    projects.write(
      "-Users-x-proj/s1.jsonl",
      lines(userLine("task", 30), assistantLine("m1", 100, 29), assistantLine("m2", 40, 28)),
    );
    sync({ quiet: true });
    const s = loadStore().sessions[SID];
    expect(s.turns[0].models["claude-fable-5"].out).toBe(140);
    expect(s.turns[0].models["claude-fable-5"].msgs).toBe(2);
  });

  test("subagent transcripts under <session>/subagents/ are scanned; sessionDetail resolves prefixes", () => {
    using projects = tempDir("tokenlog-projects-sub");
    using store = tempDir("tokenlog-store-sub");
    using _env = envScope({
      MYOS_TOKENLOG_PROJECTS: projects.path,
      MYOS_TOKENLOG_STORE: store.path,
    });
    projects.write("-Users-x-proj/" + SID + ".jsonl", lines(userLine("fan out", 30), assistantLine("m1", 100, 29)));
    projects.write(
      `-Users-x-proj/${SID}/subagents/agent-abc.jsonl`,
      lines(assistantLine("am1", 300, 25, { side: true })),
    );
    sync({ quiet: true });
    const { session } = sessionDetail(SID.slice(0, 8));
    expect(session!.turns[0].subMsgs).toBe(1);
    expect(session!.turns[0].models["claude-fable-5"].out).toBe(400);
    expect(sessionDetail("zzzz").matches).toEqual([]);
  });

  test("a store written by an older parser version is rebuilt, not mixed", () => {
    using projects = tempDir("tokenlog-projects-mig");
    using store = tempDir("tokenlog-store-mig", {
      "sessions.json": JSON.stringify({ version: 1, sessions: { stale: { id: "stale" } } }),
      "cursor.json": JSON.stringify({ files: { "/old/path.jsonl": { mtimeMs: 1, size: 1 } } }),
    });
    using _env = envScope({
      MYOS_TOKENLOG_PROJECTS: projects.path,
      MYOS_TOKENLOG_STORE: store.path,
    });
    projects.write("-Users-x-proj/s1.jsonl", lines(userLine("task", 30), assistantLine("m1", 100, 29)));
    const r = sync({ quiet: true });
    expect(r.sessions).toBe(1);
    expect(loadStore().sessions["stale"]).toBeUndefined();
  });

  test("missing projects root still writes an empty store", () => {
    using store = tempDir("tokenlog-store2");
    using _env = envScope({
      MYOS_TOKENLOG_PROJECTS: store.join("does-not-exist"),
      MYOS_TOKENLOG_STORE: store.path,
    });
    expect(sync({ quiet: true })).toEqual({ scanned: 0, skipped: 0, sessions: 0 });
    expect(JSON.parse(readFileSync(join(store.path, "sessions.json"), "utf8")).sessions).toEqual({});
  });
});

// ── report + dashboard ───────────────────────────────────────────────────────

describe("report and dashboard", () => {
  test("windows, model split, activity ranking, cache efficiency, dashboard content", () => {
    using projects = tempDir("tokenlog-projects3");
    using store = tempDir("tokenlog-store3");
    using _env = envScope({
      MYOS_TOKENLOG_PROJECTS: projects.path,
      MYOS_TOKENLOG_STORE: store.path,
      MYOS_TOKENLOG_NO_RTK: "1", // never shell out to a real rtk in tests
    });
    projects.write(
      "-Users-x-proj/s1.jsonl",
      lines(
        userLine("big analysis job", 60),
        assistantLine("m1", 900, 59, { cacheR: 9000, cacheW: 1000 }),
        userLine("small question", 30),
        assistantLine("m2", 100, 29, { model: "claude-haiku-4-5-20251001", cacheR: 0, cacheW: 0 }),
      ),
    );
    sync({ quiet: true });

    const r = buildReport(7);
    expect(r.totals.out).toBe(1000);
    expect(r.sessions).toBe(1);
    expect(r.byModel["claude-fable-5"].out).toBe(900);
    expect(r.byModel["claude-haiku-4-5-20251001"].out).toBe(100);
    expect(r.activities[0].prompt).toBe("big analysis job"); // ranked by output
    expect(r.topSessions[0].activities).toBe(2); // both turns fold into one session row
    expect(r.topSessions[0].out).toBe(1000);
    expect(r.topSessions[0].topPrompt).toBe("big analysis job");
    expect(r.topSessions[0].models.sort()).toEqual(["claude-fable-5", "claude-haiku-4-5-20251001"]);
    expect(r.cacheEfficiency).toBeCloseTo(0.9, 5);
    expect(Object.keys(r.byDay).length).toBeGreaterThanOrEqual(1);

    const html = buildDashboard(7);
    expect(html).toContain("big analysis job"); // fallback title: the first prompt
    expect(html).toContain("claude-fable-5");
    expect(html).toContain("<svg");
    expect(html).not.toContain("<script src"); // self-contained, no external deps

    // click-to-copy: the short id renders as a .sid span carrying the FULL id,
    // and the how-to block sits between the top-sessions heading and its table
    expect(html).toContain(`data-sid="${SID}"`);
    expect(html).toContain('class="sid"');
    expect(html).toContain("myos --resume &lt;session_id&gt;");
    expect(html).toContain("TokenLog.ts session &lt;session_id&gt;");
    expect(html).toContain("Click on session ids below to copy");
    const h2 = html.indexOf("Top sessions by output tokens");
    const howto = html.indexOf('class="howto"');
    const table = html.indexOf(`data-sid="${SID}"`);
    expect(h2).toBeGreaterThan(-1);
    expect(howto).toBeGreaterThan(h2);
    expect(table).toBeGreaterThan(howto);
  });

  test("dashboard has no local-model section; the rtk section is suppressible", () => {
    using projects = tempDir("tokenlog-projects5");
    using store = tempDir("tokenlog-store5");
    using _env = envScope({
      MYOS_TOKENLOG_PROJECTS: projects.path,
      MYOS_TOKENLOG_STORE: store.path,
      MYOS_TOKENLOG_NO_RTK: "1",
    });
    projects.write("-Users-x-proj/s9.jsonl", lines(userLine("task", 30), assistantLine("m1", 100, 29)));
    sync({ quiet: true });

    const html = buildDashboard(7);
    expect(html).not.toContain("Local model");
    expect(html).not.toContain("rtk savings"); // suppressed by MYOS_TOKENLOG_NO_RTK
    expect(html).not.toMatch(/\$\d/); // no dollar figures, by design
  });

  test("session names overlay as titles; theme.css is inlined when present", () => {
    using projects = tempDir("tokenlog-projects4");
    using store = tempDir("tokenlog-store4");
    using names = tempDir("tokenlog-names4", {
      "session-names.json": JSON.stringify({ [SID]: "Roaming Checkout Deep Dive" }),
    });
    using _env = envScope({
      MYOS_TOKENLOG_PROJECTS: projects.path,
      MYOS_TOKENLOG_STORE: store.path,
      MYOS_TOKENLOG_NAMES: names.join("session-names.json"),
      MYOS_TOKENLOG_NO_RTK: "1",
    });
    projects.write("-Users-x-proj/s1.jsonl", lines(userLine("task", 30), assistantLine("m1", 100, 29)));
    store.write("theme.css", "body{--myos-theme-marker:1}");
    sync({ quiet: true });

    const r = buildReport(7);
    expect(r.activities[0].title).toBe("Roaming Checkout Deep Dive");
    expect(r.topSessions.length).toBe(1); // activities fold to one row per session
    expect(r.topSessions[0].activities).toBe(1);
    expect(r.topSessions[0].out).toBe(100);

    const html = buildDashboard(7);
    expect(html).toContain("Roaming Checkout Deep Dive");
    expect(html).toContain("--myos-theme-marker"); // theme inlined after base styles
  });
});

// ── rtk and the CLI ──────────────────────────────────────────────────────────

describe("rtkGainLines", () => {
  test("suppressed by MYOS_TOKENLOG_NO_RTK (the tests' default posture)", () => {
    using _ = envScope({ MYOS_TOKENLOG_NO_RTK: "1" });
    expect(rtkGainLines()).toBeNull();
  });
});

describe("CLI", () => {
  const TOOL = repoPath("payload/skills/MyTokens/Tools/TokenLog.ts");

  test("report --days 7 prints a report against a fixture store", async () => {
    using projects = tempDir("tokenlog-cli-projects");
    using store = tempDir("tokenlog-cli-store");
    using home = tempHome("tokenlog-cli");
    projects.write("-Users-x-proj/s1.jsonl", lines(userLine("write the flat finder", 60), assistantLine("m1", 1500, 59)));
    const r = await run([bunExe(), TOOL, "report", "--days", "7"], {
      env: { ...home.env(), MYOS_TOKENLOG_PROJECTS: projects.path, MYOS_TOKENLOG_STORE: store.path, MYOS_TOKENLOG_NO_RTK: "1" },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Token consumption, last 7 days");
    expect(r.stdout).toContain("1 session(s)");
    expect(r.stdout).toContain("output 1.5k");
    expect(r.stdout).toContain("claude-fable-5");
    expect(r.stdout).toContain("write the flat finder");
    expect(r.stdout).toContain("myos --resume <id>");
    expect(r.stdout).not.toContain("Local model");
    expect(r.stdout).not.toMatch(/\$\d/);
    expect(JSON.parse(readFileSync(store.join("sessions.json"), "utf8"))).toBeTruthy();
  });

  test("default paths follow CLAUDE_CONFIG_DIR and MYOS_DIR (the store lands under MEMORY/OBSERVABILITY/TOKENS)", async () => {
    using home = tempHome("tokenlog-defaults");
    home.write(".myos/projects/-Users-x-proj/s1.jsonl", lines(userLine("task", 30), assistantLine("m1", 100, 29)));
    const r = await run([bunExe(), TOOL, "sync"], { env: home.env({ MYOS_TOKENLOG_NO_RTK: "1" }) });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("1 session(s) parsed");
    const stored = JSON.parse(readFileSync(home.join(".myos/MYOS/MEMORY/OBSERVABILITY/TOKENS/sessions.json"), "utf8"));
    expect(Object.keys(stored.sessions)).toContain(SID);
  });

  test("an unknown command exits 1 and names the valid ones", async () => {
    using home = tempHome("tokenlog-bad");
    const r = await run([bunExe(), TOOL, "frobnicate"], { env: home.env() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("sync | report");
  });
});
