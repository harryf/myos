/**
 * ContextSearch is how a session recovers prior work, so its absence message
 * matters as much as its hits: "no prior work found" has to be distinguishable
 * from "the search silently failed", or a PM re-does work they already have.
 *
 * It resolves everything from `os.homedir()`, which Bun fixes at process start,
 * so every case runs in a subprocess against a scratch HOME.
 */

import { describe, expect, test } from "bun:test";

import { bunExe, parseJsonOutput, repoPath, run, tempHome } from "../../../harness.ts";

const TOOL = "payload/skills/ContextSearch/Tools/ContextSearch.ts";

/** A scratch HOME holding a work registry, an ISA and a session name. */
function workHome(name: string) {
  const home = tempHome(`contextsearch-${name}`);
  const state = ".myos/MYOS/MEMORY/STATE";

  home.write(
    `${state}/work.json`,
    JSON.stringify({
      sessions: {
        "test-suite": {
          slug: "test-suite",
          task: "Build the tool test suite",
          updated: "2026-07-29T10:00:00Z",
          isaPath: home.join(".myos/MYOS/MEMORY/WORK/test-suite/ISA.md"),
        },
        "statusline-fix": {
          slug: "statusline-fix",
          task: "Fix the statusline context percentage",
          updated: "2026-05-01T10:00:00Z",
        },
      },
    }),
  );
  home.write(`${state}/session-names.json`, JSON.stringify({ "sess-1": "the contraband gate rewrite" }));
  home.write(
    ".myos/MYOS/MEMORY/WORK/test-suite/ISA.md",
    "---\ntask: Build the tool test suite\nslug: test-suite\n---\n\n## Criteria\n\n- [ ] ISC-1: every static tool has a test file\n",
  );

  return home;
}

async function search(home: ReturnType<typeof tempHome>, args: string[]) {
  return await run([bunExe(), repoPath(TOOL), ...args, "--json"], { env: home.env() });
}

