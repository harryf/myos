/**
 * CheckpointPerISC turns every ISC `[ ]`→`[x]` transition into one git commit
 * per opted-in repo. The properties that keep it safe are the tests: no
 * allowlist means no commits (opt-in is the whole design), the sidecar state
 * makes re-fires idempotent, and the commit subject carries the ISC id so the
 * history reads as a checkpoint trail.
 *
 * Requires git (a core dependency); commits land in a scratch repo inside the
 * sandbox HOME, never anywhere real.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

import { gate, haveBin, type TempDir } from "../harness.ts";
import { events, myosHome, runHook } from "./harness.ts";

const HOOK = "payload/hooks/CheckpointPerISC.hook.ts";
const SLUG = "20260730-090000_checkpointed-work";
const skipNoGit = gate("CheckpointPerISC", haveBin("git"), "git not on PATH: checkpoint commits untestable");

const GIT_ENV = {
  GIT_AUTHOR_NAME: "myos-test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "myos-test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...GIT_ENV },
    stdio: ["ignore", "pipe", "pipe"], // keep expected-failure stderr out of the test log
  });
}

/** Add an allowlisted scratch repo (one uncommitted file) + an ISA to `home`. */
function scaffold(home: TempDir, opts: { allowlist?: boolean; checked?: boolean } = {}) {
  const repo = home.mkdir("scratch-repo");
  execFileSync("git", ["init", "-q", repo]);
  home.write("scratch-repo/change.txt", "uncommitted work\n");

  if (opts.allowlist !== false) home.write(".myos/checkpoint-repos.txt", `# opted in\n${repo}\n`);

  const box = opts.checked === false ? " " : "x";
  const isaPath = home.write(
    `.myos/MYOS/MEMORY/WORK/${SLUG}/ISA.md`,
    [
      "---",
      `slug: ${SLUG}`,
      "title: Checkpointed work",
      "phase: build",
      "---",
      "",
      "## ISC Criteria",
      "",
      `- [${box}] ISC-1: Build the widget end to end`,
      "- [ ] ISC-2: Not done yet",
      "",
    ].join("\n"),
  );
  return { repo, isaPath };
}

function editEvent(isaPath: string) {
  return events.postToolUse("Edit", { file_path: isaPath });
}

describe.skipIf(skipNoGit)("checkpointing", () => {
  test("a newly-checked ISC commits the dirty allowlisted repo with the ISC id in the subject", async () => {
    using home = myosHome("checkpoint-commit");
    const { repo, isaPath } = scaffold(home);

    const result = await runHook(HOOK, { home, stdin: editEvent(isaPath), env: GIT_ENV });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('{"continue":true}');

    const subject = git(repo, "log", "-1", "--format=%s").trim();
    expect(subject).toBe(`ISC-1 (${SLUG}): Build the widget end to end`);
    expect(git(repo, "status", "--porcelain").trim()).toBe("");

    const state = JSON.parse(
      await Bun.file(home.join(`.myos/MYOS/MEMORY/WORK/${SLUG}/.checkpoint-state.json`)).text(),
    );
    expect(state.committed_iscs).toEqual(["ISC-1"]);
  });

  test("a second edit of the same checked ISC commits nothing: the sidecar makes it idempotent", async () => {
    using home = myosHome("checkpoint-idempotent");
    const { repo, isaPath } = scaffold(home);

    await runHook(HOOK, { home, stdin: editEvent(isaPath), env: GIT_ENV });
    home.write("scratch-repo/more.txt", "new dirt\n");
    await runHook(HOOK, { home, stdin: editEvent(isaPath), env: GIT_ENV });

    expect(git(repo, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });

  test("an unchecked ISC commits nothing", async () => {
    using home = myosHome("checkpoint-unchecked");
    const { repo, isaPath } = scaffold(home, { checked: false });

    await runHook(HOOK, { home, stdin: editEvent(isaPath), env: GIT_ENV });
    expect(() => git(repo, "rev-parse", "HEAD")).toThrow(); // no commits at all
  });
});

describe.skipIf(skipNoGit)("Anti", () => {
  test("Anti: no allowlist, no commits: opt-in is the design", async () => {
    using home = myosHome("checkpoint-noallowlist");
    const { repo, isaPath } = scaffold(home, { allowlist: false });

    const result = await runHook(HOOK, { home, stdin: editEvent(isaPath), env: GIT_ENV });
    expect(result.stderr).toContain("no repos configured");
    expect(() => git(repo, "rev-parse", "HEAD")).toThrow();
  });

  test("Anti: an allowlisted path that is not a git repo is reported, never initialized", async () => {
    using home = myosHome("checkpoint-notrepo");
    const notRepo = home.mkdir("plain-dir");
    home.write("plain-dir/file.txt", "hi\n");
    home.write(".myos/checkpoint-repos.txt", `${notRepo}\n`);
    const isaPath = home.write(
      `.myos/MYOS/MEMORY/WORK/${SLUG}/ISA.md`,
      `---\nslug: ${SLUG}\n---\n\n## ISC Criteria\n\n- [x] ISC-1: done thing here\n`,
    );

    const result = await runHook(HOOK, { home, stdin: editEvent(isaPath), env: GIT_ENV });
    expect(result.stderr).toContain("not a git repo");
    expect(await Bun.file(home.join("plain-dir/.git/config")).exists()).toBe(false);
  });

  test("Anti: unparseable stdin exits 0", async () => {
    using home = myosHome("checkpoint-badstdin");
    const result = await runHook(HOOK, { home, stdin: "{nope" });
    expect(result.exitCode).toBe(0);
  });
});
