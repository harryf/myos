/**
 * FrameScrub turns a screen recording into viewable evidence, which is what makes
 * a visual verification claim checkable at all. ffmpeg is usually present, so the
 * real extraction runs against a generated clip rather than a committed fixture.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { bunExe, gate, haveBin, repoPath, run, tempDir } from "../../../harness.ts";

const TOOL = "payload/skills/Interceptor/Tools/FrameScrub.ts";
const SOURCE = readFileSync(repoPath(TOOL), "utf8");

const noFfmpeg = gate("Interceptor FrameScrub (real extraction)", haveBin("ffmpeg"), "ffmpeg not on PATH (brew install ffmpeg)");

/** A short generated video to scrub. */
async function clip(path: string, seconds = 2) {
  return run([
    "ffmpeg", "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=320x240:rate=10`,
    "-pix_fmt", "yuv420p", "-y", path,
  ]);
}

describe("argument contract", () => {
  test("no arguments prints usage and exits 1", async () => {
    const result = await run([bunExe(), repoPath(TOOL)]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("usage: bun FrameScrub.ts <video> <survey|scrub>");
  });

  test("a video that cannot be read fails loudly rather than producing no frames quietly", async () => {
    // The ffprobe failure surfaces raw, which is ugly but unambiguous: the run
    // stops and says the file is not there. Silence is the failure mode that
    // would matter, because "no frames" reads as "nothing changed on the page".
    const result = await run([bunExe(), repoPath(TOOL), "/nonexistent/flow.webm", "survey"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("/nonexistent/flow.webm");
    // Three loud shapes, one per environment: ffprobe reports the missing file,
    // the duration parse rejects it, or ffprobe itself is not installed.
    expect(result.stderr).toMatch(/No such file|bad duration|Executable not found/);
  });

  test("a readable file that is not a video is also refused", async () => {
    using dir = tempDir("framescrub-notvideo");
    const file = dir.write("flow.webm", "this is not a video");
    const result = await run([bunExe(), repoPath(TOOL), file, "survey"]);
    expect(result.exitCode).not.toBe(0);
  });

  test("both documented modes are recognised", () => {
    expect(SOURCE).toContain("survey");
    expect(SOURCE).toContain("scrub");
  });
});

describe("the recording contract", () => {
  test("screencapture stays banned: recordings come from the extension's tab stream", () => {
    expect(SOURCE).not.toMatch(/\bscreencapture\b(?!\s+is banned)/);
  });
});

describe.skipIf(noFfmpeg)("with ffmpeg present", () => {
  test("survey extracts frames from a real clip", async () => {
    using dir = tempDir("framescrub-survey");
    const video = dir.join("flow.mp4");
    expect((await clip(video)).exitCode).toBe(0);

    const result = await run([bunExe(), repoPath(TOOL), video, "survey"], { cwd: dir.path });
    expect(result.exitCode).toBe(0);

    const produced = readdirSync(dir.path, { recursive: true }) as string[];
    expect(produced.some((file) => /\.(png|jpg|jpeg)$/i.test(String(file)))).toBe(true);
  });

  test("scrub mode runs on the same clip", async () => {
    using dir = tempDir("framescrub-scrub");
    const video = dir.join("flow.mp4");
    expect((await clip(video)).exitCode).toBe(0);

    const result = await run([bunExe(), repoPath(TOOL), video, "scrub"], { cwd: dir.path });
    expect(result.exitCode).toBe(0);
  });

  test("Anti: the source recording is never modified", async () => {
    using dir = tempDir("framescrub-anti");
    const video = dir.join("flow.mp4");
    await clip(video);
    const before = readFileSync(video);

    await run([bunExe(), repoPath(TOOL), video, "survey"], { cwd: dir.path });

    expect(readFileSync(video)).toEqual(before);
  });
});
