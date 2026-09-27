#!/usr/bin/env bash
# myos installer: sets up ~/.myos from this repo, and upgrades it in place.
#
# Upgrading means: check out the newest vX.Y.Z tag, then ./install.sh (recipe in
# MIGRATION.md). The script works out for itself whether ~/.myos is a fresh
# target or an existing install, and says which before it writes anything.
#
# What an upgrade never touches: MYOS/MEMORY/, MYOS/USER/ (config, projects,
# conventions), _-prefixed skills you added, and the values in your
# settings.json. It DOES add settings the release introduced (new hooks would
# otherwise never run) and it copies anything of yours it is about to replace
# into ~/.myos/upgrade-backups/ first.
#
# ~/.myos is also a Claude Code config dir, and Claude Code's own files sit at
# the same level as ours: .claude.json, history.jsonl, projects/, sessions/ and
# the rest. This installer reads one of them and writes none. The run checks the
# login state before and after and fails if it moved, because losing .claude.json
# is what makes Claude Code ask you to connect again. Use --reset when you want a
# clean install; never rm -rf the directory, which takes all of that with it.
#
# --from-pai copies the memories of the pai install (~/.claude-personal, or
# $MYOS_PAI_SOURCE) in once the payload is in place: WORK ISAs, KNOWLEDGE notes,
# the session registry, and PROJECTS.md split into an index plus one file per
# project. Copy only, idempotent, safe to run again.
#
# Use --dry-run to see the whole plan without writing a byte.
#
# Every step is narrated on STDOUT and mirrored to ~/.myos/install.log; if
# anything fails or hangs, copy that output when reporting the problem.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD="$REPO_DIR/payload"
MYOS_HOME="${MYOS_HOME:-$HOME/.myos}"
LAUNCHER_DIR="$HOME/.local/bin"
DRY_RUN=false
FORCE=false
RESET=false
FROM_PAI=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --force) FORCE=true ;;
    --reset) RESET=true ;;
    --from-pai) FROM_PAI=true ;;
    --help|-h)
      echo "Usage: ./install.sh [--dry-run] [--force] [--reset] [--from-pai]"
      echo "  --dry-run   report exactly what a real run would change, write nothing"
      echo "  --force     install into a directory holding non-myos content anyway"
      echo "  --reset     clear every managed tree first, then install, so files no"
      echo "              release owns any more are gone. Use this instead of"
      echo "              'rm -rf ~/.myos': that also deletes Claude Code's own"
      echo "              state in the config dir, which costs you your login"
      echo "              prompt, your session history and your project list."
      echo "  --from-pai  after installing, copy the pai memories in (WORK ISAs,"
      echo "              KNOWLEDGE, session registry, PROJECTS.md split into an"
      echo "              index plus one file per project). Source: ~/.claude-personal"
      echo "              or \$MYOS_PAI_SOURCE. Copy only; safe to run again."
      echo ""
      echo "Environment: MYOS_HOME (default ~/.myos) is the config dir to install into."
      echo "The launcher is linked at ~/.local/bin/myos."
      exit 0 ;;
    *)
      # Never ignore an unrecognised flag: a mistyped --dry-run would otherwise
      # silently perform the real install.
      echo "ERROR: unknown option '$arg': see ./install.sh --help" >&2
      exit 1 ;;
  esac
done

# ── Fresh install or upgrade? Decided BEFORE anything is created, because the ──
# ── log file below would otherwise become a marker of our own making. ──────────
NEW_VERSION="$(tr -d '[:space:]' < "$REPO_DIR/VERSION")"
INSTALLED_VERSION=""
[[ -f "$MYOS_HOME/MYOS/VERSION" ]] && INSTALLED_VERSION="$(tr -d '[:space:]' < "$MYOS_HOME/MYOS/VERSION")"

# Markers unmistakably OURS. Deliberately not settings.json / skills/ / hooks/:
# every Claude config dir has those, so they prove nothing about who owns this
# directory (another harness has them too).
MARKERS=""
for marker in \
  MYOS/VERSION \
  MYOS/ALGORITHM \
  MYOS/USER/CONFIG/MYOS_CONFIG.toml \
  .install-manifest.json \
  install.log \
  bin/myos
