/**
 * Doctor probes this machine, so no test asserts which tools happen to be
 * installed. What is testable is the design contract it states for itself:
 * never install-fatal, network probes opt-in, declined is first-class and
 * permanently silent, and the manifest is tamper-evident.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

import { bunExe, parseJsonOutput, repoPath, run, tempHome } from "../harness.ts";

const TOOL = "payload/MYOS/TOOLS/Doctor.ts";

async function doctor(home: ReturnType<typeof tempHome>, args: string[] = []) {
  return await run([bunExe(), repoPath(TOOL), ...args], { env: home.env() });
}

function manifestPath(home: ReturnType<typeof tempHome>): string {
  return home.join(".myos/MYOS/MEMORY/STATE/capabilities.json");
}

describe("probing", () => {
  test("a default run exits 0: Doctor is never install-fatal", async () => {
    using home = tempHome("doctor-default");
    const result = await doctor(home);
    expect(result.exitCode).toBe(0);
  });

  test("--json reports a capability map, each entry with a state and a probe class", async () => {
    using home = tempHome("doctor-json");
    const report = parseJsonOutput((await doctor(home, ["--json"])).stdout);

    expect(report.version).toBeNumber();
    expect(report.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(report.capabilities).length).toBeGreaterThan(0);

    for (const [name, capability] of Object.entries<any>(report.capabilities)) {
      expect(["live", "broken", "declined", "stale"], `${name} has state ${capability.state}`).toContain(capability.state);
      expect(["offline", "network"], `${name} has probeClass ${capability.probeClass}`).toContain(capability.probeClass);
      expect(capability.ttlHours, `${name} has no TTL`).toBeNumber();
    }
  });

  test("the manifest calls itself advisory, so no reader treats it as truth", async () => {
    using home = tempHome("doctor-advisory");
    const report = parseJsonOutput((await doctor(home, ["--json"])).stdout);
    expect(report.note).toContain("Advisory cache, not truth");
    expect(report.note).toContain("re-verify");
  });

  test("the core toolchain is probed by name", async () => {
    using home = tempHome("doctor-core");
    const report = parseJsonOutput((await doctor(home, ["--json"])).stdout);
    for (const capability of ["bun", "git", "claude"]) {
      expect(Object.keys(report.capabilities), `${capability} is not probed`).toContain(capability);
    }
  });

  test("no scores: the report is a diagnostic register, not a rating", async () => {
    using home = tempHome("doctor-rating");
    const report = parseJsonOutput((await doctor(home, ["--json"])).stdout);
    expect(Object.keys(report)).not.toContain("score");
    for (const [name, capability] of Object.entries<any>(report.capabilities)) {
      expect(Object.keys(capability), `${name} carries a score`).not.toContain("score");
    }
    const human = (await doctor(home)).stdout;
    expect(human).not.toMatch(/\b(health|capability) score\b|\b\d+\s*\/\s*10\b/i);
  });

  test("a broken capability carries a fix command or an explicit null", async () => {
    using home = tempHome("doctor-fix");
    const report = parseJsonOutput((await doctor(home, ["--json"])).stdout);
    for (const [name, capability] of Object.entries<any>(report.capabilities)) {
      expect(capability, `${name} has no fixCmd field`).toHaveProperty("fixCmd");
    }
  });
});

describe("the myos probe list and config health", () => {
  test("probes exactly the toolchain myos uses, and nothing it dropped", async () => {
    using home = tempHome("doctor-list");
    const ids = Object.keys(parseJsonOutput((await doctor(home, ["--json"])).stdout).capabilities);
    for (const id of ["bun", "ripgrep", "git", "jq", "gh", "claude", "rtk", "interceptor", "ffmpeg", "whisper",
      "myos-config", "trial", "settings-hooks", "memory-dirs"]) {
      expect(ids, `${id} is not probed`).toContain(id);
    }
    for (const gone of ["codex", "cloudflare", "voice", "fabric"]) {
      expect(ids, `${gone} is still probed`).not.toContain(gone);
    }
  });

  test("an empty config dir lists every config miss and still exits 0", async () => {
    using home = tempHome("doctor-empty");
    const result = await doctor(home, ["--json"]);
    expect(result.exitCode).toBe(0);
    const caps = parseJsonOutput(result.stdout).capabilities;
    for (const id of ["myos-config", "trial", "settings-hooks", "memory-dirs"]) {
      expect(caps[id].state, id).toBe("broken");
    }
  });

  test("a healthy config dir reads live, and a due review is named", async () => {
    using home = tempHome("doctor-healthy");
    home.write(".myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml", "[principal]\nname = \"Harry\"\n");
    home.write(".myos/MYOS/USER/CONFIG/trial.json", JSON.stringify({
      started: "2026-01-01", gate_review_due: "2026-01-15", doctrine_review_due: "2999-01-31",
      gate_review_done: false, doctrine_review_done: false,
    }));
    home.write(".myos/settings.json", JSON.stringify({ hooks: { Stop: [] } }));
    for (const d of ["WORK", "KNOWLEDGE", "STATE", "OBSERVABILITY/TOKENS"]) home.mkdir(`.myos/MYOS/MEMORY/${d}`);
    const caps = parseJsonOutput((await doctor(home, ["--json"])).stdout).capabilities;
    for (const id of ["myos-config", "trial", "settings-hooks", "memory-dirs"]) {
      expect(caps[id].state, `${id}: ${caps[id].detail}`).toBe("live");
    }
    expect(caps.trial.detail).toContain("REVIEW DUE: gate review due 2026-01-15");
    expect(caps.trial.detail).not.toContain("doctrine review due");
  });

  test("settings.json without a hooks block is a miss", async () => {
    using home = tempHome("doctor-nohooks");
    home.write(".myos/settings.json", "{}");
    const caps = parseJsonOutput((await doctor(home, ["--json"])).stdout).capabilities;
    expect(caps["settings-hooks"].state).toBe("broken");
  });

  test("--help prints usage and writes nothing", async () => {
    using home = tempHome("doctor-help");
    const result = await doctor(home, ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: bun Doctor.ts");
    expect(existsSync(manifestPath(home))).toBe(false);
  });
});

describe("writes only where it may", () => {
  test("with no CLAUDE_CONFIG_DIR, MYOS_DIR or installed tree it probes, prints, and writes nothing", async () => {
    using home = tempHome("doctor-nowrite");
    const result = await run([bunExe(), repoPath(TOOL)], { env: home.env({ CLAUDE_CONFIG_DIR: undefined, MYOS_DIR: undefined }) });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("nothing was written");
    expect(existsSync(home.join(".myos/MYOS"))).toBe(false);
  });

  test("decline refuses (exit 1) rather than pretending when there is nowhere to record it", async () => {
    using home = tempHome("doctor-nowrite-decline");
    const result = await run([bunExe(), repoPath(TOOL), "decline", "ffmpeg"], { env: home.env({ CLAUDE_CONFIG_DIR: undefined, MYOS_DIR: undefined }) });
    expect(result.exitCode).toBe(1);
    expect(existsSync(home.join(".myos/MYOS"))).toBe(false);
  });

  test("read-only subcommands never create state, not even the salt file", async () => {
    using home = tempHome("doctor-readonly");
    for (const args of [["--help"], ["--statusline"], ["--verify"], ["--reconcile"]]) {
      expect((await doctor(home, args)).exitCode, args.join(" ")).toBe(0);
    }
    expect(existsSync(home.join(".myos/MYOS/MEMORY/STATE"))).toBe(false);
  });
});

describe("PROJECTS.md ceiling", () => {
  test("under 6,000 bytes is live, over it is a listed warning, and the run still exits 0", async () => {
    using home = tempHome("doctor-projects");
    home.write(".myos/MYOS/USER/PROJECTS.md", "# Projects\n" + "x".repeat(100));
    let caps = parseJsonOutput((await doctor(home, ["--json"])).stdout).capabilities;
    expect(caps["projects-index"].state).toBe("live");

    home.write(".myos/MYOS/USER/PROJECTS.md", "# Projects\n" + "x".repeat(7000));
    const result = await doctor(home, ["--json"]);
    expect(result.exitCode).toBe(0);
    caps = parseJsonOutput(result.stdout).capabilities;
    expect(caps["projects-index"].state).toBe("broken");
    expect(caps["projects-index"].detail).toContain("over the 6000 byte ceiling");
  });
});

describe("network probes are opt-in", () => {
  test("the default run marks nothing as having been probed over the network", async () => {
    using home = tempHome("doctor-offline");
    const report = parseJsonOutput((await doctor(home, ["--json"])).stdout);
    const networkProbed = Object.entries<any>(report.capabilities).filter(
      ([, capability]) => capability.probeClass === "network" && capability.state === "live",
    );
    // Offline by default: a network capability cannot come back live without a
    // network probe having run.
    expect(networkProbed.map(([name]) => name)).toEqual([]);
  });

  test("--no-network is accepted explicitly and still exits 0", async () => {
    using home = tempHome("doctor-nonetwork");
    expect((await doctor(home, ["--no-network"])).exitCode).toBe(0);
  });
});

describe("declined is first-class", () => {
  test("decline then enable round-trips, and a declined capability reports as declined", async () => {
    using home = tempHome("doctor-decline");
    await doctor(home, ["--json"]);

    const declined = await doctor(home, ["decline", "ffmpeg"]);
    expect(declined.exitCode).toBe(0);
    expect(parseJsonOutput((await doctor(home, ["--json"])).stdout).capabilities.ffmpeg?.state).toBe("declined");

    const enabled = await doctor(home, ["enable", "ffmpeg"]);
    expect(enabled.exitCode).toBe(0);
    expect(parseJsonOutput((await doctor(home, ["--json"])).stdout).capabilities.ffmpeg?.state).not.toBe("declined");
  });

  test("a declined capability is silent in the statusline: opted out is not a defect", async () => {
    using home = tempHome("doctor-decline-silent");
    await doctor(home, ["--json"]);
    await doctor(home, ["decline", "ffmpeg"]);
    const result = await doctor(home, ["--statusline"]);
    expect(result.stdout).not.toContain("ffmpeg");
  });
});

describe("the statusline glyph", () => {
  test("is empty right after an ack, because there is no NEW regression", async () => {
    using home = tempHome("doctor-ack");
    await doctor(home, ["--json"]);
    await doctor(home, ["ack"]);
    const result = await doctor(home, ["--statusline"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});

describe("--verify (tamper evidence)", () => {
  test("a freshly written manifest verifies", async () => {
    using home = tempHome("doctor-verify");
    await doctor(home, ["--json"]);
    expect(existsSync(manifestPath(home))).toBe(true);
    expect((await doctor(home, ["--verify"])).exitCode).toBe(0);
  });

  test("an edited manifest exits 2: this is what makes a model edit visible", async () => {
    using home = tempHome("doctor-tamper");
    await doctor(home, ["--json"]);

    const manifest = JSON.parse(readFileSync(manifestPath(home), "utf8"));
    const first = Object.keys(manifest.capabilities)[0];
    manifest.capabilities[first].state = "live";
    manifest.capabilities[first].detail = "edited by hand";
    writeFileSync(manifestPath(home), JSON.stringify(manifest, null, 2));

    const result = await doctor(home, ["--verify"]);
    expect(result.exitCode).toBe(2);
  });

  test("the integrity secret lives in its own 0600 file, never inside the manifest", async () => {
    using home = tempHome("doctor-secret");
    await doctor(home, ["--json"]);

    const saltFile = home.join(".myos/MYOS/MEMORY/STATE/.capabilities-salt");
    expect(readFileSync(manifestPath(home), "utf8")).not.toContain(readFileSync(saltFile, "utf8").trim());
    expect(existsSync(saltFile)).toBe(true);
    expect(statSync(saltFile).mode & 0o777).toBe(0o600);
  });
});

describe("Anti", () => {
  test("Anti: every probe is bounded: a full run finishes well inside the default test timeout", async () => {
    using home = tempHome("doctor-bounded");
    const result = await doctor(home, ["--json"]);
    expect(result.exitCode).toBe(0);
  });

  test("Anti: no MCP connector is probed over the network: those live claude.ai-side", () => {
    const source = readFileSync(repoPath(TOOL), "utf8");
    for (const connector of ["linear", "notion", "granola"]) {
      const probeCall = new RegExp(`fetch\\([^)]*${connector}`, "i");
      expect(source, `${connector} is network-probed`).not.toMatch(probeCall);
    }
  });
});
