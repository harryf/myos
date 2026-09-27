/**
 * VerifyImageProbe is the check behind every "the page rendered" claim: it
 * classifies a blank frame against real content. With ImageMagick present the
 * test builds both images and asserts the classification both ways, which is the
 * only way to know the probe has not degenerated into always-passing.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { bunExe, gate, haveBin, repoPath, run, tempDir } from "../../../harness.ts";

const TOOL = "payload/skills/Interceptor/Tools/VerifyImageProbe.ts";
const SOURCE = readFileSync(repoPath(TOOL), "utf8");

const noMagick = gate("Interceptor VerifyImageProbe (real classification)", haveBin("magick"), "ImageMagick not on PATH (brew install imagemagick)");

describe("argument contract", () => {
  test("bad arguments exit 2, distinct from a classification mismatch", async () => {
    const result = await run([bunExe(), repoPath(TOOL)]);
    expect(result.exitCode).toBe(2);
  });

  test("an unreadable image is exit 1, and never a pass", async () => {
    // Exit 2 is reserved for bad arguments; an image whose std-dev cannot be read
    // is a failed probe. What matters is that it is not 0: an unmeasurable frame
    // must never satisfy a "the page rendered" claim.
    const result = await run([bunExe(), repoPath(TOOL), "/nonexistent/good.png", "/nonexistent/blank.png"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("REJECT");
  });
});

describe("the probe's definition", () => {
  test("the blankness threshold is a standard deviation, overridable by env", () => {
    expect(SOURCE).toContain("INTERCEPTOR_MIN_STDDEV");
    expect(SOURCE).toMatch(/0\.017/);
  });

  test("magick is looked for on PATH and in the usual install locations", () => {
    expect(SOURCE).toContain("Bun.which");
    expect(SOURCE).toContain("/opt/homebrew/bin/magick");
  });

  test("single magick spawns are used on purpose, to stay reliable under load", () => {
    expect(SOURCE).toMatch(/single magick spawns|starvation/i);
  });
});

describe.skipIf(noMagick)("with ImageMagick present", () => {
  /** A flat white image: what a blank/unpainted page looks like. */
  async function blank(path: string) {
    return run(["magick", "-size", "200x200", "xc:white", path]);
  }

  /** A textured image: what real content looks like. */
  async function textured(path: string) {
    return run(["magick", "-size", "200x200", "plasma:fractal", path]);
  }

  test("classifies real content and a blank frame correctly, in that order", async () => {
    using dir = tempDir("verifyimageprobe");
    const good = dir.join("good.png");
    const flat = dir.join("blank.png");
    expect((await textured(good)).exitCode).toBe(0);
    expect((await blank(flat)).exitCode).toBe(0);

    const result = await run([bunExe(), repoPath(TOOL), good, flat]);
    expect(result.exitCode).toBe(0);
  });

  test("two blank frames are a mismatch: the probe cannot be satisfied by anything", async () => {
    using dir = tempDir("verifyimageprobe-both-blank");
    const a = dir.join("a.png");
    const b = dir.join("b.png");
    await blank(a);
    await blank(b);

    const result = await run([bunExe(), repoPath(TOOL), a, b]);
    expect(result.exitCode).toBe(1);
  });

  test("swapping the arguments is a mismatch, so the direction of the check is real", async () => {
    using dir = tempDir("verifyimageprobe-swapped");
    const good = dir.join("good.png");
    const flat = dir.join("blank.png");
    await textured(good);
    await blank(flat);

    const result = await run([bunExe(), repoPath(TOOL), flat, good]);
    expect(result.exitCode).toBe(1);
  });
});
