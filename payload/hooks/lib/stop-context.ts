/**
 * stop-context.ts: the one parse StopGates does per Stop, shared by every gate.
 *
 * stdin is read once, the transcript is parsed once for the turn, and the
 * whole-session parse happens only if a gate asks for it. Each gate also has
 * a standalone shim that builds the same context from its own stdin.
 */
import type { HookInput } from "./hook-io";
import { lastAssistantText, readHookInput } from "./hook-io";
import { parseTurnEvents, type TxEvent } from "./transcript-evidence";
import { blockDecision, gatesOff, type GateOutcome } from "./gates";

export interface GateContext {
  input: HookInput;
  /** The final assistant message (stdin field, transcript as fallback). */
  message: string;
  /** Tool events of the current turn. */
  turnEvents: TxEvent[];
  /** Tool events of the whole session, parsed on first use. */
  sessionEvents: () => TxEvent[];
  /** True on the follow-up Stop after a block: evaluate, never block. */
  recovery: boolean;
}

export function buildContext(input: HookInput): GateContext {
  const message = input.last_assistant_message || lastAssistantText(input.transcript_path);
  let turn: TxEvent[] = [];
  try { turn = parseTurnEvents(input.transcript_path); } catch { turn = []; }
  let session: TxEvent[] | null = null;
  return {
    input,
    message: message ?? "",
    turnEvents: turn,
    sessionEvents: () => {
      if (session === null) {
        try { session = parseTurnEvents(input.transcript_path, { sessionWindow: true }); } catch { session = turn; }
      }
      return session;
    },
    recovery: input.stop_hook_active === true,
  };
}

export type GateRun = (ctx: GateContext) => Promise<GateOutcome | null>;

/** The import.meta.main body every gate shares: run alone, block if it says so. */
export async function runStandalone(run: GateRun): Promise<void> {
  try {
    if (gatesOff()) return;
    const input = await readHookInput();
    if (!input) return;
    const outcome = await run(buildContext(input));
    if (outcome?.block && outcome.reason) blockDecision(outcome.reason);
  } catch {
    /* a gate must never be why a Stop breaks */
  }
}
