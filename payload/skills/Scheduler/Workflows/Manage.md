# Manage: the jobs that exist, and whether they ran

Deliverable: an honest picture of the scheduled jobs and any change Harry asks for,
executed and verified.

## The picture

```bash
S=~/.myos/skills/Scheduler/Tools/Scheduler.ts
bun $S list          # every job: kind, schedule, loaded or not, last run
bun $S runs <name>   # last 20 heartbeats (start and end, exit, output path)
```

A job in the registry but `NOT LOADED` means the plist was booted out or the machine
changed: re-add it with `add <name> ... --force`. Heartbeat starts without ends mean
runs die mid-flight: read `~/.myos/MYOS/MEMORY/OBSERVABILITY/scheduler/launchd/<name>.err.log`.

## "Why didn't it run"

Work the chain in order and report which link broke:

1. **Was the laptop awake?** No wake, no run. `runs <name>` shows the real firing times.
2. **Is it loaded?** `list` says `NOT LOADED`: re-add with `--force`.
3. **Did it run and fail?** A non-zero exit in the end heartbeat: read the err log, then
   the run's output file.
4. **Connector auth aged out?** `CLAUDE_CONFIG_DIR=~/.myos claude mcp list` shows which
   servers need a login; that is interactive work Harry does once.

## Changes

- Replace: `add <name> --force ...` rewrites the plist and bootstraps it again.
- Remove: `remove <name>` (show `--dry-run` first if Harry wants). Run logs stay; say where.

Every change is checked in `list` before it is reported done.
