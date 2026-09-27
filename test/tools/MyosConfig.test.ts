/**
 * MyosConfig is the door between system code and Harry's own values. It is
 * optional by design (a fresh install may have no MYOS_CONFIG.toml), so every
 * fallback has to hold. The switch that matters most is [gates] blocking: a bug
 * that defaults it to true arms every ISA gate during the log-only trial.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { bunExe, envScope, repoPath, run, tempDir, tempHome } from "../harness.ts";

const TOOL = "payload/MYOS/TOOLS/MyosConfig.ts";
const EXAMPLE = "payload/MYOS/TOOLS/MYOS_CONFIG.toml.example";
const mod = await import(repoPath(TOOL));
const { clearMyosConfigCache, loadMyosConfig, myosUserDir } = mod;

const MINIMAL = `
[principal]
name = "Harry"
timezone = "Europe/Zurich"
`;

/** Each load gets a distinct filename: the loader caches on path + mtime. */
let counter = 0;
function configFile(dir: ReturnType<typeof tempDir>, contents: string): string {
  counter += 1;
  clearMyosConfigCache();
  return dir.write(`config-${counter}.toml`, contents);
}

describe("loading", () => {
  test("reads principal, and every path, token and gate setting has a default", () => {
    using dir = tempDir("myosconfig-minimal");
    const config = loadMyosConfig({ path: configFile(dir, MINIMAL), force: true });

    expect(config.principal).toEqual({ name: "Harry", timezone: "Europe/Zurich", pronunciation: undefined });
    expect(config.paths.userDir).toEndWith("/MYOS/USER");
    expect(config.paths.memoryDir).toEndWith("/MYOS/MEMORY");
    expect(config.paths.code).toEndWith("/Code");
    expect(config.tokens.dir).toBe(`${config.paths.memoryDir}/OBSERVABILITY/TOKENS`);
    expect(config.gates).toEqual({ blocking: false, verification: "block" });
  });

  test("exactly four sections: nothing work-profile-era survives", () => {
    using dir = tempDir("myosconfig-shape");
    const config = loadMyosConfig({ path: configFile(dir, MINIMAL), force: true });
    expect(Object.keys(config).sort()).toEqual(["gates", "paths", "principal", "tokens"]);
    expect(mod.isLearningEnabled).toBeUndefined();
  });

  test("accepts snake_case and camelCase path keys", () => {
    using dir = tempDir("myosconfig-keys");
    const snake = loadMyosConfig({
      path: configFile(dir, `${MINIMAL}\n[paths]\nuser_dir = "/a"\nmemory_dir = "/b"\ncode = "/c"\n`),
      force: true,
    });
    expect([snake.paths.userDir, snake.paths.memoryDir, snake.paths.code]).toEqual(["/a", "/b", "/c"]);
    expect(snake.tokens.dir).toBe("/b/OBSERVABILITY/TOKENS");

    const camel = loadMyosConfig({ path: configFile(dir, `${MINIMAL}\n[paths]\nuserDir = "/x"\nmemoryDir = "/y"\n`), force: true });
    expect([camel.paths.userDir, camel.paths.memoryDir]).toEqual(["/x", "/y"]);
  });

  test("a leading ~ is expanded, because node:fs never expands one", () => {
    using dir = tempDir("myosconfig-tilde");
    const config = loadMyosConfig({ path: configFile(dir, `${MINIMAL}\n[paths]\nuser_dir = "~/mine"\n[tokens]\ndir = "~/tok"\n`), force: true });
    expect(config.paths.userDir).not.toStartWith("~");
    expect(config.paths.userDir).toEndWith("/mine");
    expect(config.tokens.dir).toEndWith("/tok");
    expect(config.tokens.dir).not.toStartWith("~");
  });

  test("a ~ that is not a path segment is left alone", () => {
    using dir = tempDir("myosconfig-nottilde");
    const config = loadMyosConfig({ path: configFile(dir, `${MINIMAL}\n[paths]\nuser_dir = "~mine"\n`), force: true });
    expect(config.paths.userDir).toBe("~mine");
  });

  test("defaults follow MYOS_DIR, so a sandbox never resolves to the real home", () => {
    using dir = tempDir("myosconfig-myosdir");
    using _env = envScope({ MYOS_DIR: "/sandbox/.myos/MYOS" });
    const config = loadMyosConfig({ path: configFile(dir, MINIMAL), force: true });
    expect(config.paths.userDir).toBe("/sandbox/.myos/MYOS/USER");
    expect(config.paths.memoryDir).toBe("/sandbox/.myos/MYOS/MEMORY");
  });

  test("caching returns the same object until the file changes", () => {
    using dir = tempDir("myosconfig-cache");
    const path = configFile(dir, MINIMAL);
    const first = loadMyosConfig({ path });
    expect(loadMyosConfig({ path })).toBe(first);
    expect(loadMyosConfig({ path, force: true })).not.toBe(first);
  });
});

