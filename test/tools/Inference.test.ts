/**
 * Inference.ts is the model gateway, so nothing here spawns `claude` (doctrine
 * rule 8: a test must never invoke a billed model). What is testable is the part
 * that decides truthfulness: level validation, and verifyExecutedModel, which is
 * the primitive behind "the system reports what RAN, never what it requested".
 *
 * That function has two real-world traps encoded in it, and both get a test: the
 * background haiku pass that shares the response envelope, and a mid-run fallback
 * that leaves two models in the envelope at once.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";

import { bunExe, repoPath, run, tempHome } from "../harness.ts";

const TOOL = "payload/MYOS/TOOLS/Inference.ts";
const { extractEnvelope, normalizeLevel, resolveClaudeBin, verifyExecutedModel, advisorPrompt, ADVISOR_TIMEOUT_MS } = await import(repoPath(TOOL));

describe("normalizeLevel", () => {
  test("accepts the four canonical levels", () => {
    for (const level of ["low", "medium", "high", "max"]) {
      expect(normalizeLevel(level)).toBe(level);
    }
  });

  test("defaults to medium when nothing is given", () => {
    expect(normalizeLevel(undefined)).toBe("medium");
    expect(normalizeLevel("")).toBe("medium");
  });

  test("throws on the removed legacy names rather than picking a model silently", () => {
    // fast/standard/smart were removed the day they were aliased. A silent
    // fallback here would run the wrong model for every legacy caller.
    for (const legacy of ["fast", "standard", "smart"]) {
      expect(() => normalizeLevel(legacy)).toThrow(/unknown level/);
    }
  });

  test("the error names the four valid levels, so the fix is in the message", () => {
    expect(() => normalizeLevel("turbo")).toThrow(/low \| medium \| high \| max/);
  });
});

describe("verifyExecutedModel", () => {
  test("reports the model with the most output tokens as the author", () => {
    const usage = {
      "claude-fable-5": { inputTokens: 179, outputTokens: 13 },
      "claude-haiku-4-5-20251001": { inputTokens: 528, outputTokens: 11 },
    };
    expect(verifyExecutedModel(usage, "fable")).toEqual({ executed: "claude-fable-5", downgraded: false });
  });

  test("filters the background haiku pass even when it carries more tokens overall", () => {
    // The title/summary pass shares the envelope and can out-token a short
    // answer, so token totals alone would name haiku as the author.
    const usage = {
      "claude-haiku-4-5-20251001": { inputTokens: 5280, outputTokens: 9 },
      "claude-opus-4-8": { inputTokens: 179, outputTokens: 13 },
    };
    expect(verifyExecutedModel(usage, "opus").executed).toBe("claude-opus-4-8");
  });

  test("haiku is kept when haiku is what was asked for", () => {
    const usage = { "claude-haiku-4-5-20251001": { inputTokens: 100, outputTokens: 50 } };
    expect(verifyExecutedModel(usage, "haiku")).toEqual({ executed: "claude-haiku-4-5-20251001", downgraded: false });
  });

  test("a haiku-only envelope for a higher tier is reported as a downgrade, not as unknown", () => {
    const usage = { "claude-haiku-4-5-20251001": { inputTokens: 100, outputTokens: 50 } };
    expect(verifyExecutedModel(usage, "fable")).toEqual({ executed: "claude-haiku-4-5-20251001", downgraded: true });
  });

  test("a mid-run fallback names the model that actually authored the answer", () => {
    // A small fable classifier pass plus an opus answer leaves both in the
    // envelope. Presence alone would claim fable ran; output picks the author.
    const usage = {
      "claude-fable-5": { inputTokens: 40, outputTokens: 2 },
      "claude-opus-4-8": { inputTokens: 900, outputTokens: 400 },
    };
    expect(verifyExecutedModel(usage, "fable")).toEqual({ executed: "claude-opus-4-8", downgraded: true });
  });

  test("an absent or empty modelUsage returns nothing rather than guessing", () => {
    expect(verifyExecutedModel(undefined, "opus")).toEqual({});
    expect(verifyExecutedModel(null, "opus")).toEqual({});
    expect(verifyExecutedModel({}, "opus")).toEqual({});
    expect(verifyExecutedModel("not an object", "opus")).toEqual({});
  });

  test("a malformed usage entry counts as zero output rather than throwing", () => {
    const usage = { "claude-opus-4-8": {}, "claude-sonnet-5": { outputTokens: 5 } };
    expect(verifyExecutedModel(usage, "sonnet").executed).toBe("claude-sonnet-5");
  });
});

describe("resolveClaudeBin", () => {
  test("returns a path or the bare name, never an empty string", () => {
    const resolved = resolveClaudeBin();
    expect(resolved).toBeString();
    expect(resolved.length).toBeGreaterThan(0);
  });
});

describe("CLI argument handling", () => {
  test("an unknown level is refused before any model is contacted", async () => {
    using home = tempHome("inference-badlevel");
    const result = await run([bunExe(), repoPath(TOOL), "--level", "turbo", "sys", "user"], { env: home.env() });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Invalid level: turbo");
    expect(result.output).toContain("Legacy fast/standard/smart were removed");
  });

  test("too few positional prompts prints usage and exits 1 rather than calling a model", async () => {
    using home = tempHome("inference-noprompt");
    const result = await run([bunExe(), repoPath(TOOL)], { env: home.env() });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: bun Inference.ts");
  });
});

describe("advisor mode", () => {
  test("the prompt carries task, state and question in that order", () => {
    const prompt: string = advisorPrompt({ task: "ship v1", state: "tests green", question: "gaps?" });
    expect(prompt.indexOf("TASK: ship v1")).toBeLessThan(prompt.indexOf("tests green"));
    expect(prompt.indexOf("tests green")).toBeLessThan(prompt.indexOf("QUESTION: gaps?"));
    expect(prompt.trimEnd().endsWith("Advisory response:")).toBe(true);
  });

  test("the default timeout is long enough for a real second look", () => {
    expect(ADVISOR_TIMEOUT_MS).toBeGreaterThanOrEqual(420000);
  });

  test("an unknown mode is refused before any model is contacted", async () => {
    using home = tempHome("inference-badmode");
    const result = await run([bunExe(), repoPath(TOOL), "--mode", "oracle", "a", "b"], { env: home.env() });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid mode: oracle");
  });

  test("advisor mode wants three positional args and says so", async () => {
    using home = tempHome("inference-advisor-usage");
    const result = await run([bunExe(), repoPath(TOOL), "--mode", "advisor", "task", "question"], { env: home.env() });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--mode advisor");
    expect(result.stderr).toContain("<task> <state> <question>");
  });

  test("advisor mode runs the high tier through a stub claude, with API keys scrubbed", async () => {
    using home = tempHome("inference-advisor-stub");
    const bin = home.mkdir("stubbin");
    const log = home.join("claude-args.txt");
    home.write("stubbin/claude", [
      "#!/bin/bash",
      `printf "%s\\n" "$@" > "${log}"`,
      `echo "API_KEY=${"$"}{ANTHROPIC_API_KEY:-unset}" >> "${log}"`,
      "cat > /dev/null",
      'echo \x27{"result":"sound plan","modelUsage":{"claude-opus-5":{"outputTokens":7}}}\x27',
    ].join("\n"));
    fs.chmodSync(home.join("stubbin/claude"), 0o755);
    const result = await run(
      [bunExe(), repoPath(TOOL), "--mode", "advisor", "ship v1", "tests green", "gaps?"],
      // set after the harness scrub, so the tool itself has to remove it
      { env: { ...home.env({ PATH: `${bin}:/usr/bin:/bin` }), ANTHROPIC_API_KEY: "sk-test-not-real" } },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("sound plan");
    const args = fs.readFileSync(log, "utf8");
    expect(args).toContain("--model\nopus\n");
    expect(args).toContain("advisor model invoked at a commitment boundary");
    expect(args).toContain("API_KEY=unset");
  });
});

describe("Anti", () => {
  test("Anti: the level table names no model id: models.ts is the single edit point", () => {
    const source = readFileSync(repoPath(TOOL), "utf8");
    const body = source.slice(source.indexOf("const LEVEL_CONFIG"), source.indexOf("verifyExecutedModel"));
    expect(body).not.toMatch(/["']claude-(opus|sonnet|haiku|fable)-/);
  });

  test("Anti: every API-key path is scrubbed from the spawned env, so work stays on the subscription", () => {
    // Anthropic's precedence chain puts ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN
    // above the OAuth token, and bun auto-loads ~/.myos/.env into children: so
    // either variable present in env silently moves subscription work onto
    // API-key billing. BASE_URL matters too: a local proxy would still be
    // targeted after credentials are dropped, failing auth until timeout.
    const source = readFileSync(repoPath(TOOL), "utf8");
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
      expect(source, `${key} is not scrubbed before spawn`).toContain(`delete env.${key}`);
    }
    // and it is never READ, only deleted
    expect(source).not.toMatch(/process\.env\.ANTHROPIC_(API_KEY|AUTH_TOKEN)/);
  });
});

/**
 * extractEnvelope exists because the CLI's stdout stopped being pure JSON:
 * builds since ~Aug 2026 append diagnostic lines after the result envelope
 * (observed live 2026-08-20: "Client.listTools() called but server does not
 * advertise tools capability - returning empty list"), which made a bare
 * JSON.parse of the stream fail on calls that succeeded and were billed.
 */
