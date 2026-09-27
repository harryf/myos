/**
 * ISASync mirrors ISA edits into work.json. Both homes from IsaFormat.md are
 * tested with the golden fixtures: a task ISA under MEMORY/WORK/<slug>/ and a
 * project ISA at <project>/ISA.md. A Read only bumps the heartbeat.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { repoPath } from "../harness.ts";
import { events, myosHome, runHook, SESSION_ID } from "./harness.ts";

const HOOK = "payload/hooks/ISASync.hook.ts";
const WORK_JSON = ".myos/MYOS/MEMORY/STATE/work.json";
const CURRENT = readFileSync(repoPath("test/fixtures/isa/current.md"), "utf8");
const LEGACY = readFileSync(repoPath("test/fixtures/isa/legacy.md"), "utf8");
const CURRENT_SLUG = "20260928-090000_report-json-flag";
const LEGACY_SLUG = "20260814-101500_rotate-deploy-credential";

async function registry(home: { join(...p: string[]): string }): Promise<any> {
  return JSON.parse(await Bun.file(home.join(WORK_JSON)).text());
}

describe("task ISA home (MEMORY/WORK/<slug>/ISA.md)", () => {
  test("a Write of the current format fixture lands in work.json with its claims", async () => {
    using home = myosHome("isasync-task");
    const isa = home.write(`.myos/MYOS/MEMORY/WORK/${CURRENT_SLUG}/ISA.md`, CURRENT);
    const result = await runHook(HOOK, { home, stdin: events.postToolUse("Write", { file_path: isa }) });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('{"continue":true}');
    const row = (await registry(home)).sessions[CURRENT_SLUG];
    expect(row.phase).toBe("climbing");
    expect(row.sessionUUID).toBe(SESSION_ID);
    const ids = row.criteria.map((c: any) => c.id);
    expect(ids).toEqual(["C1", "C2", "C3", "A1"]);
    expect(row.criteria.find((c: any) => c.id === "A1").type).toBe("anti-criterion");
  });

  test("the legacy fixture still syncs (parsers read both shapes)", async () => {
    using home = myosHome("isasync-legacy");
    const isa = home.write(`.myos/MYOS/MEMORY/WORK/${LEGACY_SLUG}/ISA.md`, LEGACY);
    await runHook(HOOK, { home, stdin: events.postToolUse("Edit", { file_path: isa }) });
    const row = (await registry(home)).sessions[LEGACY_SLUG];
    expect(row.phase).toBe("complete");
    expect(row.criteria).toHaveLength(6);
  });
});

describe("project ISA home (<project>/ISA.md)", () => {
  test("a project ISA outside MYOS is discovered and keyed by its slug", async () => {
    using home = myosHome("isasync-project");
    const isa = home.write("Code/report-tool/ISA.md", CURRENT);
    await runHook(HOOK, { home, stdin: events.postToolUse("Edit", { file_path: isa }) });
    const row = (await registry(home)).sessions[CURRENT_SLUG];
    expect(row).toBeDefined();
    expect(row.isa).toBe(isa);
  });

  test("a project ISA without a slug is keyed project-<dirname>", async () => {
    using home = myosHome("isasync-project-noslug");
    const isa = home.write("Code/Sarah Flat/ISA.md", CURRENT.replace(/^slug:.*\n/m, ""));
    await runHook(HOOK, { home, stdin: events.postToolUse("Write", { file_path: isa }) });
    expect((await registry(home)).sessions["project-sarah-flat"]).toBeDefined();
  });
});

describe("Read heartbeat", () => {
  test("a Read bumps the slug's activity and never touches the file", async () => {
    using home = myosHome("isasync-read");
    const isa = home.write(`.myos/MYOS/MEMORY/WORK/${CURRENT_SLUG}/ISA.md`, CURRENT);
    await runHook(HOOK, { home, stdin: events.postToolUse("Write", { file_path: isa }) });
    await Bun.sleep(5);
    const result = await runHook(HOOK, { home, stdin: events.postToolUse("Read", { file_path: isa }) });
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(isa).text()).toBe(CURRENT);
    expect((await registry(home)).sessions[CURRENT_SLUG].lastToolActivity).toBeDefined();
  });
});

describe("Anti", () => {
  test("Anti: a file that is not ISA.md is ignored in either home", async () => {
    using home = myosHome("isasync-otherfile");
    const notes = home.write(`.myos/MYOS/MEMORY/WORK/${CURRENT_SLUG}/notes.md`, CURRENT);
    const other = home.write("Code/x/README.md", CURRENT);
    await runHook(HOOK, { home, stdin: events.postToolUse("Write", { file_path: notes }) });
    await runHook(HOOK, { home, stdin: events.postToolUse("Write", { file_path: other }) });
    expect(await Bun.file(home.join(WORK_JSON)).exists()).toBe(false);
  });

  test("Anti: no render tool is spawned (ISARender does not ship)", () => {
    const src = readFileSync(repoPath(HOOK), "utf8");
    expect(src).not.toContain("ISARender");
    expect(src).not.toContain("spawn(");
  });

  test("Anti: unparseable stdin exits 0", async () => {
    using home = myosHome("isasync-badstdin");
    const result = await runHook(HOOK, { home, stdin: "{nope" });
    expect(result.exitCode).toBe(0);
  });
});
