#!/usr/bin/env bun

/**
 * Deep-merges a system settings JSON value with a user overlay.
 * Objects merge recursively while preserving system key order.
 * New user-only object keys are appended after system keys at each level.
 * Scalars and arrays replace by default, with user values winning conflicts.
 * Arrays can opt into append via { "__merge": "append", "values": [...] }.
 * Merge annotations are consumed and never emitted in the output.
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Snapshot of the last merge output, written alongside every successful
 * --output run. SettingsBackport diffs the live settings.json against THIS
 * (three-way base), not against a freshly computed merge: so source-file
 * edits that haven't been merged yet never read as "drift" and never get
 * clobbered back into the overlay (the 2026-07-11 hooks-BPE incident).
 */
export const MERGE_SNAPSHOT_PATH = path.join(
  os.homedir(),
  ".myos",
  "MYOS",
  "MEMORY",
  "STATE",
  "settings-merge-snapshot.json",
);

type CliMode =
  | { kind: "output"; path: string }
  | { kind: "check"; path: string };

type CliOptions = {
  systemPath: string;
  userPath: string;
  mode: CliMode;
};

type Difference = {
  path: string;
  expected: any;
  actual: any;
};

type AppendAnnotation = {
  __merge: "append";
  values: any[];
};

function isObjectRecord(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwnKey(value: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isAppendAnnotation(value: any): value is AppendAnnotation {
  return (
    isObjectRecord(value) &&
    value.__merge === "append" &&
    Array.isArray(value.values)
  );
}

function hasInvalidMergeAnnotation(value: any): boolean {
  return isObjectRecord(value) && hasOwnKey(value, "__merge") && !isAppendAnnotation(value);
}

function cloneJsonValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }

  if (isObjectRecord(value)) {
    const clone: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      clone[key] = cloneJsonValue(value[key]);
    }
    return clone;
  }

  return value;
}

export function applyArrayMerge(systemValue: any, userValue: AppendAnnotation): any[] {
  if (systemValue === undefined) {
    return cloneJsonValue(userValue.values);
  }

  if (Array.isArray(systemValue)) {
    return [...cloneJsonValue(systemValue), ...cloneJsonValue(userValue.values)];
  }

  throw new Error(
    '__merge: "append" requires the system value to be an array or absent',
  );
}

export function mergeSettings(system: any, user: any): any {
  if (isAppendAnnotation(user)) {
    return applyArrayMerge(system, user);
  }

  if (hasInvalidMergeAnnotation(user)) {
    throw new Error(
      '__merge annotations must use { "__merge": "append", "values": [...] }',
    );
  }

  if (isObjectRecord(system) && isObjectRecord(user)) {
    const merged: Record<string, any> = {};

    for (const key of Object.keys(system)) {
      if (hasOwnKey(user, key)) {
        merged[key] = mergeSettings(system[key], user[key]);
      } else {
        merged[key] = cloneJsonValue(system[key]);
      }
    }

    for (const key of Object.keys(user)) {
      if (!hasOwnKey(system, key)) {
        merged[key] = mergeSettings(undefined, user[key]);
      }
    }

    return merged;
  }

  return cloneJsonValue(user);
}

/**
 * Expand a LEADING $HOME / ${HOME} / ~ token in a string to the real home dir.
 * Only the prefix is expanded, and only when the token is a whole path segment
 * ($HOMEFOO is left untouched). Returns the string unchanged if no match.
 */
function expandLeadingHome(value: string, home: string): string {
  if (value === "${HOME}") return home;
  if (value.startsWith("${HOME}/")) return home + value.slice("${HOME}".length);
  if (value === "$HOME") return home;
  if (value.startsWith("$HOME/")) return home + value.slice("$HOME".length);
  if (value === "~") return home;
  if (value.startsWith("~/")) return home + value.slice(1);
  return value;
}

/**
 * Expand leading $HOME/${HOME}/~ references in settings `env` values to the real
 * home directory, in place. The Claude Code harness sets `env` values verbatim , 
 * it does NOT expand shell variables: so a shipped value like
 * "$HOME/.myos/MYOS" would be exported literally, making MYOS_DIR resolve
 * to the string "$HOME/…" and breaking every downstream path (worst on fresh
 * installs and Linux). Issues #1404 / #1422.
 */
