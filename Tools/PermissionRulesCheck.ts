#!/usr/bin/env bun
/**
 * PermissionRulesCheck: release gate for payload/settings.template.json permission rules.
 *
 * Born from a real miss (2026-07-29): myos 0.1.0 through 0.2.1 shipped NO permissions block at
 * all, so every tool call the Safety.hook.ts approver deferred on fell through to a prompt. When
 * the block was finally lifted from LifeOS, two silent-failure modes showed up immediately:
 *
 *   1. MergeSettings.prunePermissionRules DROPS any rule whose tool is not in KNOWN_TOOL_NAMES.
 *      A `MultiEdit(...)`, `Artifact(...)` or `Workflow(...)` rule disappears at install time with
 *      the warning buried in installer output. The rule looks shipped and does nothing.
 *
 *   2. The harness IGNORES `Write(<path>)` rules for file permission checks and prints a warning
 *      per rule on every boot. `Edit(<path>)` is the one that matches, and it covers all
 *      file-editing tools including Write. This one is worse than cosmetic: a
 *      `deny: ["Write(/etc/**)"]` reads as protection and provides none. LifeOS still ships the
 *      inert Write() variants; myos deliberately does not.
 *
 * Both are invisible at review time, which is exactly what a gate is for.
 *
 * EXIT CODES: 0 = clean, 1 = at least one bad rule (release blocked).
 */

import { readFileSync } from "fs";

// Defaults to the shipped template; takes a path so the gate itself can be tested against
// deliberately-broken fixtures (a gate nobody has watched fail is not a gate).
const TEMPLATE =
  process.argv[2] ?? new URL("../payload/settings.template.json", import.meta.url).pathname;
const INSTALLED_MERGER = new URL("../payload/MYOS/TOOLS/MergeSettings.ts", import.meta.url).pathname;

const { permissionRuleRejectionReason } = (await import(INSTALLED_MERGER)) as {
  permissionRuleRejectionReason: (rule: string) => string | null;
};

const PERMISSION_ARRAYS = ["allow", "ask", "deny"] as const;

let hits = 0;
function fail(where: string, rule: string, why: string) {
  console.error(`BAD RULE ${where}: ${rule}: ${why}`);
  hits++;
}

const settings = JSON.parse(readFileSync(TEMPLATE, "utf8"));
const permissions = settings?.permissions;

if (!permissions || typeof permissions !== "object") {
  console.error(
    "BAD TEMPLATE: payload/settings.template.json has no `permissions` block. " +
      "Shipping without one means every deferred tool call prompts the PM (the 0.1.0–0.2.1 regression).",
  );
  process.exit(1);
}

let total = 0;
for (const arrayName of PERMISSION_ARRAYS) {
  const rules = permissions[arrayName];
  if (!Array.isArray(rules)) continue;
  for (const rule of rules) {
    total++;
    const where = `permissions.${arrayName}`;

    if (typeof rule !== "string" || rule.length === 0) {
      fail(where, String(rule), "not a non-empty string");
      continue;
    }

    // (1) would the installer silently prune it?
    const reason = permissionRuleRejectionReason(rule);
    if (reason !== null) {
      fail(where, rule, `${reason} (MergeSettings would silently drop this at install)`);
    }

    // (2) is it an inert Write(<path>) rule the harness ignores?
    if (/^Write\s*\(/.test(rule)) {
      fail(
        where,
        rule,
        "the harness ignores Write(<path>) for file permission checks and warns at boot: " +
          `use ${rule.replace(/^Write\s*\(/, "Edit(")} instead (Edit covers all file-editing tools)`,
      );
    }
  }
}

// defaultMode is the difference between "the allowlist handles simple commands" and "the model
// also judges the compound shapes prefix rules cannot express". Losing it silently re-noisifies.
if (permissions.defaultMode !== "auto") {
  console.error(
    `BAD TEMPLATE: permissions.defaultMode is ${JSON.stringify(permissions.defaultMode)}, expected "auto". ` +
      "Prefix rules cannot express compound/heredoc commands; auto mode is what keeps those from prompting.",
  );
  hits++;
}

if (hits > 0) {
  console.error(`\n❌ ${hits} bad permission rule(s) in ${total} checked. Release blocked.`);
  process.exit(1);
}
console.log(`✅ PermissionRulesCheck: ${total} permission rules valid, defaultMode=auto.`);
