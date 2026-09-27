/**
 * isa-structure.ts: the structural facts ISAGate checks at `phase: complete`,
 * read against MYOS/DOCUMENTATION/IsaFormat.md. Only binary facts a throwaway
 * edit cannot fake; prose quality is never judged here.
 */
import { parseFrontmatter } from "./isa-utils";

export interface Violation {
  code: string;
  message: string;
}

interface Claim { id: string; state: "open" | "closed" | "deferred"; dropped: boolean; anti: boolean }

const CLAIM_LINE = /^\s*- \[( |x|X|DEFERRED-VERIFY)\]\s*((?:C|A)\d+(?:\.\d+)*|ISC-[\w-]+):\s*(.*)$/;

/** The body of one `## <name>` section (up to the next `## `), or null. */
export function section(content: string, name: RegExp): string | null {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /^##\s+/.test(l) && name.test(l.replace(/^##\s+/, "").trim()));
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) break;
    out.push(lines[i]!);
  }
  return out.join("\n");
}

export function parseClaims(content: string): Claim[] {
  const body = section(content, /^(Claims|Features)\b/i) ?? "";
  const claims: Claim[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(CLAIM_LINE);
    if (!m) continue;
    const mark = m[1]!;
    const id = m[2]!;
    const text = m[3]!;
    claims.push({
      id,
      state: mark === " " ? "open" : mark === "DEFERRED-VERIFY" ? "deferred" : "closed",
      dropped: /^\[DROPPED\b/i.test(text.trim()),
      anti: /^A\d/.test(id) || /^Anti:/i.test(text.trim()),
    });
  }
  return claims;
}

/** Hard violations of a completed ISA. Empty means it may close. */
export function completionViolations(content: string): Violation[] {
  const out: Violation[] = [];
  const fm = parseFrontmatter(content) ?? {};
  if (!section(content, /^Goal\b/i)) out.push({ code: "no-goal", message: "no `## Goal` section" });
  const claims = parseClaims(content).filter((c) => !c.dropped);
  if (claims.length === 0) {
    out.push({ code: "no-claims", message: "no claims under `## Claims` or `## Features`" });
    return out;
  }
  if (!claims.some((c) => c.anti)) out.push({ code: "no-anti", message: "no anti claim (an `A<n>` id or `Anti:` prefix)" });
  const open = claims.filter((c) => c.state === "open").map((c) => c.id);
  if (open.length) out.push({ code: "open-claims", message: `open claims at complete: ${open.join(", ")}` });

  const progress = (fm.progress ?? "").trim();
  const m = progress.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) {
    out.push({ code: "progress-format", message: `progress is ${JSON.stringify(progress)}, not M/N` });
  } else {
    const closed = claims.filter((c) => c.state !== "open").length;
    if (Number(m[1]) !== closed || Number(m[2]) !== claims.length) {
      out.push({ code: "progress-mismatch", message: `progress says ${m[1]}/${m[2]}, the claims say ${closed}/${claims.length}` });
    }
  }

  const fog = section(content, /^Not yet specified\b/i);
  if (fog && /^\s*[-*]\s+\S/m.test(fog)) {
    out.push({ code: "fog-at-complete", message: "`## Not yet specified` still has entries: graduate them to claims or kill them in Decisions" });
  }
  return out;
}