do
  [[ -e "$MYOS_HOME/$marker" ]] && MARKERS="${MARKERS}${MARKERS:+, }$marker"
done

# Content a fresh install would replace or rm -rf. Harmless when it is ours,
# catastrophic when MYOS_HOME was mis-set at somebody else's config dir.
# MYOS/MEMORY and MYOS/USER are user owned trees that may legitimately exist
# before the first install (a tool that wrote a log, a config copied in by
# hand): the installer never replaces them, so they do not count.
AT_RISK=""
for d in skills hooks; do
  [[ -d "$MYOS_HOME/$d" ]] && AT_RISK="${AT_RISK}${AT_RISK:+, }$d/"
done
[[ -e "$MYOS_HOME/settings.json" ]] && AT_RISK="${AT_RISK}${AT_RISK:+, }settings.json"
if [[ -d "$MYOS_HOME/MYOS" ]]; then
  for item in "$MYOS_HOME/MYOS"/* "$MYOS_HOME/MYOS"/.[!.]*; do
    [[ -e "$item" ]] || continue
    case "$(basename "$item")" in
      MEMORY|USER) ;;
      *) AT_RISK="${AT_RISK}${AT_RISK:+, }MYOS/$(basename "$item")" ;;
    esac
  done
fi

# ── Claude Code's own state in this config dir ────────────────────────────────
# $MYOS_HOME is a Claude Code config dir as well as a myos install, and Claude
# Code keeps its state at the same level as ours. This installer creates,
# replaces and deletes nothing on this list, and --reset below is checked
# against it before it removes a thing.
#
# Why it earns a named list: .claude.json is where Claude Code records
# hasCompletedOnboarding, and that single flag is what decides whether the next
# interactive start runs onboarding and asks you to connect to Claude. The OAuth
# tokens are somewhere else entirely (macOS Keychain, service name
# "Claude Code-credentials-<first 8 hex of sha256 of the config dir path>"), so
# deleting this file never loses the tokens. It just makes Claude Code forget it
# has any, and you pay for that with a connect prompt you did not need.
CONFIG_STATE=".claude.json .claude.json.backup .credentials.json history.jsonl
projects sessions shell-snapshots file-history todos backups statsig plugins
session-env policy-limits.json remote-settings.json"

# What --reset clears before installing, by name. Never $MYOS_HOME itself.
# skills/ and MYOS/ are handled separately below, because parts of both are
# yours: user-owned _-skills, MYOS/MEMORY and MYOS/USER.
RESET_REMOVE="agents commands hooks node_modules bun.lock .install-manifest.json"

if [[ -n "$MARKERS" ]]; then
  MODE="upgrade"
else
  MODE="fresh"
  if [[ -n "$AT_RISK" ]] && ! $FORCE; then
    echo "ERROR: $MYOS_HOME holds $AT_RISK but nothing that identifies it as a myos install." >&2
    echo "       Installing would replace that. This normally means MYOS_HOME points at" >&2
    echo "       another Claude config dir (~/.claude or another harness)." >&2
    echo "" >&2
    echo "       Install somewhere else:  MYOS_HOME=~/.myos ./install.sh" >&2
    echo "       Or, if you are sure:     ./install.sh --force" >&2
    exit 1
  fi
fi

# How this release relates to what is already there.
VERSION_NOTE=""
if [[ "$MODE" == "upgrade" ]]; then
  if [[ -z "$INSTALLED_VERSION" ]]; then
    VERSION_NOTE="installed version unknown → $NEW_VERSION"
  elif [[ "$INSTALLED_VERSION" == "$NEW_VERSION" ]]; then
    VERSION_NOTE="$NEW_VERSION reinstalled (same version)"
  elif [[ "$(printf '%s\n%s\n' "$INSTALLED_VERSION" "$NEW_VERSION" | sort -V | head -1)" == "$NEW_VERSION" ]]; then
    VERSION_NOTE="$INSTALLED_VERSION → $NEW_VERSION (DOWNGRADE: older files will replace newer ones)"
  else
    VERSION_NOTE="$INSTALLED_VERSION → $NEW_VERSION"
  fi
fi

# ── Logging: everything below goes to STDOUT and ~/.myos/install.log ─────────
if $DRY_RUN; then
  # A dry run must not even create $MYOS_HOME, so its log goes to a temp file.
  LOG="$(mktemp "${TMPDIR:-/tmp}/myos-install-dryrun.XXXXXX")"
else
  mkdir -p "$MYOS_HOME"
  LOG="$MYOS_HOME/install.log"
fi
exec > >(tee "$LOG") 2>&1

START_TS=$(date +%s)
STEP="(preflight)"
step() { STEP="$1"; printf '[%s] %s\n' "$(date +%H:%M:%S)" "$1"; }
note() { printf '           %s\n' "$1"; }
trap 'echo ""; echo "❌ INSTALL FAILED during: $STEP (line $LINENO, exit $?)"; echo "   Log saved to: $LOG: copy the output above when reporting."' ERR

echo "myos installer $NEW_VERSION → $MYOS_HOME"
echo "log: $LOG"
if [[ "$MODE" == "upgrade" ]]; then
  echo "mode: UPGRADE: $VERSION_NOTE"
  note "recognised by: $MARKERS"
  note "kept as-is: MYOS/MEMORY, MYOS/USER, your own _-skills, the values in settings.json"
else
  echo "mode: FRESH INSTALL: nothing myos-shaped in $MYOS_HOME yet"
  if [[ -n "$AT_RISK" ]]; then
    note "WARNING: --force given, so $AT_RISK will be replaced even though it is not ours"
  fi
fi
$DRY_RUN && echo "      (DRY RUN: reporting only, nothing will be written)"
echo ""

# A literal "${HOME}" or "$HOME" directory anywhere under the repo is a shell-
# expansion bug artifact (some tool substituted a real path with the variable
# name instead of its value while cwd sat inside this repo): never real
# content, never safe to ship. Refuse to install rather than copy garbage.
for stray_name in '${HOME}' '$HOME'; do
  for stray_root in "$REPO_DIR" "$PAYLOAD"; do
    if [[ -e "$stray_root/$stray_name" ]]; then
      echo "  ERROR: literal '$stray_root/$stray_name' directory found: this is a shell-expansion" >&2
      echo "         artifact, not real content. Delete it (rm -rf) and re-run install.sh." >&2
      exit 1
    fi
  done
done

step "[1/9] Preflight: checking bun, claude and recommended tools"
command -v bun >/dev/null || { echo "  ERROR: myos needs bun (https://bun.sh). Install it and re-run."; exit 1; }
note "bun $(bun --version) ✓"
if command -v claude >/dev/null; then note "claude found ✓"; else note "WARNING: 'claude' not on PATH: install Claude Code before running myos"; fi
if command -v rtk >/dev/null; then
  note "rtk found ✓: Bash output compression active (ContextReduction hook)"
else
  note "RECOMMENDED: rtk is not installed. It cuts 60-90% of the tokens shell output"
  note "costs your sessions, and myos uses it automatically once present:  brew install rtk"
fi

# ── Login state, read before and after, so a regression cannot pass quietly ───
# Reports the two fields in .claude.json that decide whether you get asked to
# connect to Claude again: "login:onboarded", "login:pending", "nologin:pending",
# "absent" (no file yet) or "unreadable". Nothing else is read out of that file.
auth_state() {
  local f="$MYOS_HOME/.claude.json"
  [[ -f "$f" ]] || { printf 'absent'; return 0; }
  MYOS_AUTH_FILE="$f" bun -e '
    try {
      const c = JSON.parse(require("fs").readFileSync(process.env.MYOS_AUTH_FILE, "utf8"));
      process.stdout.write((c.oauthAccount ? "login" : "nologin") + ":" +
        (c.hasCompletedOnboarding === true ? "onboarded" : "pending"));
    } catch { process.stdout.write("unreadable"); }
  ' 2>/dev/null || printf 'unreadable'
  return 0
}

# A regression is losing something we had: the file itself, a login, or a
# completed onboarding. Anything else (gaining any of those, or no file at either
# end) passes, because a myos session running alongside this install may
# legitimately rewrite the file while we work.
auth_regressed() {
  case "$1" in absent) return 1 ;; esac      # nothing was there to lose
  case "$2" in absent) return 0 ;; esac      # ...but there was, and now it is gone
  case "$1" in unreadable) return 1 ;; esac  # cannot compare what we could not read
  case "$2" in unreadable) return 0 ;; esac  # it parsed before this run, not after
  case "$1" in login:*)     case "$2" in nologin:*) return 0 ;; esac ;; esac
  case "$1" in *:onboarded) case "$2" in *:pending) return 0 ;; esac ;; esac
  return 1
}

AUTH_BEFORE="$(auth_state)"
case "$AUTH_BEFORE" in
  absent)     note "login state: none yet in $MYOS_HOME/.claude.json (first run will ask you to connect)" ;;
  unreadable) note "login state: $MYOS_HOME/.claude.json unreadable, so leaving it alone, as always" ;;
  *)          note "login state: $AUTH_BEFORE (this run must leave it exactly as it is)" ;;
esac

# Where anything of yours that is about to be replaced gets copied first. Created
# lazily by UpgradePlan.ts: an upgrade with nothing at risk leaves no directory.
BACKUP_DIR="$MYOS_HOME/upgrade-backups/$(date +%Y%m%d-%H%M%S)-${INSTALLED_VERSION:-unknown}-to-$NEW_VERSION"

step "[2/9] What this run will change"
# Read-only comparison of this release against what is installed. On an upgrade
# it also copies anything of yours it is about to replace into $BACKUP_DIR, so a
# failure here has to stop the run: proceeding would replace files unprotected.
# On a fresh install there is nothing to protect, so it is only advisory.
run_plan() {
  if $DRY_RUN; then
    bun "$REPO_DIR/Tools/UpgradePlan.ts" --repo "$REPO_DIR" --home "$MYOS_HOME" </dev/null
  else
    bun "$REPO_DIR/Tools/UpgradePlan.ts" --repo "$REPO_DIR" --home "$MYOS_HOME" --backup-dir "$BACKUP_DIR" </dev/null
  fi
}
if ! run_plan; then
  if [[ "$MODE" == "upgrade" ]]; then
    echo "  ERROR: could not work out what this upgrade would change, so nothing was written." >&2
    echo "         Your install is untouched. Report the output above." >&2
    exit 1
  fi
  note "WARNING: change plan unavailable: continuing, since a fresh install has nothing to preserve"
fi

# ── --reset ───────────────────────────────────────────────────────────────────
# One path per line, relative to $MYOS_HOME. Never $MYOS_HOME itself, which is
# the whole point of the flag.
reset_targets() {
  local t name
  for t in $RESET_REMOVE; do
    [[ -e "$MYOS_HOME/$t" ]] && echo "$t"
  done
  # Skills without a leading underscore: this release's, and any a past release
  # owned and this one dropped. Underscore means yours, so those stay.
  if [[ -d "$MYOS_HOME/skills" ]]; then
    for t in "$MYOS_HOME/skills"/*/; do
      [[ -d "$t" ]] || continue
      name="$(basename "$t")"
      [[ "$name" == _* ]] || echo "skills/$name"
    done
  fi
  # The system dir, except your memory and your config.
  if [[ -d "$MYOS_HOME/MYOS" ]]; then
    for t in "$MYOS_HOME/MYOS"/*; do
      [[ -e "$t" ]] || continue
      name="$(basename "$t")"
      case "$name" in MEMORY|USER) continue ;; esac
      echo "MYOS/$name"
    done
  fi
}

# Checked before every removal, real run and dry run alike. A typo in
# RESET_REMOVE that named .claude.json would cost a login, so it is not enough
# to have written the list carefully once.
reset_guard() {
  local target keep
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    case "$target" in
      /*|*..*)
        echo "  ERROR: --reset produced the unsafe path '$target'. Refusing, nothing removed." >&2
        exit 1 ;;
    esac
    for keep in $CONFIG_STATE; do
      if [[ "$target" == "$keep" ]]; then
        echo "  ERROR: --reset would remove '$target', which belongs to Claude Code, not to" >&2
        echo "         myos. Refusing, nothing removed. Report this with $LOG." >&2
        exit 1
      fi
    done
  done < <(reset_targets)
}

reset_kept_note() {
  note "kept: MYOS/MEMORY, MYOS/USER, your own _-skills, settings.json, and every file"
  note "      Claude Code owns here (.claude.json, history.jsonl, projects/, sessions/, ...)"
}

reset_report() {
  reset_guard
  local target count=0
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    count=$((count + 1))
    note "  would remove $target"
  done < <(reset_targets)
  [[ "$count" -eq 0 ]] && note "nothing to clear yet"
  reset_kept_note
}

reset_run() {
  reset_guard
  local target count=0
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    rm -rf "${MYOS_HOME:?}/$target"
    count=$((count + 1))
  done < <(reset_targets)
  if [[ "$count" -eq 0 ]]; then
    note "nothing to clear, so this is an ordinary install"
  else
    note "$count managed path(s) removed, and reinstalled from this release below"
  fi
  reset_kept_note
}

# The user scaffold: every file under payload/MYOS/USER, copied only when the
# target is absent. Prints one "rel" per file that WOULD be created.
scaffold_missing() {
  local src rel
  [[ -d "$PAYLOAD/MYOS/USER" ]] || return 0
  while IFS= read -r src; do
    rel="${src#"$PAYLOAD/MYOS/USER/"}"
    [[ -e "$MYOS_HOME/MYOS/USER/$rel" ]] || echo "$rel"
  done < <(find "$PAYLOAD/MYOS/USER" -type f ! -name '.DS_Store' | LC_ALL=C sort)
}

# The first-install trial record: review dates the trial promises. MYOS_INSTALL_TODAY
# (YYYY-MM-DD) pins "today" for tests.
trial_json() {
  MYOS_TODAY="${MYOS_INSTALL_TODAY:-}" bun -e '
    const base = process.env.MYOS_TODAY ? new Date(process.env.MYOS_TODAY + "T12:00:00") : new Date();
    const day = (n) => {
      const d = new Date(base); d.setDate(d.getDate() + n);
      const p = (x) => String(x).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    process.stdout.write(JSON.stringify({
      started: day(0), gate_review_due: day(14), doctrine_review_due: day(30),
      gate_review_done: false, doctrine_review_done: false,
    }, null, 2) + "\n");'
}

migrate_env() {
  env CLAUDE_CONFIG_DIR="$MYOS_HOME" MYOS_DIR="$MYOS_HOME/MYOS" "$@"
}

if $DRY_RUN; then
  if $RESET; then
    step "[dry run] --reset"
    reset_report
  fi
  # Preview the settings fold too, then stop before the first write. Hook pruning
  # is judged against the hooks currently on disk, so a hook this release DELETES
  # still looks present here; the real run reports it.
  if [[ -f "$MYOS_HOME/settings.json" ]]; then
    step "[dry run] settings.json"
    RENDERED="$(mktemp "${TMPDIR:-/tmp}/myos-settings.XXXXXX")"
    sed "s|__MYOS_HOME__|$MYOS_HOME|g" "$PAYLOAD/settings.template.json" > "$RENDERED"
    bun "$PAYLOAD/MYOS/TOOLS/MergeSettings.ts" --upgrade --template "$RENDERED" --existing "$MYOS_HOME/settings.json" </dev/null
    rm -f "$RENDERED"
  fi
  step "[dry run] Your space (created only when absent)"
  MISSING="$(scaffold_missing)"
  if [[ -n "$MISSING" ]]; then
    while IFS= read -r rel; do note "would create MYOS/USER/$rel"; done <<< "$MISSING"
  fi
  [[ -f "$MYOS_HOME/MYOS/USER/CONFIG/MYOS_CONFIG.toml" ]] || note "would create MYOS/USER/CONFIG/MYOS_CONFIG.toml"
  [[ -f "$MYOS_HOME/MYOS/USER/CONFIG/trial.json" ]] || note "would create MYOS/USER/CONFIG/trial.json"
  note "would link $LAUNCHER_DIR/myos → $MYOS_HOME/bin/myos"
  if $FROM_PAI; then
    step "[dry run] --from-pai"
    if [[ -f "$MYOS_HOME/MYOS/VERSION" ]]; then
      migrate_env bun "$PAYLOAD/MYOS/TOOLS/MigrateMemory.ts" --from-pai --dry-run </dev/null \
        || note "migration preview failed (see above); a real run would report the same"
    else
      note "a real run copies the pai memories in once the payload is installed"
    fi
  fi
  echo ""
  echo "✅ Dry run complete: $MYOS_HOME untouched. Re-run without --dry-run to apply."
  exit 0
fi

if $RESET; then
  step "[reset] Clearing managed trees before installing"
  reset_run
fi

step "[3/9] Skills → $MYOS_HOME/skills ($(find "$PAYLOAD/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ') shipped)"
mkdir -p "$MYOS_HOME/skills"
REPLACED_SKILLS=0
for skill_dir in "$PAYLOAD/skills"/*/; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  if [[ "$name" == _* ]]; then
    # Shipped _-skills refresh additively: user files preserved.
    mkdir -p "$MYOS_HOME/skills/$name"
    cp -R "${skill_dir%/}/." "$MYOS_HOME/skills/$name/"
    note "refreshed (additive, user files kept): $name"
  else
    rm -rf "${MYOS_HOME:?}/skills/$name"
    cp -R "$skill_dir" "$MYOS_HOME/skills/$name"
    REPLACED_SKILLS=$((REPLACED_SKILLS + 1))
  fi
