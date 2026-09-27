/**
 * VerificationGate: the message is a claim, the transcript is the evidence.
 * Classification is tested in process; the gate itself runs as a real
 * subprocess against replayed transcript fixtures. Block is exit 2 with the
 * reason on stderr; log mode is exit 0 plus a would-block row.
 */
import { describe, expect, test } from "bun:test";

import { assistantToolUse, events, myosHome, runHook, SESSION_ID, toolResult, transcript, userText } from "./harness.ts";
import { classifyClaim, genericFlowClaimUnit, publicityClaimUnit, splitIntoUnits, stripNoise } from "../../payload/hooks/VerificationGate.hook.ts";

const HOOK = "payload/hooks/VerificationGate.hook.ts";
const OBS = ".myos/MYOS/MEMORY/OBSERVABILITY/verification-gate.jsonl";
const LATCH = `.myos/MYOS/MEMORY/STATE/verification-gate-blocked/${SESSION_ID}.json`;

type Home = ReturnType<typeof myosHome>;
const rows = async (home: Home) =>
  (await Bun.file(home.join(OBS)).exists())
    ? (await Bun.file(home.join(OBS)).text()).trim().split("\n").map((l) => JSON.parse(l))
    : [];
const stop = (tx: string, message: string, over: Record<string, unknown> = {}) =>
  events.stop({ transcript_path: tx, last_assistant_message: message, ...over });

describe("claim classification (pure)", () => {
  test("each type needs its nouns; flow outranks deploy", () => {
    expect(classifyClaim("The login flow works end-to-end now.")?.type).toBe("T2");
    expect(classifyClaim("The site is live at the production URL.")?.type).toBe("T1");
    expect(classifyClaim("The logo renders centered in the header.")?.type).toBe("T3");
    expect(classifyClaim("All 42 tests pass.")?.type).toBe("T4");
    expect(classifyClaim("I refactored the parser for clarity.")).toBeNull();
  });

  test("questions, intents, negations, instructions and quotes are not claims", () => {
    expect(classifyClaim("Does the login flow work now?")).toBeNull();
    expect(classifyClaim("I am going to verify the login flow works.")).toBeNull();
    expect(classifyClaim("The login flow doesn't work yet.")).toBeNull();
    expect(classifyClaim("Run the app, then check the login flow works.")).toBeNull();
    expect(classifyClaim('The ticket says "the login flow works" but I have not checked.')).toBeNull();
    expect(classifyClaim(stripNoise("```\nthe login flow works\n```"))).toBeNull();
  });

  test("a URL is one piece of a unit, never split at its dots", () => {
    expect(splitIntoUnits("It is live at https://harryf.github.io/private/a.html. Next.")).toEqual([
      "It is live at https://harryf.github.io/private/a.html",
      "Next",
    ]);
  });

  test("terse overclaims and publicity claims are detected", () => {
    expect(genericFlowClaimUnit("Both apps live and verified.")).toBeTruthy();
    expect(publicityClaimUnit("Version 1.2.0 is public on GitHub.")).toBeTruthy();
    expect(publicityClaimUnit("The payload is staged locally.")).toBeNull();
  });
});

// Transcript fixtures

function deployTurn(home: Home, extra: string[] = []): string {
  return home.write("tx.jsonl", transcript(
    userText("publish the calendar page"),
    assistantToolUse("Edit", { file_path: "/repo/site/calendar.html" }, "e1"),
    toolResult("e1", "ok"),
    assistantToolUse("Bash", { command: "~/bin/publish site/calendar.html calendar --private -y" }, "d1"),
    toolResult("d1", "Pushed abc123"),
    ...extra,
  ));
}

function uiTurn(home: Home, evidence: string[]): string {
  return home.write("tx.jsonl", transcript(
    userText("center the logo"),
    assistantToolUse("Edit", { file_path: "/repo/site/header.css" }, "e1"),
    toolResult("e1", "ok"),
    ...evidence,
  ));
}

const DEPLOY_CLAIM = "The calendar page is live at https://example.github.io/private/calendar.html.";
const UI_CLAIM = "The logo renders centered in the header.";