export function expandEnvHomeReferences(settings: any, home: string): void {
  const env = settings?.env;
  if (!isObjectRecord(env) || !home) return;
  for (const key of Object.keys(env)) {
    const value = env[key];
    if (typeof value === "string") {
      env[key] = expandLeadingHome(value, home);
    }
  }
}

/**
 * Tool names the Claude Code harness accepts in permission rules.
 * Source: core tools always present + the deferred-tool registry surfaced via
 * ToolSearch. When the harness adds or removes a tool, update this set: a rule
 * naming a tool not in here is pruned at merge time (the harness rejects it
 * anyway with "matches no known tool"). MultiEdit was removed from the harness;
 * its absence here is deliberate and is what prunes the dead MultiEdit(...) rules.
 */
export const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "NotebookRead",
  "NotebookEdit", "TodoWrite", "Edit", "Write", "Bash", "BashOutput", "KillShell",
  "Task", "Skill", "SlashCommand", "AskUserQuestion", "Agent", "ToolSearch",
  "EnterPlanMode", "ExitPlanMode", "EnterWorktree", "ExitWorktree", "LSP",
  "Monitor", "RemoteTrigger", "PushNotification", "SendMessage",
  "ListMcpResourcesTool", "ReadMcpResourceTool",
  "TaskCreate", "TaskGet", "TaskList", "TaskOutput", "TaskStop", "TaskUpdate",
  "CronCreate", "CronDelete", "CronList", "TeamCreate", "TeamDelete",
  // Claude Code 2.1.28x additions the myos template may name.
  "Workflow", "Artifact", "ArtifactComments", "ArtifactData", "ScheduleWakeup",
  "SendFeedback", "ReportFindings", "ListAgents",
]);

const PERMISSION_ARRAYS = ["allow", "ask", "deny"] as const;

export type DroppedRule = { array: string; rule: string; reason: string };

/**
 * Returns null when the rule is valid, or a human reason when the harness would
 * reject it. Two rejection classes, matching the harness validator:
 *   1. mcp wildcard not in tool position: `mcp__*` is illegal; a glob is only
 *      allowed AFTER a literal `mcp__<server>__` prefix.
 *   2. Non-mcp rule naming a tool not in KNOWN_TOOL_NAMES (e.g. MultiEdit).
 */
export function permissionRuleRejectionReason(rule: string): string | null {
  if (typeof rule !== "string" || rule.length === 0) {
    return "rule is not a non-empty string";
  }

  if (rule.startsWith("mcp__")) {
    const parts = rule.split("__");
    // Valid shapes: mcp__<server> (every tool of that server) and
    // mcp__<server>__<tool-or-glob>. Any server name is accepted by prefix; the
    // only rejection is an empty or wildcarded server segment.
    if (parts.length < 2 || parts[1].length === 0 || parts[1].includes("*")) {
      return `mcp wildcard "${rule}" is not in tool position: globs are only allowed after a literal mcp__<server>__ prefix`;
    }
    return null;
  }

  const toolName = rule.includes("(") ? rule.slice(0, rule.indexOf("(")) : rule;
  if (!KNOWN_TOOL_NAMES.has(toolName)) {
    return `tool "${toolName}" matches no known tool`;
  }
  return null;
}

/**
 * Removes permission rules the harness would reject from a merged settings
 * object (mutating a clone is the caller's job: this mutates in place on the
 * passed object's permission arrays). Returns the list of dropped rules so the
 * caller can warn loudly. The merged file the harness reads is thereby always
 * free of invalid permission rules, making the "Invalid settings" startup error
 * structurally impossible regardless of what the source files contain.
 */
export function prunePermissionRules(settings: any): DroppedRule[] {
  const dropped: DroppedRule[] = [];
  const permissions = settings?.permissions;
  if (!isObjectRecord(permissions)) {
    return dropped;
  }

  for (const arrayName of PERMISSION_ARRAYS) {
    const rules = permissions[arrayName];
    if (!Array.isArray(rules)) {
      continue;
    }
    permissions[arrayName] = rules.filter((rule: any) => {
      const reason = permissionRuleRejectionReason(rule);
      if (reason !== null) {
        dropped.push({ array: arrayName, rule: String(rule), reason });
        return false;
      }
      return true;
    });
  }

  return dropped;
}

export type PrunedHookRegistration = {
  event: string;
  command: string;
  missingPath: string;
};

