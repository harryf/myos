#!/usr/bin/env bun
/**
 * TrialClock.hook.ts (SessionStart): the myos two week trial, one line a day.
 *
 * Reads MYOS/USER/CONFIG/trial.json:
 *   { started, gate_review_due, doctrine_review_due,
 *     gate_review_done, doctrine_review_done }   (dates as YYYY-MM-DD)
 * Prints the trial day, and a due line for each review whose date has passed
 * and whose done flag is false. Silent when the file is missing or both
 * reviews are done. MYOS_NOW (ISO time) pins the clock for tests.
 */
import { existsSync, readFileSync } from "node:fs";
import { myosPath } from "./lib/paths";

export interface Trial {
  started?: string;
  gate_review_due?: string;
  doctrine_review_due?: string;
  gate_review_done?: boolean;
  doctrine_review_done?: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

function dayStart(s: string): number {
  return Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
}

export function trialLines(t: Trial, now: Date): string[] {
  if (t.gate_review_done && t.doctrine_review_done) return [];
  const today = dayStart(now.toISOString());
  const out: string[] = [];
  if (t.started && !Number.isNaN(dayStart(t.started))) {
    out.push(`myos trial day ${Math.floor((today - dayStart(t.started)) / DAY) + 1}`);
  }
  const due = (d?: string) => !!d && !Number.isNaN(dayStart(d)) && today >= dayStart(d);
  if (!t.gate_review_done && due(t.gate_review_due)) {
    out.push("Gate arming review due: run `bun MYOS/TOOLS/GateReview.ts report`");
  }
  if (!t.doctrine_review_done && due(t.doctrine_review_due)) {
    out.push("Doctrine and Evals review due (see PLAN.md phase 6)");
  }
  return out;
}

if (import.meta.main) {
  try {
    const p = myosPath("USER", "CONFIG", "trial.json");
    if (existsSync(p)) {
      const now = process.env.MYOS_NOW ? new Date(process.env.MYOS_NOW) : new Date();
      const lines = trialLines(JSON.parse(readFileSync(p, "utf8")), now);
      if (lines.length) process.stdout.write(lines.join("\n") + "\n");
    }
  } catch {
    /* never block a session start */
  }
  process.exit(0);
}
