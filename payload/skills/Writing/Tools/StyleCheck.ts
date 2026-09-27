#!/usr/bin/env bun
/**
 * StyleCheck.ts - the myos house writing style gate.
 *
 * Reports every place a markdown file drifts from the house style, and fixes
 * the one class of drift that is safe to fix by machine: em dashes.
 *
 * Everything else is reported, never auto-edited. Word choice needs a human
 * (or a model) reading the sentence; punctuation does not.
 *
 * Protected regions are never touched or flagged: fenced code blocks, inline
 * code spans, link targets, bare URLs and HTML comments. An em dash inside a
 * regex or a shell example is code, not prose.
 *
 * Usage:
 *   bun StyleCheck.ts [flags] <path...>
 *
 * Flags:
 *   --fix              rewrite em dashes in place (the only auto-fix)
 *   --profile <name>   prose | docs | dashes      (default: prose)
 *   --hints            also report Latinate words with shorter English swaps
 *   --json             machine-readable output
 *   --quiet            only print the summary line
 *   --help             this text
 *
 * Profiles:
 *   prose   everything on. For reader-facing docs and anything myos writes for a human.
 *   docs    prose minus the inline-header-bullet and heading-case rules. For
 *           reference documentation, where a definition list is real structure.
 *   dashes  em dashes only. For files lifted from LifeOS that stay close to
 *           upstream so the next pull still merges.
 *
 * Exit code: 0 when no error-severity finding remains, 1 otherwise.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, extname } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = "error" | "warn" | "hint";
type Profile = "prose" | "docs" | "dashes";

/** Characters of raw text either side of a hit that the `unless` list sees. */
const ALLOW_WINDOW = 50;

interface Rule {
  id: string;
  severity: Severity;
  /** Global regex run against the masked line. */
  re: RegExp;
  /** Human-readable fix advice. */
  advice: string;
  /**
   * Skip the hit when any of these match the raw text within ALLOW_WINDOW
   * characters either side of it. Scoped to the hit, not the whole line, so a
   * domain term does not excuse every other word that shares its line.
   */
  unless?: RegExp[];
  /** Rule only applies in these profiles. Default: prose + docs. */
  profiles?: Profile[];
}

interface Finding {
  file: string;
  line: number;
  col: number;
  rule: string;
  severity: Severity;
  text: string;
  advice: string;
}

// ---------------------------------------------------------------------------
// Masking: blank out everything that is code, not prose
// ---------------------------------------------------------------------------

const NUL = "\0";

function blank(s: string): string {
  return NUL.repeat(s.length);
}

/**
 * Returns a copy of the document with every protected region replaced by NUL
 * bytes. Length and line offsets are preserved exactly, so an index into the
 * masked text is a valid index into the original.
 */
function maskDocument(src: string): string {
  const lines = src.split("\n");
  let inFence = false;
  let fenceMark = "";

  const masked = lines.map((line) => {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const mark = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMark = mark;
        return blank(line);
      }
      if (mark === fenceMark) {
        inFence = false;
        fenceMark = "";
      }
      return blank(line);
    }
    if (inFence) return blank(line);

    let out = line;
    // Indented code blocks (four spaces, outside a list) are left alone too.
    if (/^ {4,}\S/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) return blank(line);

    // HTML comments on a single line.
    out = out.replace(/<!--[\s\S]*?-->/g, blank);
    // Inline code spans, double backticks first.
    out = out.replace(/``[^`]*``/g, blank);
    out = out.replace(/`[^`\n]*`/g, blank);
    // Markdown link and image targets: keep the label, blank the target.
    out = out.replace(/(\]\()([^)\s]+)/g, (_m, open: string, target: string) => open + blank(target));
    // Bare URLs and autolinks.
    out = out.replace(/<https?:\/\/[^>\s]+>/g, blank);
    out = out.replace(/https?:\/\/\S+/g, blank);
    // Reference-style link definitions.
    out = out.replace(/^(\s*\[[^\]]+\]:\s*)(\S+)/, (_m, head: string, target: string) => head + blank(target));

    return out;
  });

  return masked.join("\n");
}

// ---------------------------------------------------------------------------
// Em dash handling
// ---------------------------------------------------------------------------

const EM = "\u2014";

/**
 * A right-hand segment that begins like an independent clause takes a
 * semicolon. Anything else takes a comma.
 */