/**
 * settings.json is preserved forever across upgrades (installer never touches
 * a user's existing one): so a user who hand-registered a hook that a later
 * myos release deleted keeps that dead registration, and Claude Code fails the
 * command every session. Find hook entries whose "command" string references a
 * file under myosHome that no longer exists on disk, and drop just that entry.
 *
 * Conservative by construction: a command is only a pruning candidate if it
 * names a path INSIDE myosHome (quoted or bare). Non-myos user hooks: a
 * personal script under $HOME, a project-local check, anything outside
 * myosHome: never match the path prefix, so they are never touched, even if
 * that path happens to be missing on this machine.
 */
export function extractMyosHomePaths(command: string, myosHome: string): string[] {
  if (typeof command !== "string" || !command || !myosHome) {
    return [];
  }

  const escapedHome = myosHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathPattern = new RegExp(`['"]?(${escapedHome}\\/[^'"\\s]+)`, "g");
  const found = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pathPattern.exec(command)) !== null) {
    found.add(match[1]);
  }

  return [...found];
}

/**
 * Mutates settings.hooks in place, dropping any { type: "command", ... } hook
 * entry whose command references a now-missing file under myosHome. Matcher
 * groups left with an empty hooks array are dropped too, so the output stays
 * free of dead scaffolding rather than accumulating empty `{ "hooks": [] }`
 * entries release after release.
 */
export function pruneStaleHookRegistrations(
  settings: any,
  myosHome: string,
  protectedIdentities: ReadonlySet<string> = new Set(),
): PrunedHookRegistration[] {
  const pruned: PrunedHookRegistration[] = [];
  const hooks = settings?.hooks;
  if (!isObjectRecord(hooks) || !myosHome) {
    return pruned;
  }

  for (const event of Object.keys(hooks)) {
    const matcherGroups = hooks[event];
    if (!Array.isArray(matcherGroups)) {
      continue;
    }

    for (const group of matcherGroups) {
      if (!isObjectRecord(group) || !Array.isArray(group.hooks)) {
        continue;
      }

      group.hooks = group.hooks.filter((entry: any) => {
        const command = isObjectRecord(entry) ? entry.command : undefined;
        if (typeof command !== "string") {
          return true; // not a shell command hook: nothing for us to verify
        }

        // A registration the CURRENT template asks for is never stale, whatever
        // the filesystem says. Without this, a preview run (--upgrade with no
        // --apply, before the new hook files are copied) would report adding a
        // hook and dropping it again in the same breath.
        const identity = hookIdentity(entry, myosHome);
        if (identity !== null && protectedIdentities.has(identity)) {
          return true;
        }

        for (const candidatePath of extractMyosHomePaths(command, myosHome)) {
          if (!existsSync(candidatePath)) {
            pruned.push({ event, command, missingPath: candidatePath });
            return false;
          }
        }

        return true;
      });
    }

    hooks[event] = matcherGroups.filter(
      (group: any) => !isObjectRecord(group) || !Array.isArray(group.hooks) || group.hooks.length > 0,
    );
  }

  return pruned;
}

export async function parseJsonFileOrThrow(filePath: string): Promise<any> {
  let contents: string;

  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read JSON file ${filePath}: ${formatErrorMessage(error)}`,
    );
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON file ${filePath}: ${formatErrorMessage(error)}`,
    );
  }
}