describe("extractEnvelope", () => {
  const envelope = { type: "result", subtype: "success", result: "ok", modelUsage: { "claude-sonnet-5": { outputTokens: 4 } } };
  const json = JSON.stringify(envelope);

  test("parses a clean envelope (the common case)", () => {
    expect(extractEnvelope(json)).toEqual(envelope);
    expect(extractEnvelope(`  ${json}\n`)).toEqual(envelope);
  });

  test("survives a trailing diagnostic line (the live 2026-08-20 failure)", () => {
    const polluted = `${json}\nClient.listTools() called but server does not advertise tools capability - returning empty list`;
    expect(extractEnvelope(polluted)).toEqual(envelope);
  });

  test("survives leading noise and multiple stray lines", () => {
    const polluted = `warming up\n${json}\nClient.listTools() called\nbye`;
    expect(extractEnvelope(polluted)).toEqual(envelope);
  });

  test("prefers the last parseable JSON line (result envelope is emitted last)", () => {
    const polluted = `{"type":"noise"}\n${json}`;
    expect(extractEnvelope(polluted)).toEqual(envelope);
  });

  test("returns undefined for empty or unparseable streams", () => {
    expect(extractEnvelope("")).toBeUndefined();
    expect(extractEnvelope("   \n  ")).toBeUndefined();
    expect(extractEnvelope("Unknown command: /foo")).toBeUndefined();
    expect(extractEnvelope("{not json at all")).toBeUndefined();
  });
});