describe("[gates]", () => {
  test("blocking is true only when written as the boolean true", () => {
    using dir = tempDir("myosconfig-gates");
    const on = loadMyosConfig({ path: configFile(dir, `${MINIMAL}\n[gates]\nblocking = true\n`), force: true });
    expect(on.gates.blocking).toBe(true);
    const off = loadMyosConfig({ path: configFile(dir, `${MINIMAL}\n[gates]\nblocking = false\n`), force: true });
    expect(off.gates.blocking).toBe(false);
    expect(() => loadMyosConfig({ path: configFile(dir, `${MINIMAL}\n[gates]\nblocking = "yes"\n`), force: true })).toThrow(/blocking must be true or false/);
  });

  test("verification accepts block, log and off, and nothing else", () => {
    using dir = tempDir("myosconfig-verification");
    for (const mode of ["block", "log", "off"]) {
      const config = loadMyosConfig({ path: configFile(dir, `${MINIMAL}\n[gates]\nverification = "${mode}"\n`), force: true });
      expect(config.gates.verification).toBe(mode);
    }
    expect(() => loadMyosConfig({ path: configFile(dir, `${MINIMAL}\n[gates]\nverification = "loud"\n`), force: true })).toThrow(/verification must be/);
  });

  test("the hooks' own parser reads the same key from the shipped example", async () => {
    // hooks/lib/gates.ts reads [gates] blocking without a TOML parser; the
    // example must be shaped so both readers agree it is false.
    using home = tempHome("myosconfig-hooks-agree");
    const file = home.write(".myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml", readFileSync(repoPath(EXAMPLE), "utf8"));
    const result = await run(
      [bunExe(), "-e", `import { configBlocking } from "${repoPath("payload/hooks/lib/gates.ts")}"; console.log(configBlocking())`],
      { env: home.env({ MYOS_CONFIG_FILE: file }) },
    );
    expect(result.stdout.trim()).toBe("false");
  });
});

describe("errors", () => {
  test("an absent config throws with the copy-the-example instruction", () => {
    clearMyosConfigCache();
    expect(() => loadMyosConfig({ path: "/nonexistent/MYOS_CONFIG.toml", force: true })).toThrow(/config file not found/);
    expect(() => loadMyosConfig({ path: "/nonexistent/MYOS_CONFIG.toml", force: true })).toThrow(/MYOS_CONFIG_PATH/);
  });

  test("a missing name or timezone is an error, not a silent empty identity", () => {
    using dir = tempDir("myosconfig-invalid");
    expect(() => loadMyosConfig({ path: configFile(dir, `[principal]\ntimezone = "UTC"\n`), force: true })).toThrow(/requires a non-empty name/);
    expect(() => loadMyosConfig({ path: configFile(dir, `[principal]\nname = "Harry"\n`), force: true })).toThrow(/requires a non-empty timezone/);
    expect(() => loadMyosConfig({ path: configFile(dir, `[principal]\nname = ""\ntimezone = "UTC"\n`), force: true })).toThrow(/non-empty name/);
  });
});

describe("myosUserDir", () => {
  test("falls back to the conventional location when no config exists", () => {
    clearMyosConfigCache();
    using _env = envScope({ MYOS_CONFIG_PATH: "/nonexistent/MYOS_CONFIG.toml", MYOS_DIR: undefined });
    expect(myosUserDir()).toEndWith("/MYOS/USER");
  });
});

describe("the shipped example config", () => {
  // require() only parses a path ending in .toml, so the example is copied to
  // that name first, exactly as install.sh does.
  function exampleAsToml(dir: ReturnType<typeof tempDir>): string {
    return configFile(dir, readFileSync(repoPath(EXAMPLE), "utf8"));
  }

  test("loads as Harry in Zurich with gates log only", () => {
    using dir = tempDir("myosconfig-example");
    const config = loadMyosConfig({ path: exampleAsToml(dir), force: true });
    expect(config.principal.name).toBe("Harry");
    expect(config.principal.timezone).toBe("Europe/Zurich");
    expect(config.gates.blocking).toBe(false);
    expect(config.paths.code).toEndWith("/Code");
  });

  test("says in a comment that the hooks read [gates] blocking", () => {
    const text = readFileSync(repoPath(EXAMPLE), "utf8");
    const gates = text.slice(text.indexOf("[gates]"));
    expect(gates).toContain("hooks read this");
    expect(gates).toMatch(/^blocking = false$/m);
  });

  test("contains no real credential value and no leftover work-profile section", () => {
    const text = readFileSync(repoPath(EXAMPLE), "utf8");
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{10}/);
    expect(text).not.toMatch(/\[(learning|design_system|codebase|local_model|linear|integrations)/);
  });
});

describe("CLI", () => {
  test("prints the resolved config as JSON", async () => {
    using home = tempHome("myosconfig-cli");
    const configPath = home.write(".myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml", MINIMAL);
    const result = await run([bunExe(), repoPath(TOOL)], { env: home.env({ MYOS_CONFIG_PATH: configPath }) });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).principal.name).toBe("Harry");
  });

  test("finds the config in the sandbox config dir with no override", async () => {
    using home = tempHome("myosconfig-cli-default");
    home.write(".myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml", MINIMAL);
    const result = await run([bunExe(), repoPath(TOOL)], { env: home.env() });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).paths.userDir).toBe(home.join(".myos/MYOS/USER"));
  });

  test("exits 1 with the reason when the config is absent", async () => {
    using home = tempHome("myosconfig-cli-absent");
    const result = await run([bunExe(), repoPath(TOOL)], { env: home.env({ MYOS_CONFIG_PATH: home.join("nope.toml") }) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("config file not found");
  });

  test("reads MYOS_CONFIG_PATH in preference to the default location", async () => {
    using home = tempHome("myosconfig-cli-env");
    home.write(".myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml", `[principal]\nname = "Default"\ntimezone = "UTC"\n`);
    const override = home.write("elsewhere.toml", `[principal]\nname = "Override"\ntimezone = "UTC"\n`);
    const result = await run([bunExe(), repoPath(TOOL)], { env: home.env({ MYOS_CONFIG_PATH: override }) });
    expect(JSON.parse(result.stdout).principal.name).toBe("Override");
  });
});