export function deepEqual(left: any, right: any): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (isObjectRecord(left) || isObjectRecord(right)) {
    if (!isObjectRecord(left) || !isObjectRecord(right)) {
      return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (!hasOwnKey(right, key) || !deepEqual(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function collectDifferences(expected: any, actual: any, currentPath = "$"): Difference[] {
  if (deepEqual(expected, actual)) {
    return [];
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return [{ path: currentPath, expected, actual }];
    }

    const differences: Difference[] = [];
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const itemPath = `${currentPath}[${index}]`;
      if (index >= expected.length) {
        differences.push({ path: itemPath, expected: undefined, actual: actual[index] });
      } else if (index >= actual.length) {
        differences.push({ path: itemPath, expected: expected[index], actual: undefined });
      } else {
        differences.push(...collectDifferences(expected[index], actual[index], itemPath));
      }
    }
    return differences;
  }

  if (isObjectRecord(expected) || isObjectRecord(actual)) {
    if (!isObjectRecord(expected) || !isObjectRecord(actual)) {
      return [{ path: currentPath, expected, actual }];
    }

    const differences: Difference[] = [];
    for (const key of Object.keys(expected)) {
      const keyPath = `${currentPath}.${key}`;
      if (!hasOwnKey(actual, key)) {
        differences.push({ path: keyPath, expected: expected[key], actual: undefined });
      } else {
        differences.push(...collectDifferences(expected[key], actual[key], keyPath));
      }
    }

    for (const key of Object.keys(actual)) {
      if (!hasOwnKey(expected, key)) {
        differences.push({ path: `${currentPath}.${key}`, expected: undefined, actual: actual[key] });
      }
    }

    return differences;
  }

  return [{ path: currentPath, expected, actual }];
}

function validateRoundTripOrThrow(value: any): string {
  let serialized: string;

  try {
    serialized = JSON.stringify(value, null, 2);
  } catch (error) {
    throw new Error(`Failed to stringify merged output: ${formatErrorMessage(error)}`);
  }

  try {
    JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new Error(`Merged output failed JSON round-trip validation: ${formatErrorMessage(error)}`);
  }

  return `${serialized}\n`;
}

function formatDifferenceValue(value: any): string {
  if (value === undefined) {
    return "<missing>";
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return String(value);
  }

  return serialized;
}

function formatDifferences(differences: Difference[]): string {
  return differences
    .map(
      (difference) =>
        `${difference.path}: expected ${formatDifferenceValue(difference.expected)}, actual ${formatDifferenceValue(difference.actual)}`,
    )
    .join("\n");
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// ── Upgrade mode: folding template changes into a settings.json you own ───────
//
// settings.json is written once and preserved forever, which is right (it is
// yours to edit) and leaves one gap: a release that registers a NEW hook never
// reaches an existing install, so the hook silently never runs. A plain
// mergeSettings() cannot close it either: arrays replace with the user side
// winning, so your hooks array wins wholesale and the new entry is dropped.
//
// Upgrade mode is therefore strictly ADDITIVE: anything the template has and
// your file lacks is added (new keys, env values, hook registrations, and
// permission rules absent from all three of your arrays), and nothing you set
// is ever changed or moved. It also drops registrations pointing at hook
// scripts this release deleted, which would otherwise fail on every turn.

export type SettingsChange = {
  kind: "key" | "env" | "hook" | "permission" | "prune";
  detail: string;
};

function sameMatcher(left: any, right: any): boolean {
  return (left ?? null) === (right ?? null);
}

/**
 * How we recognise "this hook is already registered": the path it runs, relative
 * to $MYOS_HOME (so `bun '<home>/hooks/X.ts'` and a hand-edited variant with a
 * different timeout still count as the same registration). Commands naming no
 * path under $MYOS_HOME fall back to the literal command string.
 *
 * Identity is scoped per EVENT, deliberately ignoring the matcher: a user who
 * moved a shipped hook to a different matcher keeps their arrangement instead of
 * getting a second copy. The cost is that a script registered twice under one
 * event with different matchers reads as already present.
 */
export function hookIdentity(entry: any, myosHome: string): string | null {
  if (!isObjectRecord(entry) || typeof entry.command !== "string") {
    return null;
  }
  const paths = extractMyosHomePaths(entry.command, myosHome);
  return paths.length > 0 ? path.relative(myosHome, paths[0]) : `command:${entry.command}`;
}

/**
 * Mutates `existing` in place, adding everything the rendered template has that
 * `existing` lacks. Returns one entry per addition, for the installer to narrate.
 * Never overwrites a value that is already there.
 */
export function foldTemplateAdditions(
  existing: any,
  template: any,
  myosHome: string,
): SettingsChange[] {
  const changes: SettingsChange[] = [];
  if (!isObjectRecord(existing) || !isObjectRecord(template)) {
    return changes;
  }

  for (const key of Object.keys(template)) {
    if (!hasOwnKey(existing, key)) {
      existing[key] = cloneJsonValue(template[key]);
      changes.push({ kind: "key", detail: `${key} (new section)` });
    }
  }

  const templateEnv = template.env;
  const existingEnv = existing.env;
  if (isObjectRecord(templateEnv) && isObjectRecord(existingEnv)) {
    for (const key of Object.keys(templateEnv)) {
      if (!hasOwnKey(existingEnv, key)) {
        existingEnv[key] = cloneJsonValue(templateEnv[key]);
        changes.push({ kind: "env", detail: `env.${key}` });
      }
    }
  }

  const templatePerms = template.permissions;
  const existingPerms = existing.permissions;
  if (isObjectRecord(templatePerms) && isObjectRecord(existingPerms)) {
    // A rule already present in ANY of the user's arrays stays where the user put it:
    // moving a rule from allow to ask is a choice an upgrade must not undo. Only rules
    // the user's file has nowhere are folded in, into the array the template ships
    // them in (the 0.17.0 case: six new Granola read rules reaching existing installs).
    const placed = new Set<string>();
    for (const arrayName of PERMISSION_ARRAYS) {
      const rules = existingPerms[arrayName];
      if (!Array.isArray(rules)) continue;
      for (const rule of rules) {
        if (typeof rule === "string") placed.add(rule);
      }
    }
    for (const arrayName of PERMISSION_ARRAYS) {
      const templateRules = templatePerms[arrayName];
      if (!Array.isArray(templateRules)) continue;
      for (const rule of templateRules) {
        if (typeof rule !== "string" || placed.has(rule)) continue;
        if (!Array.isArray(existingPerms[arrayName])) existingPerms[arrayName] = [];
        existingPerms[arrayName].push(rule);
        placed.add(rule);
        changes.push({ kind: "permission", detail: `permissions.${arrayName}: ${rule}` });
      }
    }
  }

  const templateHooks = template.hooks;
  const existingHooks = existing.hooks;
  if (!isObjectRecord(templateHooks) || !isObjectRecord(existingHooks)) {
    return changes;
  }

  for (const event of Object.keys(templateHooks)) {
    const templateGroups = templateHooks[event];
    if (!Array.isArray(templateGroups)) continue;

    if (!Array.isArray(existingHooks[event])) {
      existingHooks[event] = cloneJsonValue(templateGroups);
      changes.push({ kind: "hook", detail: `hooks.${event} (event not registered)` });
      continue;
    }

    const existingGroups = existingHooks[event];
    const present = new Set<string>();
    for (const group of existingGroups) {
      if (!isObjectRecord(group) || !Array.isArray(group.hooks)) continue;
      for (const entry of group.hooks) {
        const id = hookIdentity(entry, myosHome);
        if (id !== null) present.add(id);
      }
    }

    for (const templateGroup of templateGroups) {
      if (!isObjectRecord(templateGroup) || !Array.isArray(templateGroup.hooks)) continue;

      const missing = templateGroup.hooks.filter((entry: any) => {
        const id = hookIdentity(entry, myosHome);
        return id !== null && !present.has(id);
      });
      if (missing.length === 0) continue;

      const host = existingGroups.find(
        (group: any) =>
          isObjectRecord(group) &&
          Array.isArray(group.hooks) &&
          sameMatcher(group.matcher, templateGroup.matcher),
      );

      if (host !== undefined) {
        host.hooks.push(...cloneJsonValue(missing));
      } else {
        existingGroups.push({
          ...(templateGroup.matcher !== undefined ? { matcher: templateGroup.matcher } : {}),
          hooks: cloneJsonValue(missing),
        });
      }

      for (const entry of missing) {
        const id = hookIdentity(entry, myosHome)!; // filter above kept only non-null ids
        present.add(id);
        const where = templateGroup.matcher !== undefined ? ` [${templateGroup.matcher}]` : "";
        changes.push({ kind: "hook", detail: `hooks.${event}${where}: ${id}` });
      }
    }
  }

  return changes;
}

/** Every hook this release's template registers, as pruning-proof identities. */
export function templateHookIdentities(template: any, myosHome: string): Set<string> {
  const identities = new Set<string>();
  const hooks = template?.hooks;
  if (!isObjectRecord(hooks)) return identities;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObjectRecord(group) || !Array.isArray(group.hooks)) continue;
      for (const entry of group.hooks) {
        const id = hookIdentity(entry, myosHome);
        if (id !== null) identities.add(id);
      }
    }
  }
  return identities;
}

