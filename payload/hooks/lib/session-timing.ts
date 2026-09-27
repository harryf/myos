/**
 * session-timing.ts: Session start/duration bookkeeping
 *
 * Used by LoadContext.hook.ts to record session start; readers use
 * getSessionDurationMinutes() to age the current session.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const SESSION_START_FILE = '/tmp/myos-session-start.txt';

export function recordSessionStart(): void {
  try { writeFileSync(SESSION_START_FILE, Date.now().toString()); } catch {}
}

export function getSessionDurationMinutes(): number {
  try {
    if (existsSync(SESSION_START_FILE)) {
      const startTime = parseInt(readFileSync(SESSION_START_FILE, 'utf-8'));
      return (Date.now() - startTime) / 1000 / 60;
    }
  } catch {}
  return 0;
}

