/**
 * The contraband gate exists because label-based exclusion failed twice: voice
 * survived inside a kept hook, and Forge docs pointed at a Pulse streamer. So the
 * gate itself has to be watched failing, not just watched passing.
 *
 * It resolves its scan root from its own location (`new URL("..", import.meta.url)`),
 * so a fixture run means copying the script into a fake repo laid out the same way.
 * That exercises the real walker, the real deny list, and the real exit codes.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { bunExe, repoPath, run, tempDir } from "../harness.ts";

const TOOL = "Tools/ContrabandCheck.ts";
const SOURCE = readFileSync(repoPath(TOOL), "utf8");

/** Every signature the gate blocks, with a file it is plausible to hide in. */
const BANNED_SIGNATURES: Array<[string, string]> = [
  ["localhost:31337", "payload/hooks/Notify.hook.ts"],
  ["127.0.0.1:31337", "payload/hooks/Notify.hook.ts"],
  ["voice_enabled", "payload/hooks/Notify.hook.ts"],
  ["VoiceNotification", "payload/skills/Interceptor/SKILL.md"],
  ["VoiceCompletion", "payload/settings.template.json"],
  ["elevenlabs", "payload/skills/Remotion/SKILL.md"],
  ["ntfy", "payload/hooks/Stop.hook.ts"],
  ["display notification", "payload/skills/Scheduler/Tools/Scheduler.ts"],
  ["PULSE.toml", "payload/CLAUDE.md"],
  ["MYOS/PULSE", "payload/agents/Max.md"],
  ["Bun.serve(", "payload/MYOS/TOOLS/Server.ts"],
  [".listen(", "payload/skills/S/Tools/Serve.ts"],
  ["launchctl load", "install.sh"],
  ["/tmp/pai-", "payload/MYOS/TOOLS/State.ts"],
  ["com.lifeos.", "payload/skills/Scheduler/SKILL.md"],
  ["TELOS", "payload/MYOS/ALGORITHM/v1.0.0.md"],
  ["kitty @", "payload/hooks/Tab.hook.ts"],
  ["telegram", "payload/commands/notify.md"],
];

/** A fake repo shaped like this one, with the gate copied into Tools/. */
function fixtureRepo(name: string, files: Record<string, string> = {}) {
  const dir = tempDir(`contraband-${name}`, {
    "Tools/ContrabandCheck.ts": SOURCE,
    "payload/CLAUDE.md": "# clean\n",
    "payload/hooks/Clean.hook.ts": "// clean\n",
    "payload/skills/Writing/SKILL.md": "# clean\n",
    ...files,
  });
  return dir;
}

function runFixture(dir: { path: string }) {
  return run([bunExe(), `${dir.path}/Tools/ContrabandCheck.ts`], { cwd: dir.path });
}

describe("passing", () => {
  test("a clean shippable surface exits 0", async () => {
    using dir = fixtureRepo("clean");
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("shippable surface clean");
  });

  test("the real repo passes (the same command the release runs)", async () => {
    const result = await run([bunExe(), repoPath(TOOL)]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("shippable surface clean");
  });
});

describe("blocking", () => {
  test.each(BANNED_SIGNATURES)("blocks %s hidden in %s", async (signature, where) => {
    using dir = fixtureRepo(`hit-${signature.replace(/[^a-z0-9]/gi, "")}`, {
      [where]: `line one\nsomething ${signature} something\n`,
    });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CONTRABAND");
    expect(result.stderr).toContain(signature);
    expect(result.stderr).toContain("Release blocked");
  });

  test("reports the file and the 1-based line number", async () => {
    using dir = fixtureRepo("lineno", {
      "payload/hooks/Notify.hook.ts": "one\ntwo\nconst u = 'ntfy.sh';\n",
    });
    const result = await runFixture(dir);
    expect(result.stderr).toContain("payload/hooks/Notify.hook.ts:3");
  });

  test("counts every hit rather than stopping at the first", async () => {
    using dir = fixtureRepo("multi", {
      "payload/hooks/A.hook.ts": "ntfy.sh\nvoice_enabled\n",
      "payload/CLAUDE.md": "PULSE.toml\n",
    });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("3 contraband hit(s)");
  });
});

describe("scope", () => {
  test("DOCUMENTATION and RULES are excluded: they describe LifeOS features myos does not ship", async () => {
    using dir = fixtureRepo("docs-excluded", {
      "payload/MYOS/DOCUMENTATION/History.md": "LifeOS posted to ntfy.sh and localhost:31337.\n",
      "payload/MYOS/RULES/Legacy.md": "voice_enabled was a LifeOS setting.\n",
    });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
  });

  test("every executing or instructing area is in scope", async () => {
    const areas = [
      "payload/hooks/X.hook.ts",
      "payload/skills/S/SKILL.md",
      "payload/agents/A.md",
      "payload/commands/c.md",
      "payload/MYOS/TOOLS/T.ts",
      "payload/MYOS/USER/CONVENTIONS.md",
      "payload/CLAUDE.md",
      "payload/MYOS/MYOS_SYSTEM_PROMPT.md",
      "payload/MYOS/statusline.ts",
      "payload/MYOS/ALGORITHM/v1.md",
      "payload/settings.template.json",
      "bin/myos",
      "install.sh",
    ];
    for (const area of areas) {
      using dir = fixtureRepo(`scope-${area.replace(/[^a-z0-9]/gi, "")}`, { [area]: "ntfy.sh\n" });
      const result = await runFixture(dir);
      expect(result.exitCode, `${area} is not scanned`).toBe(1);
    }
  });

  test("node_modules and .git are skipped", async () => {
    using dir = fixtureRepo("skipped-dirs", {
      "payload/skills/S/node_modules/dep/index.js": "ntfy.sh\n",
      "payload/skills/S/.git/config": "ntfy.sh\n",
    });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
  });

  test("a binary-ish extension outside the text list is not scanned", async () => {
    using dir = fixtureRepo("nontext", { "payload/skills/S/asset.png": "ntfy.sh\n" });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
  });

  test("an absent scan root is skipped, not a crash", async () => {
    using dir = tempDir("contraband-bare", { "Tools/ContrabandCheck.ts": SOURCE });
    const result = await runFixture(dir);
    expect(result.exitCode).toBe(0);
  });
});

describe("the deny list itself", () => {
  test("every signature in the source is covered by a test case above", () => {
    const declared = [...SOURCE.matchAll(/^\s*\["([^"]+)",\s*"/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(BANNED_SIGNATURES.map(([s]) => s))).toEqual(new Set(declared));
  });
});