function upgradeUsage(): string {
  return [
    "Usage:",
    "  bun MergeSettings.ts --upgrade --template RENDERED --existing SETTINGS",
    "                       [--apply] [--backup-dir DIR]",
    "",
    "  --template   settings.template.json with __MYOS_HOME__ already substituted",
    "  --existing   the settings.json to fold changes into",
    "  --apply      write the result (default: report what would change)",
    "  --backup-dir copy the current settings.json here before writing",
  ].join("\n");
}

/**
 * Report-or-apply the additive upgrade. Writes ONLY when something actually
 * changes, so a re-run of the same release leaves settings.json byte-identical
 * (both the installer's idempotency contract and CI assert this).
 */
async function runUpgradeCli(argv: string[]): Promise<number> {
  let templatePath: string | undefined;
  let existingPath: string | undefined;
  let backupDir: string | undefined;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const needsValue = (): string => {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${flag}\n${upgradeUsage()}`);
      }
      index += 1;
      return value;
    };

    if (flag === "--upgrade") continue;
    else if (flag === "--template") templatePath = needsValue();
    else if (flag === "--existing") existingPath = needsValue();
    else if (flag === "--backup-dir") backupDir = needsValue();
    else if (flag === "--apply") apply = true;
    else throw new Error(`Unknown flag: ${flag}\n${upgradeUsage()}`);
  }

  if (templatePath === undefined || existingPath === undefined) {
    throw new Error(`--upgrade needs both --template and --existing\n${upgradeUsage()}`);
  }
  if (!existsSync(templatePath) || !existsSync(existingPath)) {
    process.stdout.write("           settings upgrade skipped: template or settings.json absent\n");
    return 0;
  }

  const template = await parseJsonFileOrThrow(templatePath);
  const existing = await parseJsonFileOrThrow(existingPath);
  const myosHome = path.dirname(path.resolve(existingPath));

  const changes = foldTemplateAdditions(existing, template, myosHome);

  for (const pruned of pruneStaleHookRegistrations(existing, myosHome, templateHookIdentities(template, myosHome))) {
    changes.push({
      kind: "prune",
      detail: `hooks.${pruned.event}: dropped ${path.relative(myosHome, pruned.missingPath)} (removed in this release)`,
    });
  }
  for (const dropped of prunePermissionRules(existing)) {
    changes.push({
      kind: "prune",
      detail: `permissions.${dropped.array}: dropped ${dropped.rule} (${dropped.reason})`,
    });
  }

  if (changes.length === 0) {
    process.stdout.write("           settings.json already carries every shipped setting: untouched\n");
    return 0;
  }

  const verb = apply ? "applied" : "would apply";
  process.stdout.write(`           ${changes.length} settings change(s) ${verb}, your values kept as-is:\n`);
  for (const change of changes) {
    process.stdout.write(`             ${change.kind === "prune" ? "-" : "+"} ${change.detail}\n`);
  }

  if (!apply) {
    return 0;
  }

  const outputJson = validateRoundTripOrThrow(existing);

  if (backupDir !== undefined) {
    await mkdir(backupDir, { recursive: true });
    await copyFile(existingPath, path.join(backupDir, "settings.json"));
    process.stdout.write(`           previous settings.json backed up to ${backupDir}/settings.json\n`);
  }

  await writeFile(existingPath, outputJson, "utf8");
  return 0;
}

function usage(): string {
  return [
    "Usage:",
    "  bun MergeSettings.ts --system SYSTEM --user USER --output OUTPUT",
    "  bun MergeSettings.ts --system SYSTEM --user USER --check EXISTING",
    "  bun MergeSettings.ts --upgrade --template RENDERED --existing SETTINGS [--apply]",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  let systemPath: string | undefined;
  let userPath: string | undefined;
  let outputPath: string | undefined;
  let checkPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag === "--system") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --system\n${usage()}`);
      }
      systemPath = value;
      index += 1;
    } else if (flag === "--user") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --user\n${usage()}`);
      }
      userPath = value;
      index += 1;
    } else if (flag === "--output") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --output\n${usage()}`);
      }
      outputPath = value;
      index += 1;
    } else if (flag === "--check") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --check\n${usage()}`);
      }
      checkPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown flag: ${flag}\n${usage()}`);
    }
  }

  if (systemPath === undefined) {
    throw new Error(`Missing required --system flag\n${usage()}`);
  }

  if (userPath === undefined) {
    throw new Error(`Missing required --user flag\n${usage()}`);
  }

  if (outputPath !== undefined && checkPath !== undefined) {
    throw new Error(`Use exactly one of --output or --check\n${usage()}`);
  }

  if (outputPath === undefined && checkPath === undefined) {
    throw new Error(`Missing required --output or --check flag\n${usage()}`);
  }

  return {
    systemPath,
    userPath,
    mode:
      outputPath !== undefined
        ? { kind: "output", path: outputPath }
        : { kind: "check", path: checkPath! }, // checkPath is defined here: lines above throw if both output+check are undefined
  };
}