describe("searching", () => {
  test("finds prior work by topic and reports where each hit came from", async () => {
    using home = workHome("topic");
    const report = parseJsonOutput((await search(home, ["test suite"])).stdout);

    expect(report.results.length).toBeGreaterThan(0);
    expect(JSON.stringify(report.results)).toContain("test-suite");
    expect(report.stats).toMatchObject({ work: expect.any(Number), isa: expect.any(Number) });
  });

  test("searches ISA bodies, not just titles", async () => {
    using home = workHome("isabody");
    const report = parseJsonOutput((await search(home, ["static tool"])).stdout);
    expect(report.results.length).toBeGreaterThan(0);
  });

  test("searches session names", async () => {
    using home = workHome("names");
    const report = parseJsonOutput((await search(home, ["contraband gate"])).stdout);
    expect(JSON.stringify(report.results)).toContain("contraband");
  });

  test("stopwords are dropped, so a natural phrase still matches", async () => {
    using home = workHome("stopwords");
    const report = parseJsonOutput((await search(home, ["what was the test suite about"])).stdout);
    expect(report.tokens).not.toContain("the");
    expect(report.tokens).not.toContain("was");
    expect(report.results.length).toBeGreaterThan(0);
  });

  test("results are deduplicated across the sources they were found in", async () => {
    using home = workHome("dedupe");
    const report = parseJsonOutput((await search(home, ["test suite"])).stdout);
    const slugs = report.results.map((result: any) => result.slug ?? result.id ?? JSON.stringify(result));
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("conversation logs", () => {
  test("transcripts in any project dir under <config>/projects are searched; subagent logs are not", async () => {
    using home = workHome("jsonl");
    const line = (text: string) =>
      JSON.stringify({ type: "user", timestamp: "2026-09-20T10:00:00Z", message: { role: "user", content: text } }) + "\n";
    home.write(".myos/projects/-Users-x-Code-flatfinder/aaaa-1111.jsonl", line("build the zebrafinch flat page"));
    home.write(".myos/projects/-Users-x-Code-other/subagents/agent-1.jsonl", line("zebrafinch in a subagent"));
    const report = parseJsonOutput((await search(home, ["zebrafinch"])).stdout);
    const paths = report.results.map((r: { path?: string }) => r.path ?? "");
    if (Bun.which("rg") === null) return; // rg-backed source: covered by the no-rg test
    expect(paths.some((p: string) => p.endsWith("aaaa-1111.jsonl"))).toBe(true);
    expect(paths.some((p: string) => p.includes("/subagents/"))).toBe(false);
  });
});

describe("filters", () => {
  test("--limit caps the results", async () => {
    using home = workHome("limit");
    const report = parseJsonOutput((await search(home, ["the", "--limit", "1"])).stdout);
    expect(report.results.length).toBeLessThanOrEqual(1);
  });

  test("--since excludes older work", async () => {
    using home = workHome("since");
    const recent = parseJsonOutput((await search(home, ["statusline", "--since", "2026-07-01"])).stdout);
    const all = parseJsonOutput((await search(home, ["statusline"])).stdout);

    expect(recent.since).toBe("2026-07-01T00:00:00.000Z");
    expect(recent.results.length).toBeLessThanOrEqual(all.results.length);
  });

  test("--since=DATE and --limit=N forms are both accepted", async () => {
    using home = workHome("eqforms");
    const report = parseJsonOutput((await search(home, ["test", "--limit=2", "--since=2026-01-01"])).stdout);
    expect(report.results.length).toBeLessThanOrEqual(2);
    expect(report.since).toBe("2026-01-01T00:00:00.000Z");
  });

  test("an unparseable date is ignored rather than filtering everything out", async () => {
    using home = workHome("baddate");
    const report = parseJsonOutput((await search(home, ["test suite", "--since", "not-a-date"])).stdout);
    expect(report.since).toBeNull();
    expect(report.results.length).toBeGreaterThan(0);
  });

  test("a date phrase in the query is understood and stripped from the tokens", async () => {
    using home = workHome("datephrase");
    const report = parseJsonOutput((await search(home, ["test suite yesterday"])).stdout);
    expect(report.cleaned_query).not.toContain("yesterday");
  });
});

describe("absence is stated, never implied", () => {
  test("a query with no hits carries an explicit absence message naming what was searched", async () => {
    using home = workHome("absent");
    const report = parseJsonOutput((await search(home, ["quantum basket weaving"])).stdout);

    expect(report.results).toEqual([]);
    expect(report.absence).toContain("No prior work found");
    expect(report.absence).toContain("work.json");
    expect(report.absence).toContain("conversation logs");
  });

  test("an empty memory tree is an absence, not an error", async () => {
    using home = tempHome("contextsearch-empty");
    const result = await search(home, ["anything"]);
    expect(result.exitCode).toBe(0);
    expect(parseJsonOutput(result.stdout).absence).toContain("No prior work found");
  });

  test("a hit carries no absence message", async () => {
    using home = workHome("nohit-message");
    expect(parseJsonOutput((await search(home, ["test suite"])).stdout).absence).toBeNull();
  });
});

describe("output", () => {
  test("--json emits one line, so a caller can parse it without buffering rules", async () => {
    using home = workHome("jsonline");
    const result = await search(home, ["test suite"]);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
  });

  test("--pretty prints a human report instead of JSON", async () => {
    using home = workHome("pretty");
    const result = await run([bunExe(), repoPath(TOOL), "test suite", "--pretty"], { env: home.env() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toStartWith("{");
  });

  test("--help exits 0 and documents every flag", async () => {
    using home = workHome("help");
    const result = await run([bunExe(), repoPath(TOOL), "--help"], { env: home.env() });
    expect(result.exitCode).toBe(0);
    for (const flag of ["--limit", "--since", "--pretty", "--json"]) {
      expect(result.stdout, `${flag} is undocumented`).toContain(flag);
    }
  });

  test("a machine without rg still searches: the rg-backed sources just come back empty", async () => {
    // Bun.spawn THROWS on a missing executable, and rg is not on CI runners or
    // every PM laptop. One absent binary must not take all five sources down
    // (it did: every ContextSearch test failed on the Linux runner).
    using home = workHome("norg");
    const result = await run([bunExe(), repoPath(TOOL), "test suite", "--json"], {
      env: home.env({ PATH: "/usr/bin:/bin" }),
    });
    expect(result.exitCode).toBe(0);
    const report = parseJsonOutput<any>(result.stdout);
    expect(report.results.length).toBeGreaterThan(0);
  });

  test("a corrupt work.json does not take the whole search down", async () => {
    // work.json is written automatically, so a crash mid-write truncates it: and
    // that is exactly when someone needs context recovery. The other four sources
    // must still answer.
    using home = workHome("corrupt");
    home.write(".myos/MYOS/MEMORY/STATE/work.json", "{not json");

    // Query the session-names source: it answers in pure TS, so this test holds
    // even on machines without rg (where the ISA-body source is empty too).
    const result = await search(home, ["contraband gate"]);
    expect(result.exitCode).toBe(0);

    const report = parseJsonOutput(result.stdout);
    expect(report.stats.work).toBe(0);
    expect(report.results.length).toBeGreaterThan(0);
  });

  test("a corrupt session-names.json is survivable the same way", async () => {
    using home = workHome("corrupt-names");
    home.write(".myos/MYOS/MEMORY/STATE/session-names.json", "{not json");

    const result = await search(home, ["test suite"]);
    expect(result.exitCode).toBe(0);
    expect(parseJsonOutput(result.stdout).results.length).toBeGreaterThan(0);
  });
});

describe("Anti", () => {
  test("Anti: searching never writes: the memory tree is read-only here", async () => {
    using home = workHome("anti");
    const isa = home.join(".myos/MYOS/MEMORY/WORK/test-suite/ISA.md");
    const before = await Bun.file(isa).text();

    await search(home, ["test suite"]);

    expect(await Bun.file(isa).text()).toBe(before);
  });
});
