/**
 * HookHealer repairs the Write-tool exec-bit class: a directly-executed hook
 * script created mode 0644 fails every invocation with "Permission denied"
 * until someone notices. The healing power is also the risk, so the
 * containment properties get the Anti tests: chmod only ever lands inside
 * ~/.myos, and a symlink pointing outside is refused even though it LIVES
 * inside.
 */

import { describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, statSync, symlinkSync } from "node:fs";

import { myosHome, runHook } from "./harness.ts";

const HOOK = "payload/hooks/HookHealer.hook.ts";
const LOG = ".myos/MYOS/MEMORY/OBSERVABILITY/hook-healer.jsonl";

function isExecutable(path: string): boolean {
  return (statSync(path).mode & 0o111) !== 0;
}

/** settings.json registering one direct-exec script (no `bun` prefix). */
function settingsFor(command: string): string {
  return JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command }] }] },
  });
}

describe("SessionStart sweep", () => {
  test("a registered direct-exec script without its exec bit is healed", async () => {
    using home = myosHome("healer-heal", {
      ".myos/settings.json": settingsFor("$HOME/.myos/hooks/My.hook.ts"),
      ".myos/hooks/My.hook.ts": "#!/usr/bin/env bun\nprocess.exit(0);\n",
    });
    chmodSync(home.join(".myos/hooks/My.hook.ts"), 0o644);

    const result = await runHook(HOOK, { home, stdin: {} });

    expect(result.exitCode).toBe(0);
    expect(isExecutable(home.join(".myos/hooks/My.hook.ts"))).toBe(true);
    expect(result.stdout).toContain("🩹 HookHealer");
    expect(result.stdout).toContain("healed (chmod +x)");
  });

  test("scripts run via `bun <path>` are left alone: their exec bit is irrelevant", async () => {
    using home = myosHome("healer-bunprefix", {
      ".myos/settings.json": settingsFor("bun $HOME/.myos/hooks/My.hook.ts"),
      ".myos/hooks/My.hook.ts": "#!/usr/bin/env bun\nprocess.exit(0);\n",
    });
    chmodSync(home.join(".myos/hooks/My.hook.ts"), 0o644);

    const result = await runHook(HOOK, { home, stdin: {} });
    expect(isExecutable(home.join(".myos/hooks/My.hook.ts"))).toBe(false);
    expect(result.stdout).toBe("");
  });

  test("a missing registered script is surfaced, not silently skipped", async () => {
    using home = myosHome("healer-missing", {
      ".myos/settings.json": settingsFor("$HOME/.myos/hooks/Ghost.hook.ts"),
    });
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.stdout).toContain("needs attention");
    expect(result.stdout).toContain("missing: hooks/Ghost.hook.ts");
  });

  test("a script with no shebang is flagged: chmod alone cannot fix it", async () => {
    using home = myosHome("healer-noshebang", {
      ".myos/settings.json": settingsFor("$HOME/.myos/hooks/Bad.hook.sh"),
      ".myos/hooks/Bad.hook.sh": "echo no shebang here\n",
    });
    chmodSync(home.join(".myos/hooks/Bad.hook.sh"), 0o644);
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.stdout).toContain("no shebang");
  });
});

describe("--posttool ingestion guard", () => {
  test("a just-written shebang file under ~/.myos is healed at the ingestion point", async () => {
    using home = myosHome("healer-posttool", {
      ".myos/hooks/New.hook.ts": "#!/usr/bin/env bun\nprocess.exit(0);\n",
    });
    const target = home.join(".myos/hooks/New.hook.ts");
    chmodSync(target, 0o644);

    const result = await runHook(HOOK, {
      home,
      args: ["--posttool"],
      stdin: { tool_name: "Write", tool_input: { file_path: target } },
    });
    expect(result.exitCode).toBe(0);
    expect(isExecutable(target)).toBe(true);
  });

  test("a write OUTSIDE ~/.myos is never touched", async () => {
    using home = myosHome("healer-outside");
    const outside = home.write("elsewhere/script.sh", "#!/bin/bash\necho hi\n");
    chmodSync(outside, 0o644);

    await runHook(HOOK, {
      home,
      args: ["--posttool"],
      stdin: { tool_name: "Write", tool_input: { file_path: outside } },
    });
    expect(isExecutable(outside)).toBe(false);
  });
});

describe("Anti", () => {
  test("Anti: healing changes the mode only; the file bytes are identical", async () => {
    const body = "#!/usr/bin/env bun\n// odd bytes kept: \t tab, trailing space \nprocess.exit(0);\n";
    using home = myosHome("healer-bytes", {
      ".myos/settings.json": settingsFor("$HOME/.myos/hooks/Same.hook.ts"),
      ".myos/hooks/Same.hook.ts": body,
    });
    const target = home.join(".myos/hooks/Same.hook.ts");
    chmodSync(target, 0o644);
    const before = readFileSync(target);
    await runHook(HOOK, { home, stdin: {} });
    expect(isExecutable(target)).toBe(true);
    expect(Buffer.compare(readFileSync(target), before)).toBe(0);
  });

  test("Anti: a registered script under ~/.myos but outside hooks/ is never chmodded", async () => {
    using home = myosHome("healer-outside-hooks", {
      ".myos/settings.json": settingsFor("$HOME/.myos/MYOS/TOOLS/Thing.ts"),
      ".myos/MYOS/TOOLS/Thing.ts": "#!/usr/bin/env bun\nprocess.exit(0);\n",
    });
    const target = home.join(".myos/MYOS/TOOLS/Thing.ts");
    chmodSync(target, 0o644);
    await runHook(HOOK, { home, stdin: {} });
    expect(isExecutable(target)).toBe(false);
  });

  test("Anti: --posttool ignores a shebang file under ~/.myos outside hooks/", async () => {
    using home = myosHome("healer-posttool-outside", {
      ".myos/MYOS/TOOLS/Tool.ts": "#!/usr/bin/env bun\n",
    });
    const target = home.join(".myos/MYOS/TOOLS/Tool.ts");
    chmodSync(target, 0o644);
    await runHook(HOOK, { home, args: ["--posttool"], stdin: { tool_name: "Write", tool_input: { file_path: target } } });
    expect(isExecutable(target)).toBe(false);
  });

  test("Anti: a symlink inside ~/.myos pointing outside is refused (chmod follows symlinks)", async () => {
    using home = myosHome("healer-symlink", {
      ".myos/settings.json": settingsFor("$HOME/.myos/hooks/Link.hook.sh"),
    });
    const outside = home.write("victim.sh", "#!/bin/bash\necho target\n");
    chmodSync(outside, 0o644);
    symlinkSync(outside, home.join(".myos/hooks/Link.hook.sh"));

    const result = await runHook(HOOK, { home, stdin: {} });

    expect(result.exitCode).toBe(0);
    expect(isExecutable(outside)).toBe(false);
    const log = await Bun.file(home.join(LOG)).text();
    expect(log).toContain("containment-refused");
  });

  test("Anti: an unparseable settings.json fails the sweep open, exit 0", async () => {
    using home = myosHome("healer-badsettings", {
      ".myos/settings.json": "{not json",
    });
    const result = await runHook(HOOK, { home, stdin: {} });
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(home.join(LOG)).text()).toContain("settings-parse-failed");
  });
});
