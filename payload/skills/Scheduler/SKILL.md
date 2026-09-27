---
name: Scheduler
version: 1.0.0
description: "launchd jobs that fire myos itself on Harry's Mac: a `prompt` job runs a headless read-only `myos -p` and keeps its output as a log, a `command` job runs a shell command that belongs with myos. Missed runs fire on wake; every run leaves start and end heartbeats. Plists are written only on an explicit add, loaded with launchctl bootstrap, labelled com.myos.<name>. No notifications. Plain scripts with no model involved stay in crontab. USE WHEN schedule a myos run, run this prompt every morning, headless myos on a timer, scheduled myos jobs, what myos jobs are scheduled, remove a scheduled job, why didn't the scheduled run happen. NOT FOR plain scripts without a model (crontab), one-off reminders inside a session, or cloud routines."
---

# Scheduler: myos on a timer, on this Mac

## Which scheduler

Harry's rule: **crontab stays for plain scripts where no model is involved**. A crontab
line is easier to read and edit, and his site, ads and sales jobs already live there.
**Scheduler is for jobs that run myos itself**: a headless prompt on a timer, or a
command that belongs to myos (the token dashboard, for example). launchd is the right
tool for those because a job missed while the lid was closed runs once on wake.

## Job kinds

| Kind | What runs | Cost |
|---|---|---|
| `prompt` | `~/.myos/bin/myos -p "<prompt>" --output-format text` in plan mode with Edit, Write and NotebookEdit disallowed | one cold session per run |
| `command` | a shell command, same trust as a crontab line | zero tokens |

A prompt job is **read only by construction**: plan mode, the write tools disallowed,
and in `-p` mode nothing can be approved interactively. It reads and reports; the
report is its log file. Anything that must write stays an interactive session.

## The tool

```bash
S=~/.myos/skills/Scheduler/Tools/Scheduler.ts
bun $S add <name> --description "..." --time 07:30 [--days weekdays|daily|mon,fri] \
  (--prompt "..." | --prompt-file <path> | --command '...') [--model m] [--timeout <min>] [--force] [--dry-run]
bun $S list                    # jobs, schedule, loaded or not, last run
bun $S run <name> [--dry-run]  # run now (what launchd calls); --dry-run prints the argv
bun $S runs [name]             # last 20 heartbeats
bun $S remove <name> [--dry-run]
```

`add --dry-run` prints the plist and changes nothing. A real `add` writes
`~/Library/LaunchAgents/com.myos.<name>.plist` and runs `launchctl bootstrap gui/<uid>`
on it. `remove` runs `launchctl bootout`, deletes the plist and drops the registry
entry; run logs stay.

## Where things live

| What | Path |
|---|---|
| Registry | `~/.myos/MYOS/MEMORY/STATE/scheduler/jobs.json` |
| Heartbeats | `~/.myos/MYOS/MEMORY/OBSERVABILITY/scheduler/runs.jsonl` |
| Each run's output | `~/.myos/MYOS/MEMORY/OBSERVABILITY/scheduler/<job>/<stamp>.log` |
| launchd stdout and stderr | `~/.myos/MYOS/MEMORY/OBSERVABILITY/scheduler/launchd/<job>.{out,err}.log` |

## Workflows

| Intent | Workflow |
|---|---|
| "schedule this prompt", "run X every morning" | `Workflows/Setup.md` |
| "what is scheduled", "remove X", "why didn't it run" | `Workflows/Manage.md` |

## Rules

- **Only on Harry's explicit say-so.** No job is added, replaced or removed unless he
  asked for that job. Show `add --dry-run` first when he wants to see the plist.
- **Plain scripts go to crontab.** If a proposed job has no model in it, say so and
  suggest the crontab line instead.
- **No notifications.** The heartbeat log is the record; `runs <name>` answers "did it run".
- Every add is verified: the plist read back and the job shown in `list`.

## Gotchas

- **The laptop must be awake.** launchd turns "missed while asleep" into "runs on wake";
  a closed laptop all day produces no run.
- **launchd's default PATH finds nothing.** The generated plist carries an explicit PATH
  (bun's dir, `~/.local/bin`, `~/bin`, Homebrew). Hand-written plists that skip this fail
  with "command not found" into a log nobody reads.
- **Headless runs cannot re-authenticate.** MCP connectors work with cached credentials
  until they expire; a prompt that needs one should say in its output when it is missing.
- **Each prompt run is a cold session** that shares rate limits with interactive work.
  Schedule what earns its cost.
