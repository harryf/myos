/**
 * Doctrine: the always-on text (system prompt, CLAUDE.md) and the doctrine it
 * routes to (Algorithm, RULES). These files are prose, so the tests pin their
 * contract: size ceilings, required phrases, banned coupling, a routing table
 * that only points at real files, and the house style gate.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PAYLOAD, gate, repoPath, runTool } from "../harness";

const SYSTEM_PROMPT = "MYOS/MYOS_SYSTEM_PROMPT.md";
const CLAUDE_MD = "CLAUDE.md";
const ALGORITHM_DIR = "MYOS/ALGORITHM";
const RULES = ["MYOS/RULES/Verification.md", "MYOS/RULES/SelfHealing.md", "MYOS/RULES/Prompting.md"];

const EM_DASH = String.fromCharCode(0x2014);

function payload(rel: string): string {
  return path.join(PAYLOAD, rel);
}
function read(rel: string): string {
  return readFileSync(payload(rel), "utf8");
}

const version = existsSync(payload(`${ALGORITHM_DIR}/LATEST`)) ? read(`${ALGORITHM_DIR}/LATEST`).trim() : "";
const ALGORITHM = `${ALGORITHM_DIR}/v${version}.md`;

/**
 * Routing targets that live in the user owned tree the installer scaffolds or
 * in runtime memory, never in payload/. Documented in CLAUDE.md and PLAN.md 3.9.
 */
const USER_OWNED = new Set([
  "MYOS/USER/PROJECTS.md",
  "MYOS/USER/PROJECTS/<slug>.md",
  "MYOS/USER/CONVENTIONS.md",
  "MYOS/USER/CONFIG/MYOS_CONFIG.toml",
  "MYOS/MEMORY/KNOWLEDGE/",
  "MYOS/MEMORY/WORK/",
]);

/** Routing targets another builder owns and has not landed yet. Delete a line once its file ships. */
const PENDING_FROM_OTHER_BUILDERS = new Set(["hooks/README.md"]);

describe("sizes and placeholders", () => {
  for (const rel of [SYSTEM_PROMPT, CLAUDE_MD]) {
    test(`${rel} is under 6000 bytes`, () => {
      expect(statSync(payload(rel)).size).toBeLessThan(6000);
    });
    test(`${rel} has no unrendered {{ placeholder`, () => {
      expect(read(rel)).not.toContain("{{");
    });
  }
});

describe("the Algorithm", () => {
  test("LATEST names 1.0.0 and the version file exists", () => {
    expect(version).toBe("1.0.0");
    expect(existsSync(payload(ALGORITHM))).toBe(true);
  });

  test("carries no dashboard, terminal, service or speech coupling", () => {
    const body = read(ALGORITHM).toLowerCase();
    for (const banned of ["pulse", "cmux", "kitty", "bunker", "lifeos-ascent-delta", "31337", "voice"]) {
      expect(body, `Algorithm mentions ${banned}`).not.toContain(banned);
    }
  });

  test("states exactly 16 numbered claims, 1 to 16 in order", () => {
    const body = read(ALGORITHM);
    const section = body.split(/^## A run is complete when$/m)[1]?.split(/^## /m)[0] ?? "";
    const numbers = [...section.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  test("names Max as the second look and nothing that needs codex", () => {
    const body = read(ALGORITHM);
    expect(body).toContain("Max");
    expect(body).not.toMatch(/\bForge\b|\bCato\b/);
  });
});

describe("the system prompt", () => {
  const body = read(SYSTEM_PROMPT);
  for (const phrase of ["confidence requires source", "reproduce", "MYOS/ALGORITHM/LATEST", "🗣️ myos:", "════ myos ═══"]) {
    test(`contains "${phrase}"`, () => {
      expect(body.toLowerCase()).toContain(phrase.toLowerCase());
    });
  }

  test("defines the format banner as its first line and the closer as its last in the example", () => {
    const example = body.split("```")[1] ?? "";
    const lines = example.split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]).toStartWith("════ myos ═══");
    expect(lines[lines.length - 1]).toStartWith("🗣️ myos:");
  });
});

describe("CLAUDE.md", () => {
  const body = read(CLAUDE_MD);

  test("imports exactly one file, the projects index", () => {
    const imports = body.split("\n").filter((l) => /^@\S/.test(l));
    expect(imports).toEqual(["@MYOS/USER/PROJECTS.md"]);
  });

  test("every routing table path exists in payload/ or is a documented user file", () => {
    const section = body.split(/^## Where things live.*$/m)[1]?.split(/^## /m)[0] ?? "";
    const rows = section.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("|---") && !l.startsWith("| Need"));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const where = row.split("|")[2] ?? "";
      const paths = [...where.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      expect(paths.length, `row has no path: ${row}`).toBeGreaterThan(0);
      for (const p of paths) {
        if (USER_OWNED.has(p)) continue;
        if (PENDING_FROM_OTHER_BUILDERS.has(p) && !existsSync(payload(p))) {
          gate(`CLAUDE.md routing: ${p}`, false, "owned by another builder, not landed yet");
          continue;
        }
        if (p.includes("<")) {
          const [dir, rest] = p.split(/<[^>]+>\//);
          const hits = readdirSync(payload(dir)).filter((d) => existsSync(payload(path.join(dir, d, rest))));
          expect(hits.length, `no match for ${p}`).toBeGreaterThan(0);
          continue;
        }
        expect(existsSync(payload(p)), `${p} is routed but does not exist`).toBe(true);
      }
    }
  });
});

describe("house style", () => {
  test("StyleCheck --profile prose exits 0 over the doctrine files", async () => {
    const files = [CLAUDE_MD, SYSTEM_PROMPT, ALGORITHM, ...RULES].map(payload);
    const result = await runTool("payload/skills/Writing/Tools/StyleCheck.ts", ["--profile", "prose", ...files]);
    expect(result.exitCode, result.output).toBe(0);
  });

  test("no em dash in any doctrine file or in this test", () => {
    const files = [
      CLAUDE_MD, SYSTEM_PROMPT, ALGORITHM, `${ALGORITHM_DIR}/LATEST`, ...RULES,
      "MYOS/DOCUMENTATION/IsaFormat.md", "MYOS/TOOLS/context-budgets.json",
    ].map(payload);
    files.push(repoPath("test/doctrine/Doctrine.test.ts"));
    for (const f of files) {
      expect(readFileSync(f, "utf8").includes(EM_DASH), `${f} has an em dash`).toBe(false);
    }
  });

  test("Anti: no upstream namespace beyond one provenance line per file", () => {
    for (const rel of [CLAUDE_MD, SYSTEM_PROMPT, ALGORITHM, ...RULES]) {
      const hits = read(rel).split("\n").filter((l) => /pmai|PMAI|LifeOS|\bPAI\b/.test(l));
      expect(hits.length, `${rel}: ${hits.join(" / ")}`).toBeLessThanOrEqual(1);
      if (hits.length === 1) expect(hits[0]).toStartWith("Provenance:");
    }
  });
});
