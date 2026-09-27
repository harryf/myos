/**
 * hook-io.ts: the shared stdin reader, plus the one transcript read the Stop
 * hooks need (the last assistant text) when stdin does not carry it.
 */
import { existsSync, readFileSync } from "node:fs";

export interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  last_assistant_message?: string;
  /**
   * True when this Stop fires as the follow-up to a block. Gates must not
   * block again on this pass (the harness would loop).
   */
  stop_hook_active?: boolean;
  [extra: string]: unknown;
}

/** Reads stdin as JSON with a 2 s ceiling. Null when empty or malformed. */
export async function readHookInput(): Promise<HookInput | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const decoder = new TextDecoder();
    reader = Bun.stdin.stream().getReader();
    let input = "";
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
    const read = (async () => {
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        input += decoder.decode(value, { stream: true });
      }
    })();
    await Promise.race([read, timeout]);
    reader.cancel().catch(() => {});
    if (input.trim()) return JSON.parse(input) as HookInput;
  } catch {
    if (reader) reader.cancel().catch(() => {});
  }
  return null;
}

/** Text of an assistant message's content, text blocks only. */
function assistantTextOf(entry: any): string {
  const content = entry?.message?.content ?? entry?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n");
}

/**
 * The last assistant text in a transcript (the final message of the turn),
 * or "" when there is none. Reads the file once; never throws.
 */
export function lastAssistantText(transcriptPath: string | undefined): string {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return "";
    const lines = readFileSync(transcriptPath, "utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line.includes('"assistant"')) continue;
      try {
        const entry = JSON.parse(line);
        if ((entry.type ?? entry.message?.role) !== "assistant") continue;
        if (entry.isSidechain === true) continue;
        const text = assistantTextOf(entry);
        if (text.trim()) return text;
      } catch {
        /* partial line */
      }
    }
  } catch {
    /* fail open */
  }
  return "";
}