const INDEPENDENT_CLAUSE =
  /^(it|this|that|they|these|those|there|we|you|he|she|i|one|each|every|both|others?|nothing|everything|anyone|someone|his|her|its|their|our|your|myos|claude|lifeos|the\s+\w+|an?\s+\w+)\s+(is|are|was|were|has|have|had|does|do|did|will|can|could|should|must|may|might|would|becomes?|makes?|means?|gets?|goes?|runs?|needs?|counts?|fires?|lives?|stays?|holds?|works?|reads?|writes?|returns?|keeps?|sits?|comes?|takes?|gives?|knows?|wants?|looks?|feels?|seems?|exists?|starts?|ends?|fails?|passes?|blocks?|owns?|uses?|lets?|adds?|drops?|shows?|tells?|calls?|loads?|saves?|sends?|picks?|puts?|sets?|leaves?|wins?|costs?|breaks?|matters?|happens?|depends?|belongs?|applies|apply|carries|carry|catch|catches|never|always)\b/i;

/**
 * A right-hand segment that opens with a bare imperative is its own sentence.
 * "X, go run the full thing" is a comma splice; "X; go run the full thing" is not.
 */
const IMPERATIVE_CLAUSE =
  /^(go|run|use|see|read|check|keep|make|take|pick|drop|add|set|start|stop|write|call|ask|do|don't|note|treat|think|expect|assume|prefer|avoid|load|open|close|copy|move|delete|edit|fix|ship|build|test|verify)\s+\S/i;

/** A right-hand segment beginning with one of these always takes a comma. */
const COMMA_STARTERS =
  /^(not|never|no|only|and|but|so|or|then|yet|plus|minus|with|without|via|per|often|usually|typically|sometimes|always|already|still|just|even|especially|including|excluding|ideally|roughly|about|around|up|down|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

/** Left-hand side that reads as a term being defined takes a colon. */
function leftIsDefinedTerm(left: string): boolean {
  const t = left.trim();
  if (!t) return false;
  if (/^\*\*[^*]+\*\*[.:,]?$/.test(t)) return true;
  if (/^`[^`]+`$/.test(t)) return true;
  if (/^\*\*/.test(t) && t.length <= 45) return true;
  return false;
}

/** Strip a leading list bullet, blockquote marker or heading marker. */
function stripLeadMarkers(s: string): string {
  return s.replace(/^\s*>?\s*(([-*+]|\d+[.)])\s+)?/, "").replace(/^#{1,6}\s+/, "");
}

/**
 * Return the text of the table cell containing index `i`, up to `i`.
 * Returns null when the line is not a table row.
 */
function cellBefore(line: string, i: number): string | null {
  if (!/^\s*\|/.test(line)) return null;
  const start = line.lastIndexOf("|", i - 1);
  if (start === -1) return null;
  return line.slice(start + 1, i);
}

/**
 * True when the dash at `i` OPENS a table cell, with nothing before it in that
 * cell. Such a dash is a placeholder standing for "no value here", either alone
 * (`| \u2014 |`) or qualified (`| \u2014 (library) |`), not punctuation joining two pieces
 * of prose.
 *
 * These are not auto-fixable. Every substitute the house style offers (comma,
 * colon, semicolon, parenthesis) joins two things, and there is nothing to the
 * left to join: inserting one turns `| \u2014 |` into `|, |`, which says nothing at
 * all. The cell needs a WORD (`none`, `n/a`), and word choice is the author's
 * call, never the fixer's. So the fixer leaves it alone while the checker still
 * reports it, exactly how banned vocabulary is already handled.
 */
function isCellPlaceholderDash(line: string, i: number): boolean {
  const before = cellBefore(line, i);
  return before !== null && before.trim() === "";
}

/**
 * Rewrite every unprotected em dash on one line.
 * `masked` decides which dashes are prose; `line` is what gets edited.
 */
/** True when the text after the dash is an enumeration, which wants a colon. */
function isNounList(right: string): boolean {
  if (INDEPENDENT_CLAUSE.test(right)) return false;
  return (right.match(/,/g) ?? []).length >= 2;
}

/** True when `line` opens a new markdown block rather than continuing a sentence. */
function startsNewBlock(line: string | undefined): boolean {
  if (line === undefined) return true;
  if (line.trim() === "") return true;
  return /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|```|~~~|---)/.test(line);
}

/**
 * Choose the punctuation that replaces one em dash.
 * `left` is the text before it on its line, already stripped of list and table
 * markers; `right` is what follows, which may come from the next line when the
 * dash sits at end of line.
 */
function replacementFor(left: string, right: string, isHeading: boolean): string {
  if (/:\s*$/.test(left)) return " ";
  if (isHeading) return ": ";
  if (leftIsDefinedTerm(left)) return ": ";
  if (COMMA_STARTERS.test(right)) return ", ";
  if (IMPERATIVE_CLAUSE.test(right)) return "; ";
  if (INDEPENDENT_CLAUSE.test(right)) return "; ";
  if (isNounList(right)) return ": ";
  return ", ";
}

export function fixDashesInLine(line: string, masked: string, nextLine?: string): string {
  const hits: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    // A dash opening a table cell is a placeholder, not punctuation: reported,
    // never rewritten (see isCellPlaceholderDash).
    if (masked[i] === EM && !isCellPlaceholderDash(line, i)) hits.push(i);
  }
  if (hits.length === 0) return line;

  // Paired parenthetical: X - short aside - Y becomes X (short aside) Y.
  if (hits.length === 2) {
    const [a, b] = hits;
    const spacedA = line[a - 1] === " " && line[a + 1] === " ";
    const spacedB = line[b - 1] === " " && line[b + 1] === " ";
    const middle = line.slice(a + 2, b - 1).trim();
    const words = middle.split(/\s+/).filter(Boolean).length;
    const tail = line.slice(b + 2).trim();
    if (
      spacedA && spacedB && tail.length > 0 &&
      words >= 2 && words <= 10 &&
      !middle.includes(",") && !middle.includes("|") && !middle.includes(";")
    ) {
      return line.slice(0, a - 1) + " (" + line.slice(a + 2, b - 1) + ") " + line.slice(b + 2);
    }
  }

  // Rewrite right to left so earlier indices stay valid.
  let out = line;
  for (let k = hits.length - 1; k >= 0; k--) {
    const i = hits[k];
    const before = out.slice(0, i);
    const after = out.slice(i + 1);
    const leftRaw = cellBefore(out, i) ?? stripLeadMarkers(before);
    const isHeading = /^#{1,6}\s/.test(out);

    // Dash at end of line. When the sentence carries on to the next line the
    // punctuation still has to carry on with it; only a dash that ends its
    // block can simply go.
    if (after.trim() === "") {
      const lead = before.replace(/\s+$/, "");
      if (startsNewBlock(nextLine)) { out = lead; continue; }
      const repl = replacementFor(leftRaw, nextLine!.trim(), isHeading);
      out = lead + repl.trimEnd();
      continue;
    }

    // Dash at start of a continuation line: it is the tail of the sentence
    // above, so the punctuation belongs there, not at column one.
    if (before.trim() === "") {
      out = after.replace(/^\s+/, "");
      continue;
    }

    const repl = replacementFor(leftRaw, after.replace(/^\s+/, ""), isHeading);
    // Absorb the spaces that surrounded the dash so we never double up.
    out = before.replace(/\s+$/, "") + repl + after.replace(/^\s+/, "");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RULES: Rule[] = [
  {
    id: "em-dash",
    severity: "error",
    re: /\u2014/g,
    advice: "no em dashes. A comma, colon, semicolon or parenthesis says it better",
    profiles: ["prose", "docs", "dashes"],
  },

  // Banned vocabulary (StyleRules.md, "Words to drop").
  {
    id: "vocab-inflated",
    severity: "error",
    re: /\b(pivotal|vital|meticulous(ly)?|profound(ly)?|vibrant|intricate|intricacies|tapestry|delve|delving|garner(ed|s)?|showcas(e|es|ing|ed)|boasts?|testament to|paradigm|realm|embark(ed|ing)?|beacon|nestled|thriving|daunting|holistic(ally)?|impactful|learnings|synergy|synergies|plethora|myriad|elucidate|illuminate|juxtapose|multifaceted|burgeoning|nascent|quintessential|overarching|paramount|cornerstone|galvanis|galvaniz|catalyz|revolutioniz|unleash|bolster|streamlin|game.chang)\w*/gi,
    advice: "AI vocabulary. Use the plain word or describe the specific thing",
  },
  {
    id: "vocab-latinate-banned",
    severity: "error",
    re: /\b(utili[sz]e[sd]?|utili[sz]ing|commence[sd]?|ascertain(ed|s)?|endeavou?r(ed|ing|s)?|facilitate[sd]?|facilitating)\b/gi,
    advice: "use the short English word: use, start, find out, effort, help",
  },
  {
    id: "vocab-crucial",
    severity: "error",
    re: /\b(crucial(ly)?|robust(ly)?|seamless(ly)?|cutting.edge|deep dive|actionable|nuanced)\b/gi,
    advice: "say what is specifically true instead",
    unless: [/banned|forbidden|avoid|do not use|replace|Tier 1|Tier 2|\| *robust|\| *crucial/i],
  },
  {
    id: "vocab-key-adjective",
    severity: "error",
    re: /\bkey\s+(takeaways?|insights?|points?|factors?|roles?|benefits?|features?|differences?|questions?|challenges?|advantages?|considerations?)\b/gi,
    advice: "'key' as an adjective is filler. Name the thing or cut the word",
  },
  {
    id: "vocab-context-sensitive",
    severity: "error",
    // `harness` and `underscore` are ordinary nouns in this repo (the CLI
    // harness, the `_` prefix), so only their verb senses are banned.
    // `leverage points` is Meadows. `substrate` and `epistemic` are dropped
    // from the list entirely: Loop uses one as a runtime term and Philosophy
    // uses the other as Deutsch does.
    re: /\bharness(?:es|ed|ing)?\s+(?:the|a|an|this|that|its|their|our|your)\b|\bleverag(?:e|es|ed|ing)\b(?!\s+points?)|\bcomprehensive(?:ly)?\b|\becosystems?\b|\blandscapes?\b|\bunderscor(?:e|es|ed|ing)\s+(?:the|a|an|this|that|how|why|what|its|their)\b|\bfoster(?:s|ed|ing)?\b|\bcultivat(?:e|es|ed|ing|ion)\b/gi,
    advice: "AI vocabulary outside its domain sense",
    unless: [
      // Comprehensive as a tier or depth-mode label, not as a description.
      /\*\*Comprehensive\b|\|\s*Comprehensive\b|→\s*Comprehensive\b|\(Comprehensive\)/,
      /Comprehensive\s*\(E5\)|E5\s*=\s*Comprehensive|Comprehensive\s+(?:effort|tier)|\bDeep\b[^\n]{0,20}\bComprehensive\b/,
      /banned|forbidden|avoid|do not use|replace|Tier 1|Tier 2|Tier 3|swap|instead of/i,
    ],
  },
  {
    id: "copula-avoidance",
    severity: "error",
    re: /\b(serves? as|stands? as|marks? a|holds? the distinction)\b/gi,
    advice: "use 'is' or 'was'",
    unless: [/banned|forbidden|avoid|do not use|replace|instead/i],
  },
  {
    id: "opener-additive",
    severity: "error",
    re: /^[ \t]*(?:>[ \t]*)?(?:[-*+][ \t]+)?(Additionally|Furthermore|Moreover|In summary|In conclusion|In essence|Notably|Importantly|Crucially|Ultimately)[ \t]*,/gm,
    advice: "drop the opener or use 'And' / 'Also', or restructure",
    unless: [/banned|forbidden|avoid|do not use|replace|instead/i],
  },
  {
    id: "hedge-worth-noting",
    severity: "error",
    re: /\bit(?:'|’)?s? (?:is )?worth (?:noting|mentioning)\b|\bit is important to note\b|\bit should be noted\b/gi,
    advice: "state the thing",
    unless: [/banned|forbidden|avoid|do not use|replace|instead/i],
  },
  {
    id: "not-just-but",
    severity: "error",
    re: /\bnot (?:just|only) [^.,;]{1,60}, but\b/gi,
    advice: "make the point directly",
    unless: [/banned|forbidden|avoid|do not use|replace|instead/i],
  },
  {
    id: "moving-forward",
    severity: "error",
    re: /\b(moving forward|going forward|in today(?:'|’)?s|ever.evolving|evolving landscape)\b/gi,
    advice: "delete it or state the timing directly",
    unless: [/banned|forbidden|avoid|do not use|replace|instead/i],
  },
  {
    id: "vague-attribution",
    severity: "error",
    re: /\b(experts? (?:say|argue|believe|agree)|observers? note|studies show|research suggests|industry leaders)\b/gi,
    advice: "name the source or state the claim directly",
    unless: [/banned|forbidden|avoid|do not use|replace|instead/i],
  },
  {
    id: "filler-phrase",
    severity: "error",
    re: /\b(in order to|due to the fact that|at its core|best practices)\b/gi,
    advice: "to / because / (cut) / what works",
    unless: [/banned|forbidden|avoid|do not use|replace|instead/i],
  },

  // Structure. Off in the docs profile, where a definition list is real structure.
  {
    id: "inline-header-bullet",
    severity: "warn",
    re: /^[ \t]*[-*+][ \t]+\*\*[^*]+:\*\*/gm,
    advice: "inline-header bullet. Use prose or a table",
    profiles: ["prose"],
  },
  {
    id: "heading-title-case",
    severity: "warn",
    re: /^#{2,6}[ \t]+\S+(?:[ \t]+[A-Z][a-z]+){2,}[ \t]*$/gm,
    advice: "sentence case for subheadings",
    profiles: ["prose"],
  },

  // Hints: shorter English word available. Never fails the build.
  {
    id: "hint-latinate",
    severity: "hint",
    re: /\b(purchase[sd]?|obtain(ed|s)?|require[sd]?|requirement|assist(ed|s|ance)?|attempt(ed|s)?|demonstrate[sd]?|terminate[sd]?|initiate[sd]?|construct(ed|s)?|maintain(ed|s)?|provide[sd]?|sufficient|approximately|subsequent(ly)?|prior to|regarding|additional|numerous|permit(ted|s)?|locate[sd]?|transmit(ted|s)?|inquire[sd]?|commence\w*|remainder|utilise|modification|implement(ed|s|ation)?|verify|verification|assistance|component|encounter(ed|s)?|possess(ed|es)?|purchase|inform(ed|s)?|receive[sd]?|observe[sd]?|indicate[sd]?|reside[sd]?|conceal(ed|s)?|comprehend(ed|s)?|anticipate[sd]?|accelerate[sd]?)\b/gi,
    advice: "a shorter English word usually fits: see StyleRules.md",
  },
];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function ruleApplies(rule: Rule, profile: Profile): boolean {
  const list = rule.profiles ?? ["prose", "docs"];
  return list.includes(profile);
}

/**
 * A single line opts out with a trailing comment, for the rare case where the
 * banned word is a proper noun: `<!-- stylecheck-ignore -->`.
 */
const IGNORE_LINE = /<!--\s*stylecheck-ignore\s*-->/i;

/** True when an allowlist entry excuses this hit. */
function allowed(rule: Rule, rawLine: string, col: number): boolean {
  if (rule.id !== "em-dash" && IGNORE_LINE.test(rawLine)) return true;
  if (!rule.unless) return false;
  const window = rawLine.slice(Math.max(0, col - ALLOW_WINDOW), col + ALLOW_WINDOW);
  return rule.unless.some((u) => u.test(window));
}

/**
 * Files that quote bad writing on purpose (the AI-patterns reference, this
 * skill's own rule tables) opt out with a directive anywhere in the file:
 *
 *   <!-- stylecheck-disable: vocab, copula-avoidance -->
 *   <!-- stylecheck-disable: all -->
 *
 * Entries match rule ids by prefix, so `vocab` covers every vocab-* rule.
 * The em-dash rule cannot be disabled; there is no reason to write one.
 */
function suppressedRules(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<!--\s*stylecheck-disable:\s*([^>]+?)\s*-->/gi)) {
    for (const part of m[1].split(",")) {
      const id = part.trim().toLowerCase();
      if (id && id !== "em-dash") out.push(id);
    }
  }
  return out;
}

function checkText(file: string, src: string, profile: Profile, hints: boolean): Finding[] {
  const suppressed = suppressedRules(src);
  const masked = maskDocument(src);
  const maskedLines = masked.split("\n");
  const rawLines = src.split("\n");
  const findings: Finding[] = [];

  for (const rule of RULES) {
    if (!ruleApplies(rule, profile)) continue;
    if (rule.severity === "hint" && !hints) continue;
    if (rule.id !== "em-dash" &&
        suppressed.some((s) => s === "all" || rule.id.startsWith(s))) continue;

    // Multiline rules run against the whole masked document.
    if (rule.re.flags.includes("m")) {
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(masked)) !== null) {
        if (m[0].length === 0) { rule.re.lastIndex++; continue; }
        const upto = masked.slice(0, m.index);
        const lineNo = upto.split("\n").length;
        const col = m.index - upto.lastIndexOf("\n");
        const raw = rawLines[lineNo - 1] ?? "";
        if (allowed(rule, raw, col - 1)) continue;
        findings.push({
          file, line: lineNo, col,
          rule: rule.id, severity: rule.severity,
          text: m[0].replace(/\n/g, " ").trim(), advice: rule.advice,
        });
      }
      continue;
    }

    for (let i = 0; i < maskedLines.length; i++) {
      const ml = maskedLines[i];
      const raw = rawLines[i];
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(ml)) !== null) {
        if (m[0].length === 0) { rule.re.lastIndex++; continue; }
        if (allowed(rule, raw, m.index)) continue;
        findings.push({
          file, line: i + 1, col: m.index + 1,
          rule: rule.id, severity: rule.severity,
          text: m[0], advice: rule.advice,
        });
      }
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.col - b.col);
}