function countObjectKeys(value: any): number {
  if (isObjectRecord(value)) {
    return Object.keys(value).length;
  }

  return 0;
}

async function runCli(argv: string[]): Promise<number> {
  let options: CliOptions;

  // --upgrade is its own mode (additive template fold), not a variant of the
  // two-layer system+user merge, so it never reaches parseArgs.
  if (argv.includes("--upgrade")) {
    try {
      return await runUpgradeCli(argv);
    } catch (error) {
      process.stderr.write(`${formatErrorMessage(error)}\n`);
      return 1;
    }
  }

  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${formatErrorMessage(error)}\n`);
    return 2;
  }

  // Fresh-install guard (audit 20260702 F-001): the SessionStart maintenance hook
  // invokes this with a system+user settings layer a fresh skill-only install has not
  // established yet. If either input is absent there is nothing to merge: no-op
  // cleanly (exit 0) instead of throwing on the missing input file.
  if (!existsSync(options.systemPath) || !existsSync(options.userPath)) {
    process.stdout.write("MergeSettings: input(s) absent (system/user settings layer not established): nothing to merge\n");
    return 0;
  }

  try {
    const system = await parseJsonFileOrThrow(options.systemPath);
    const user = await parseJsonFileOrThrow(options.userPath);
    const merged = mergeSettings(system, user);

    // The harness exports env values verbatim: expand leading $HOME/${HOME}/~ so
    // MYOS_DIR et al. resolve to real paths on a fresh install (#1404 / #1422).
    expandEnvHomeReferences(merged, process.env.HOME || "");

    const dropped = prunePermissionRules(merged);
    if (dropped.length > 0) {
      process.stderr.write(
        `⚠️  MergeSettings pruned ${dropped.length} invalid permission rule(s) the harness would reject:\n`,
      );
      for (const item of dropped) {
        process.stderr.write(`   - permissions.${item.array}: ${item.rule}  (${item.reason})\n`);
      }
      process.stderr.write(
        `   Fix these at the SOURCE (settings.system.json / settings.user.json) so the warning clears.\n`,
      );
    }

    // settings.json is always written to $MYOS_HOME/settings.json (see install.sh),
    // so the directory holding this run's output/check target IS myosHome: no
    // separate flag needed to know where "under $MYOS_HOME" means.
    const myosHome = path.dirname(path.resolve(options.mode.path));
    const prunedHooks = pruneStaleHookRegistrations(merged, myosHome);
    if (prunedHooks.length > 0) {
      process.stderr.write(
        `⚠️  MergeSettings pruned ${prunedHooks.length} stale hook registration(s): command path no longer exists under ${myosHome}:\n`,
      );
      for (const item of prunedHooks) {
        process.stderr.write(`   - hooks.${item.event}: missing ${item.missingPath}\n     (command: ${item.command})\n`);
      }
      process.stderr.write(
        `   This is expected after an upgrade removes a hook a user (or an old settings.json) still registered. No action needed unless you intended to keep it.\n`,
      );
    }

    const outputJson = validateRoundTripOrThrow(merged);

    if (options.mode.kind === "output") {
      try {
        await writeFile(options.mode.path, outputJson, "utf8");
      } catch (error) {
        throw new Error(
          `Failed to write merged settings to ${options.mode.path}: ${formatErrorMessage(error)}`,
        );
      }

      // Record the merge base for SettingsBackport's three-way diff.
      // Best-effort: a failed snapshot write must never fail the merge itself
      // (backport skips safely when the snapshot is missing/stale).
      try {
        await writeFile(MERGE_SNAPSHOT_PATH, outputJson, "utf8");
      } catch {
        process.stderr.write(`⚠️  could not write merge snapshot to ${MERGE_SNAPSHOT_PATH}\n`);
      }

      process.stdout.write(
        `Merged ${countObjectKeys(system)} system keys + ${countObjectKeys(user)} user overlays into ${path.resolve(options.mode.path)}\n`,
      );
      return 0;
    }

    const existing = await parseJsonFileOrThrow(options.mode.path);
    if (deepEqual(merged, existing)) {
      process.stdout.write(`no differences: ${path.resolve(options.mode.path)}\n`);
      return 0;
    }

    const differences = collectDifferences(merged, existing);
    process.stdout.write(`${formatDifferences(differences)}\n`);
    return 1;
  } catch (error) {
    process.stderr.write(`${formatErrorMessage(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await runCli(Bun.argv.slice(2));
  process.exit(exitCode);
}
