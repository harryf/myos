/**
 * models.ts is the single source of truth for Claude model IDs and the effort
 * level ladder. The failure mode worth a gate: a hand-edit that breaks the
 * two-layer level, tier, ID indirection, or a stray non-Claude route creeping back.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { repoPath } from "../harness.ts";

const models = await import(repoPath("payload/MYOS/TOOLS/models.ts"));

describe("effort levels", () => {
  test("every level maps to a tier, and every tier to a pinned ID", () => {
    for (const level of ["max", "high", "medium", "low"] as const) {
      const tier = models.EFFORT_MODEL[level];
      expect(models.CURRENT[tier], `no pinned ID for tier ${tier}`).toBeString();
      expect(models.ALIAS[tier], `no alias for tier ${tier}`).toBeString();
    }
  });

  test("modelForEffort returns the drift-free alias, pinnedModelForEffort the exact ID", () => {
    expect(models.modelForEffort("high")).toBe(models.ALIAS[models.EFFORT_MODEL.high]);
    expect(models.pinnedModelForEffort("high")).toBe(models.CURRENT[models.EFFORT_MODEL.high]);
    expect(models.modelForEffort("high")).not.toBe(models.pinnedModelForEffort("high"));
  });

  test("max and high are distinct models, so the max→high fallback is a real degraded path", () => {
    expect(models.EFFORT_MODEL.max).not.toBe(models.EFFORT_MODEL.high);
  });

  test("every level has a harness reasoning-effort mapping", () => {
    for (const level of ["max", "high", "medium", "low"] as const) {
      expect(["low", "medium", "high", "xhigh", "max"]).toContain(models.LEVEL_TO_HARNESS_EFFORT[level]);
    }
  });
});

describe("model IDs", () => {
  test("every current ID is shaped like a Claude ID", () => {
    for (const id of models.allCurrentClaudeIds()) {
      expect(id, `${id} does not match CLAUDE_ID_PATTERN`).toMatch(/^claude-(opus|sonnet|haiku|fable)-\d+(-\d+)?(-\d{8})?$/);
    }
  });

  test("CLAUDE_ID_PATTERN matches both the two-part and the dated forms", () => {
    const text = "claude-opus-4-8 claude-sonnet-5 claude-haiku-4-5-20251001 claude-fable-5 gpt-5.6-sol";
    expect(text.match(new RegExp(models.CLAUDE_ID_PATTERN.source, "g"))).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "claude-fable-5",
    ]);
  });

  test("isCurrent tracks CURRENT and rejects a stale ID", () => {
    expect(models.isCurrent(models.CURRENT.sonnet)).toBe(true);
    expect(models.isCurrent("claude-3-opus-20240229")).toBe(false);
  });

  test("currentModel and alias are the tier accessors the rest of the system uses", () => {
    expect(models.currentModel("haiku")).toBe(models.CURRENT.haiku);
    expect(models.alias("haiku")).toBe("haiku");
  });
});

describe("Anti", () => {
  test("Anti: Claude only: no cross-vendor pins, no routing table, no other vendor named", () => {
    for (const gone of ["CROSS_VENDOR", "ROUTES", "maxClassForRoute", "isRouteAllowed"]) {
      expect(models[gone], `${gone} is back`).toBeUndefined();
    }
    const source = readFileSync(repoPath("payload/MYOS/TOOLS/models.ts"), "utf8");
    expect(source).not.toMatch(/codex|perplexity|openai|gpt-/i);
  });

  test("the tier IDs are the current lineup", () => {
    expect(models.CURRENT).toEqual({
      fable: "claude-fable-5-1",
      opus: "claude-opus-5",
      sonnet: "claude-sonnet-5",
      haiku: "claude-haiku-4-5",
    });
  });

  test("Anti: models.ts holds no API key or endpoint (it is a registry, not a client)", () => {
    const source = readFileSync(repoPath("payload/MYOS/TOOLS/models.ts"), "utf8");
    expect(source).not.toMatch(/sk-[a-zA-Z0-9]/);
    expect(source).not.toMatch(/https?:\/\/(?!\S*(?:anthropic\.com|hex\.tech)\b)/);
  });
});