describe("blocking (default mode)", () => {
  test("deploy claim with no probe blocks: exit 2, reason on stderr, latch written", async () => {
    using home = myosHome("vg-deploy-block");
    const r = await runHook(HOOK, { home, stdin: stop(deployTurn(home), DEPLOY_CLAIM) });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("VerificationGate/T1");
    expect(r.stderr).toContain("calendar page is live");
    expect((await rows(home)).at(-1).decision).toBe("block");
    expect(await Bun.file(home.join(LATCH)).exists()).toBe(true);
  });

  test("a deploy claim that is also a publicity claim still blocks on T1 (T5 alone only logs)", async () => {
    using home = myosHome("vg-deploy-pages");
    const r = await runHook(HOOK, {
      home,
      stdin: stop(deployTurn(home), "The page is now live on GitHub Pages at https://harryf.github.io/private/calendar.html."),
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("VerificationGate/T1");
    const decisions = (await rows(home)).map((x) => `${x.type}:${x.decision}`);
    expect(decisions).toContain("T5:would-block");
    expect(decisions).toContain("T1:block");
  });

  test("the same deploy claim with a curl probe after the deploy passes", async () => {
    using home = myosHome("vg-deploy-probed");
    const tx = deployTurn(home, [
      assistantToolUse("Bash", { command: "curl -sI https://example.github.io/private/calendar.html" }, "p1"),
      toolResult("p1", "HTTP/2 200"),
    ]);
    const r = await runHook(HOOK, { home, stdin: stop(tx, DEPLOY_CLAIM) });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("pass-verified");
  });

  test("UI claim with a Claude in Chrome screenshot passes (pixels come back inline)", async () => {
    using home = myosHome("vg-ui-chrome");
    const tx = uiTurn(home, [
      assistantToolUse("mcp__claude-in-chrome__navigate", { url: "http://localhost:4000/", tabId: 1 }, "n1"),
      toolResult("n1", "navigated"),
      assistantToolUse("mcp__claude-in-chrome__computer", { action: "screenshot", tabId: 1 }, "s1"),
      toolResult("s1", "[image]"),
    ]);
    const r = await runHook(HOOK, { home, stdin: stop(tx, UI_CLAIM) });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("pass-verified");
  });

  test("UI claim with an Interceptor screenshot that was Read passes", async () => {
    using home = myosHome("vg-ui-interceptor");
    const tx = uiTurn(home, [
      assistantToolUse("Bash", { command: "interceptor screenshot --out /tmp/header.png" }, "s1"),
      toolResult("s1", "saved /tmp/header.png"),
      assistantToolUse("Read", { file_path: "/tmp/header.png" }, "r1"),
      toolResult("r1", "[image]"),
    ]);
    const r = await runHook(HOOK, { home, stdin: stop(tx, UI_CLAIM) });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("pass-verified");
  });

  test("UI claim with only a DOM read (no pixels) blocks", async () => {
    using home = myosHome("vg-ui-dom-only");
    const tx = uiTurn(home, [
      assistantToolUse("mcp__claude-in-chrome__read_page", { tabId: 1 }, "rp"),
      toolResult("rp", "<header><img alt=logo></header>"),
    ]);
    const r = await runHook(HOOK, { home, stdin: stop(tx, UI_CLAIM) });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("VerificationGate/T3");
  });

  test("one claim blocks once: the latch prevents a Stop loop", async () => {
    using home = myosHome("vg-dedupe");
    const stdin = stop(deployTurn(home), DEPLOY_CLAIM);
    expect((await runHook(HOOK, { home, stdin })).exitCode).toBe(2);
    const second = await runHook(HOOK, { home, stdin });
    expect(second.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("pass-dedupe");
  });

  test("a subagent this turn passes, but the counterfactual is logged", async () => {
    using home = myosHome("vg-subagent");
    const tx = deployTurn(home, [assistantToolUse("Agent", { description: "check the page" }, "a1"), toolResult("a1", "looks fine")]);
    const r = await runHook(HOOK, { home, stdin: stop(tx, DEPLOY_CLAIM) });
    expect(r.exitCode).toBe(0);
    const last = (await rows(home)).at(-1);
    expect(last.decision).toBe("pass-subagent");
    expect(last.would_block_without_subagent).toBe(true);
  });

  test("an honest downgrade passes", async () => {
    using home = myosHome("vg-honest");
    const r = await runHook(HOOK, { home, stdin: stop(deployTurn(home), "Published, but not verified live yet.") });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("pass-honest-downgrade");
  });
});

describe("modes and switches", () => {
  test("MYOS_GATES=off passes silently: no output, no log (positive control: log mode writes a row)", async () => {
    using control = myosHome("vg-off-control");
    const c = await runHook(HOOK, { home: control, stdin: stop(deployTurn(control), DEPLOY_CLAIM), env: { MYOS_GATES: "log" } });
    expect(c.exitCode).toBe(0);
    expect((await rows(control)).filter((x) => x.decision === "would-block" && x.type === "T1")).toHaveLength(1);
    using home = myosHome("vg-off");
    const r = await runHook(HOOK, { home, stdin: stop(deployTurn(home), DEPLOY_CLAIM), env: { MYOS_GATES: "off" } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
    expect(await Bun.file(home.join(OBS)).exists()).toBe(false);
  });

  test("MYOS_GATES=log logs would-block with the full reason, exits 0, writes no latch", async () => {
    using home = myosHome("vg-log");
    const r = await runHook(HOOK, { home, stdin: stop(deployTurn(home), DEPLOY_CLAIM), env: { MYOS_GATES: "log" } });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    const last = (await rows(home)).at(-1);
    expect(last.decision).toBe("would-block");
    expect(last.would_block).toBe(true);
    expect(last.reason).toContain("VerificationGate/T1");
    expect(await Bun.file(home.join(LATCH)).exists()).toBe(false);
  });

  test("VERIFGATE_T1=off skips the type; VERIFGATE_OFF=1 silences the gate", async () => {
    using home = myosHome("vg-t1-skip");
    const r = await runHook(HOOK, { home, stdin: stop(deployTurn(home), DEPLOY_CLAIM), env: { VERIFGATE_T1: "off" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).some((x) => x.decision === "would-block" && x.type === "T1")).toBe(false);
    using home2 = myosHome("vg-gate-off");
    const r2 = await runHook(HOOK, { home: home2, stdin: stop(deployTurn(home2), DEPLOY_CLAIM), env: { VERIFGATE_OFF: "1" } });
    expect(r2.exitCode).toBe(0);
    expect(await rows(home2)).toEqual([]);
  });

  test("a per type switch demotes that type to log", async () => {
    using home = myosHome("vg-t1-off");
    const r = await runHook(HOOK, { home, stdin: stop(deployTurn(home), DEPLOY_CLAIM), env: { VERIFGATE_T1: "0" } });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1).decision).toBe("would-block");
  });

  test("T4 (code claim without a test) only ever logs", async () => {
    using home = myosHome("vg-t4");
    const tx = home.write("tx.jsonl", transcript(userText("fix it"), assistantToolUse("Edit", { file_path: "/repo/src/a.ts" }, "e1"), toolResult("e1", "ok")));
    const r = await runHook(HOOK, { home, stdin: stop(tx, "All tests pass.") });
    expect(r.exitCode).toBe(0);
    expect((await rows(home)).at(-1)).toMatchObject({ type: "T4", decision: "would-block" });
  });
});

describe("Anti", () => {
  test("Anti: an unreadable transcript fails open", async () => {
    using home = myosHome("vg-notx");
    const r = await runHook(HOOK, { home, stdin: stop(home.join("missing.jsonl"), DEPLOY_CLAIM) });
    expect(r.exitCode).toBe(0);
  });

  test("Anti: an empty message is never a claim", async () => {
    using home = myosHome("vg-empty");
    const r = await runHook(HOOK, { home, stdin: events.stop() });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });
});