export function fixText(src: string): string {
  const masked = maskDocument(src);
  const maskedLines = masked.split("\n");
  const lines = src.split("\n");
  return lines
    .map((line, i) => fixDashesInLine(line, maskedLines[i] ?? line, lines[i + 1]))
    .join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `StyleCheck.ts - the myos house writing style gate

  bun StyleCheck.ts [flags] <path...>

  --fix              rewrite em dashes in place (the only auto-fix)
  --profile <name>   prose | docs | dashes      (default: prose)
  --hints            also report Latinate words with shorter English swaps
  --json             machine-readable output
  --quiet            only print the summary line
  --help             this text

Profiles:
  prose   everything on. reader-facing docs and anything myos writes for a human.
  docs    prose minus the inline-header-bullet and heading-case rules.
  dashes  em dashes only. Files lifted from LifeOS that stay close to upstream.

Exit code: 0 when no error-severity finding remains, 1 otherwise.
Full rules: ../StyleRules.md`;

function collect(target: string, out: string[]): void {
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const e of readdirSync(target)) {
      if (e === "node_modules" || e === ".git") continue;
      collect(join(target, e), out);
    }
  } else if (extname(target) === ".md") {
    out.push(target);
  }
}

function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(USAGE);
    return 0;
  }

  let profile: Profile = "prose";
  const fix = argv.includes("--fix");
  const json = argv.includes("--json");
  const quiet = argv.includes("--quiet");
  const hints = argv.includes("--hints");
  const paths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile") { profile = argv[++i] as Profile; continue; }
    if (a.startsWith("--")) continue;
    paths.push(a);
  }
  if (!["prose", "docs", "dashes"].includes(profile)) {
    console.error(`unknown profile: ${profile}`);
    return 2;
  }

  const files: string[] = [];
  for (const p of paths) {
    try { collect(p, files); } catch { console.error(`cannot read: ${p}`); return 2; }
  }

  const all: Finding[] = [];
  let fixedFiles = 0;

  for (const f of files) {
    let src = readFileSync(f, "utf8");
    if (fix) {
      const next = fixText(src);
      if (next !== src) { writeFileSync(f, next, "utf8"); src = next; fixedFiles++; }
    }
    all.push(...checkText(f, src, profile, hints));
  }

  const errors = all.filter((f) => f.severity === "error");
  const warns = all.filter((f) => f.severity === "warn");
  const hintList = all.filter((f) => f.severity === "hint");

  if (json) {
    console.log(JSON.stringify({ files: files.length, fixedFiles, findings: all }, null, 2));
  } else if (!quiet) {
    for (const f of all) {
      const tag = f.severity === "error" ? "ERROR" : f.severity === "warn" ? "warn " : "hint ";
      console.log(`${tag} ${f.file}:${f.line}:${f.col}  [${f.rule}] "${f.text}"  ${f.advice}`);
    }
  }

  const parts = [`${files.length} file(s)`];
  if (fix) parts.push(`${fixedFiles} rewritten`);
  parts.push(`${errors.length} error`, `${warns.length} warn`);
  if (hints) parts.push(`${hintList.length} hint`);
  console.log(`StyleCheck [${profile}]: ${parts.join(", ")}`);

  return errors.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
