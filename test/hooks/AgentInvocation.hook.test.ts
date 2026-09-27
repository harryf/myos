/**
 * AgentInvocation captures subagent lifecycle at PreToolUse/PostToolUse:Agent
 *: the only place subagent_type and description are reliably present (the
 * native SubagentStart events wrote "unknown" for 5844 of 5846 historical
 * rows). It OBSERVES only: since v1.3.0 it resolves and logs which model a
 * dispatch carries but never mutates tool input, and that Anti property is
 * pinned here.
 */

import { describe, expect, test } from "bun:test";

import { events, myosHome, runHook, SESSION_ID } from "./harness.ts";

const HOOK = "payload/hooks/AgentInvocation.hook.ts";
const EVENTS_FILE = ".myos/MYOS/MEMORY/OBSERVABILITY/subagent-events.jsonl";
const STARTS_FILE = ".myos/MYOS/MEMORY/OBSERVABILITY/agent-starts.json";

const DISPATCH = {
  subagent_type: "Explore",
  description: "map the hooks surface",
  prompt: "Find every hook registration",
};

async function eventRows(home: { join(...p: string[]): string }): Promise<any[]> {
  const file = Bun.file(home.join(EVENTS_FILE));
  if (!(await file.exists())) return [];
  return (await file.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("lifecycle capture", () => {
  test("PreToolUse:Agent writes a start event with the REAL subagent type", async () => {
    using home = myosHome("agentinv-start");
    const result = await runHook(HOOK, { home, stdin: events.preToolUse("Agent", DISPATCH) });
    expect(result.exitCode).toBe(0);

    const [row] = await eventRows(home);
    expect(row.event).toBe("subagent_start");
    expect(row.subagent_type).toBe("Explore");
    expect(row.description).toBe("map the hooks surface");
    expect(row.prompt_preview).toContain("hook registration");

    const starts = JSON.parse(await Bun.file(home.join(STARTS_FILE)).text());
    expect(Object.keys(starts)).toEqual([`${SESSION_ID}::map the hooks surface`]);
  });

  test("PostToolUse:Agent closes the pair with a duration and clears the start record", async () => {
    using home = myosHome("agentinv-stop");
    await runHook(HOOK, { home, stdin: events.preToolUse("Agent", DISPATCH) });
    await runHook(HOOK, { home, stdin: events.postToolUse("Agent", DISPATCH, "done") });

    const all = await eventRows(home);
    expect(all.map((r) => r.event)).toEqual(["subagent_start", "subagent_stop"]);
    expect(all[1].duration_seconds).toBeNumber();
    expect(JSON.parse(await Bun.file(home.join(STARTS_FILE)).text())).toEqual({});
  });

  test("a stop with no matching start still logs, with duration null", async () => {
    using home = myosHome("agentinv-orphan");
    await runHook(HOOK, { home, stdin: events.postToolUse("Agent", DISPATCH, "done") });
    const [row] = await eventRows(home);
    expect(row.event).toBe("subagent_stop");
    expect(row.duration_seconds).toBeNull();
  });
});

describe("dispatch model resolution (observed, never injected)", () => {
  test("an explicit model param is logged as a dispatch choice", async () => {
    using home = myosHome("agentinv-model");
    await runHook(HOOK, {
      home,
      stdin: events.preToolUse("Agent", { ...DISPATCH, model: "haiku" }),
    });
    const [row] = await eventRows(home);
    expect(row.subagent_model).toBe("haiku");
    expect(row.subagent_level).toBe("dispatch");
  });

  test("an agent type with no file and no param inherits (no vendor table)", async () => {
    using home = myosHome("agentinv-crossvendor");
    await runHook(HOOK, {
      home,
      stdin: events.preToolUse("Agent", { ...DISPATCH, subagent_type: "Forge" }),
    });
    const [row] = await eventRows(home);
    expect(row.subagent_model).toBe("inherited");
    expect(row.subagent_level).toBe("session");
  });

  test("a frontmatter model pin in the agent definition is honored", async () => {
    using home = myosHome("agentinv-pin", {
      ".myos/agents/Researcher.md": "---\nname: Researcher\nmodel: sonnet\n---\n\nBody.\n",
    });
    await runHook(HOOK, {
      home,
      stdin: events.preToolUse("Agent", { ...DISPATCH, subagent_type: "Researcher" }),
    });
    const [row] = await eventRows(home);
    expect(row.subagent_model).toBe("sonnet");
    expect(row.subagent_level).toBe("pin");
  });

  test("no model anywhere → the dispatch inherits the session model", async () => {
    using home = myosHome("agentinv-inherit");
    await runHook(HOOK, { home, stdin: events.preToolUse("Agent", DISPATCH) });
    const [row] = await eventRows(home);
    expect(row.subagent_model).toBe("inherited");
    expect(row.subagent_level).toBe("session");
  });
});

describe("Anti", () => {
  test("Anti: non-Agent tools are ignored entirely", async () => {
    using home = myosHome("agentinv-othertool");
    const result = await runHook(HOOK, {
      home,
      stdin: events.preToolUse("Bash", { command: "ls" }),
    });
    expect(result.exitCode).toBe(0);
    expect(await eventRows(home)).toEqual([]);
  });

  test("Anti: empty stdin exits 0 and writes nothing", async () => {
    using home = myosHome("agentinv-empty");
    const result = await runHook(HOOK, { home });
    expect(result.exitCode).toBe(0);
    expect(await eventRows(home)).toEqual([]);
  });
});
