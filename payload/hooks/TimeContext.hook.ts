#!/usr/bin/env bun
/**
 * TimeContext.hook.ts (UserPromptSubmit): one live wall clock line per turn.
 * The harness date is fixed at session start and goes stale on long sessions;
 * this line is recomputed every prompt.
 *
 * Timezone: `[principal] timezone` in MYOS/USER/CONFIG/MYOS_CONFIG.toml, else
 * Europe/Zurich. Fails open: no line is better than a blocked prompt.
 * MYOS_NOW (ISO time) pins the clock for tests.
 */
import { readConfigValue } from "./lib/config";

export const DEFAULT_TZ = "Europe/Zurich";

export function timeLine(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).formatToParts(now);
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const h = Number(g("hour"));
  const part = h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night";
  return `Now: ${g("weekday")} ${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")} ${g("timeZoneName")} (${tz}, ${part}). Trust this over the session start date.`;
}

function resolveTz(): string {
  const tz = readConfigValue("principal", "timezone");
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

if (import.meta.main) {
  try {
    const now = process.env.MYOS_NOW ? new Date(process.env.MYOS_NOW) : new Date();
    process.stdout.write(timeLine(now, resolveTz()) + "\n");
  } catch {
    /* fail open */
  }
  process.exit(0);
}
