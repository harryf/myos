/**
 * PublicPushGate: a push to a PUBLIC GitHub repo must pass a deny scan of
 * HEAD and history. Visibility comes from a stub `gh` on a sparse PATH; the
 * repo is a scratch git repo inside the sandbox HOME.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

import { gate, haveBin } from "../harness.ts";
import { events, myosHome, runHook, sparsePath } from "./harness.ts";

const HOOK = "payload/hooks/PublicPushGate.hook.ts";
const skipNoGit = gate("PublicPushGate", haveBin("git"), "git not installed");
// Assembled at runtime so no secret-shaped literal sits in this file.
const FAKE_KEY = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");

function repo(home: ReturnType<typeof myosHome>, secret: boolean): string {
  const dir = home.join("Code/site");
  home.write("Code/site/index.html", secret ? `key = ${FAKE_KEY}\n` : "<h1>hello</h1>\n");
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: { ...process.env, HOME: home.join("."), GIT_CONFIG_NOSYSTEM: "1" }, stdio: "pipe" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  git("remote", "add", "origin", "https://github.com/harryf/site.git");
  return dir;
}

const push = (dir: string) => events.preToolUse("Bash", { command: "git push origin main" }, { cwd: dir });

describe.skipIf(skipNoGit)("PublicPushGate", () => {
  test("public repo with a secret in HEAD: blocked, exit 2", async () => {
    using home = myosHome("push-public-secret");
    const dir = repo(home, true);
    using bin = sparsePath({ link: ["git"], stub: { gh: "echo PUBLIC" } });
    const r = await runHook(HOOK, { home, stdin: push(dir), env: { PATH: bin.path } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("PublicPushGate");
  });

  test("public repo with clean content: allowed", async () => {
    using home = myosHome("push-public-clean");
    const dir = repo(home, false);
    using bin = sparsePath({ link: ["git"], stub: { gh: "echo PUBLIC" } });
    const r = await runHook(HOOK, { home, stdin: push(dir), env: { PATH: bin.path } });
    expect(r.exitCode).toBe(0);
  });

  test("private repo with a secret: allowed (not this gate's business)", async () => {
    using home = myosHome("push-private");
    const dir = repo(home, true);
    using bin = sparsePath({ link: ["git"], stub: { gh: "echo PRIVATE" } });
    const r = await runHook(HOOK, { home, stdin: push(dir), env: { PATH: bin.path } });
    expect(r.exitCode).toBe(0);
  });

  test("gh absent: fails open even with a secret", async () => {
    using home = myosHome("push-nogh");
    const dir = repo(home, true);
    using bin = sparsePath({ link: ["git"] });
    const r = await runHook(HOOK, { home, stdin: push(dir), env: { PATH: bin.path } });
    expect(r.exitCode).toBe(0);
  });

  test("MYOS_PUSHGATE=off skips the gate; MYOS_GATES does not", async () => {
    using home = myosHome("push-off");
    const dir = repo(home, true);
    using bin = sparsePath({ link: ["git"], stub: { gh: "echo PUBLIC" } });
    const off = await runHook(HOOK, { home, stdin: push(dir), env: { PATH: bin.path, MYOS_PUSHGATE: "off" } });
    expect(off.exitCode).toBe(0);
    const gatesOff = await runHook(HOOK, { home, stdin: push(dir), env: { PATH: bin.path, MYOS_GATES: "off" } });
    expect(gatesOff.exitCode).toBe(2);
  });

  test("Anti: a command that is not a push never calls gh", async () => {
    using home = myosHome("push-notpush");
    const dir = repo(home, true);
    const marker = home.join("gh-called");
    using bin = sparsePath({ link: ["git"], stub: { gh: `touch '${marker}'; echo PUBLIC` } });
    const r = await runHook(HOOK, { home, stdin: events.preToolUse("Bash", { command: "git status" }, { cwd: dir }), env: { PATH: bin.path } });
    expect(r.exitCode).toBe(0);
    expect(await Bun.file(marker).exists()).toBe(false);
  });
});