done
note "$REPLACED_SKILLS shipped skills replaced with this release's copy"
note "user-owned _-skills other than shipped ones: never touched"

step "[4/9] Agents, commands, hooks"
mkdir -p "$MYOS_HOME/agents" "$MYOS_HOME/commands"
for f in "$PAYLOAD/agents/"*.md; do [[ -f "$f" ]] && cp "$f" "$MYOS_HOME/agents/"; done
for f in "$PAYLOAD/commands/"*.md; do [[ -f "$f" ]] && cp "$f" "$MYOS_HOME/commands/"; done
rm -rf "${MYOS_HOME:?}/hooks"
cp -R "$PAYLOAD/hooks" "$MYOS_HOME/hooks"
note "$(find "$MYOS_HOME/agents" -name '*.md' | wc -l | tr -d ' ') agent files, $(find "$MYOS_HOME/hooks" -maxdepth 1 -name '*.hook.*' | wc -l | tr -d ' ') hooks (tree copied whole, README included) ✓"

step "[5/9] System dir → $MYOS_HOME/MYOS (MEMORY and USER untouched)"
mkdir -p "$MYOS_HOME/MYOS"
cp "$REPO_DIR/VERSION" "$MYOS_HOME/MYOS/VERSION"
SYSTEM_ITEMS=""
for item in "$PAYLOAD/MYOS"/*; do
  [[ -e "$item" ]] || continue
  name="$(basename "$item")"
  case "$name" in MEMORY|USER) continue ;; esac
  rm -rf "${MYOS_HOME:?}/MYOS/$name"
  cp -R "$item" "$MYOS_HOME/MYOS/$name"
  SYSTEM_ITEMS="${SYSTEM_ITEMS}${SYSTEM_ITEMS:+, }$name"
done
note "VERSION, $SYSTEM_ITEMS ✓"

# cp -R happily copies Finder's .DS_Store noise along with everything else:
# strip it from every tree we just wrote so it never lingers in $MYOS_HOME.
find "$MYOS_HOME/skills" "$MYOS_HOME/agents" "$MYOS_HOME/commands" "$MYOS_HOME/hooks" "$MYOS_HOME/MYOS" \
  -path "$MYOS_HOME/MYOS/MEMORY" -prune -o -path "$MYOS_HOME/MYOS/USER" -prune -o \
  -name '.DS_Store' -exec rm -f {} + 2>/dev/null || true

step "[6/9] CLAUDE.md, memory dirs, your space"
[[ -f "$PAYLOAD/CLAUDE.md" ]] && cp "$PAYLOAD/CLAUDE.md" "$MYOS_HOME/CLAUDE.md"
[[ -f "$REPO_DIR/docs/INVENTORY.md" ]] && cp "$REPO_DIR/docs/INVENTORY.md" "$MYOS_HOME/INVENTORY.md"
[[ -f "$PAYLOAD/HOME_README.md" ]] && cp "$PAYLOAD/HOME_README.md" "$MYOS_HOME/README.md"
cp "$PAYLOAD/package.json" "$MYOS_HOME/package.json"
for d in WORK KNOWLEDGE STATE SKILLS OBSERVABILITY OBSERVABILITY/TOKENS; do
  mkdir -p "$MYOS_HOME/MYOS/MEMORY/$d"
done
note "MEMORY/{WORK,KNOWLEDGE,STATE,SKILLS,OBSERVABILITY,OBSERVABILITY/TOKENS} ✓ (existing content kept)"

# MYOS/USER is yours: every file here is written only when it is absent, on a
# fresh install and an upgrade alike, and nothing here is ever overwritten.
mkdir -p "$MYOS_HOME/MYOS/USER/CONFIG" "$MYOS_HOME/MYOS/USER/PROJECTS"
SCAFFOLDED=0
while IFS= read -r rel; do
  [[ -n "$rel" ]] || continue
  mkdir -p "$(dirname "$MYOS_HOME/MYOS/USER/$rel")"
  cp "$PAYLOAD/MYOS/USER/$rel" "$MYOS_HOME/MYOS/USER/$rel"
  SCAFFOLDED=$((SCAFFOLDED + 1))
  note "created MYOS/USER/$rel"
done < <(scaffold_missing)
if [[ ! -f "$MYOS_HOME/MYOS/USER/CONFIG/MYOS_CONFIG.toml" ]]; then
  cp "$PAYLOAD/MYOS/TOOLS/MYOS_CONFIG.toml.example" "$MYOS_HOME/MYOS/USER/CONFIG/MYOS_CONFIG.toml"
  note "created MYOS/USER/CONFIG/MYOS_CONFIG.toml (Harry, Europe/Zurich, gates log only)"
else
  note "existing MYOS_CONFIG.toml kept"
fi
if [[ ! -f "$MYOS_HOME/MYOS/USER/CONFIG/trial.json" ]]; then
  trial_json > "$MYOS_HOME/MYOS/USER/CONFIG/trial.json"
  note "created MYOS/USER/CONFIG/trial.json (gate review in 14 days, doctrine review in 30)"
else
  note "existing trial.json kept"
fi
[[ "$SCAFFOLDED" -eq 0 ]] && note "every scaffold file already present: nothing of yours touched"

step "[7/9] settings.json"
if [[ ! -f "$MYOS_HOME/settings.json" ]]; then
  sed "s|__MYOS_HOME__|$MYOS_HOME|g" "$PAYLOAD/settings.template.json" > "$MYOS_HOME/settings.json"
  note "wrote settings.json (first install)"
else
  # Your file, your values: but a release that registers a new hook has to reach
  # you somehow, or that hook silently never runs. So: add what is missing, change
  # nothing you set, drop registrations whose script this release deleted, and
  # write only if any of that applies (a no-op run leaves the file byte-identical).
  RENDERED="$(mktemp "${TMPDIR:-/tmp}/myos-settings.XXXXXX")"
  sed "s|__MYOS_HOME__|$MYOS_HOME|g" "$PAYLOAD/settings.template.json" > "$RENDERED"
  bun "$PAYLOAD/MYOS/TOOLS/MergeSettings.ts" --upgrade \
    --template "$RENDERED" --existing "$MYOS_HOME/settings.json" \
    --apply --backup-dir "$BACKUP_DIR" </dev/null \
    || note "WARNING: settings fold failed: your settings.json is unchanged. Compare by hand: payload/settings.template.json"
  rm -f "$RENDERED"
fi

step "[8/9] Runtime dependencies (small: one 'yaml' package)"
( cd "$MYOS_HOME" && bun install </dev/null ) || note "WARNING: bun install failed: hooks needing 'yaml' won't run until you: cd $MYOS_HOME && bun install"

step "[9/9] Launcher"
mkdir -p "$MYOS_HOME/bin"
cp "$REPO_DIR/bin/myos" "$MYOS_HOME/bin/myos"
chmod +x "$MYOS_HOME/bin/myos"
mkdir -p "$LAUNCHER_DIR"
if [[ -e "$LAUNCHER_DIR/myos" && ! -L "$LAUNCHER_DIR/myos" ]]; then
  note "WARNING: $LAUNCHER_DIR/myos exists and is not a symlink, so it was left alone."
  note "         Point it at $MYOS_HOME/bin/myos yourself if that is what you want."
else
  ln -sfn "$MYOS_HOME/bin/myos" "$LAUNCHER_DIR/myos"
  note "launcher linked: $LAUNCHER_DIR/myos → $MYOS_HOME/bin/myos"
fi
case ":$PATH:" in
  *":$LAUNCHER_DIR:"*) ;;
  *) note "PATH: $LAUNCHER_DIR is not on your PATH. Add to ~/.zshrc:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

# Fingerprint every managed file as we just wrote it. This is what lets the NEXT
# upgrade tell "the release changed this" from "the user changed this" instead of
# treating every difference as precious.
bun "$REPO_DIR/Tools/UpgradePlan.ts" --repo "$REPO_DIR" --home "$MYOS_HOME" --write-manifest "$NEW_VERSION" </dev/null \
  || note "WARNING: could not record the install manifest: the next upgrade will back up more than it needs to"

MIGRATE_FAILED=false
if $FROM_PAI; then
  step "[from-pai] Copying the pai memories in (copy only, safe to re-run)"
  if migrate_env bun "$MYOS_HOME/MYOS/TOOLS/MigrateMemory.ts" --from-pai </dev/null; then
    note "done. The pai install was not modified."
  else
    MIGRATE_FAILED=true
    note "WARNING: the migration failed (see above). Nothing was removed on either side."
    note "Re-run later: ./install.sh --from-pai  (or: CLAUDE_CONFIG_DIR=$MYOS_HOME bun $MYOS_HOME/MYOS/TOOLS/MigrateMemory.ts --from-pai)"
  fi
fi

echo ""
echo "Dependency audit (which capabilities work on this machine):"
( cd "$MYOS_HOME" && migrate_env bun MYOS/TOOLS/DependencyAudit.ts --missing </dev/null ) || note "dependency audit skipped (non-fatal)"

# ── The login state has to be exactly as we found it ──────────────────────────
# Nothing above writes .claude.json, so this can only fail if that stops being
# true. "Upgrades never log you out" is worth a gate rather than a promise.
AUTH_AFTER="$(auth_state)"
if auth_regressed "$AUTH_BEFORE" "$AUTH_AFTER"; then
  echo ""
  echo "❌ LOGIN STATE LOST DURING THIS RUN: $AUTH_BEFORE → $AUTH_AFTER"
  echo "   $MYOS_HOME/.claude.json belongs to Claude Code and this installer never writes"
  echo "   it, so a change here is a bug in install.sh. Report it with $LOG."
  echo "   Your files did install. Your tokens are unaffected: they live in the macOS"
  echo "   Keychain, not in that file, so the cost is one connect prompt on the next run."
  exit 1
fi

ELAPSED=$(( $(date +%s) - START_TS ))
echo ""
if [[ "$MODE" == "upgrade" ]]; then
  echo "✅ myos upgraded to $NEW_VERSION in ${ELAPSED}s ($VERSION_NOTE)."
  echo "   Login state unchanged by this run: $AUTH_BEFORE"
  [[ -d "$BACKUP_DIR" ]] && echo "   Files of yours that were replaced: $BACKUP_DIR"
  echo "   Next:"
  echo "   1. Restart any running myos session: hooks and skills are loaded at startup"
  echo "   2. Optional: bun $MYOS_HOME/MYOS/TOOLS/Doctor.ts   (checks your toolchain and config)"
  case "$AUTH_AFTER" in
    *:pending)
      echo ""
      echo "   One thing to expect, pending from before this run: this config dir has never"
      echo "   finished Claude Code's onboarding (no hasCompletedOnboarding in .claude.json),"
      echo "   so your next interactive start asks you to connect to Claude, once. The"
      echo "   upgrade did not cause that and your tokens are already in the macOS Keychain." ;;
  esac
else
  echo "✅ myos $NEW_VERSION installed in ${ELAPSED}s. Next:"
  echo "   1. Run: myos   (from a project dir, not from \$HOME)"
  if [[ "$AUTH_AFTER" == "absent" || "$AUTH_AFTER" == *:pending ]]; then
    echo "      The first run asks you to connect to Claude, once, because auth is per config"
    echo "      dir and this one has no login recorded yet."
  fi
  $FROM_PAI || echo "   2. Bring the pai memories over:  ./install.sh --from-pai"
  echo "   3. Optional: bun $MYOS_HOME/MYOS/TOOLS/Doctor.ts   (checks your toolchain and config)"
fi
if $MIGRATE_FAILED; then
  echo ""
  echo "❌ The install succeeded but --from-pai did not: see the migration output above."
  exit 1
fi
