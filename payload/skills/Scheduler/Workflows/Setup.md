# Setup: add a scheduled myos job

Deliverable: one job Harry asked for, added, loaded and verified. Nothing else.

1. **Crontab or Scheduler?** If the job runs no model (a bun script, a publish, a sync),
   it belongs in crontab: write the crontab line for Harry instead and stop.
2. **Pick the kind.** `prompt` for a headless read-only myos run, `command` for a shell
   command that belongs to myos. A prompt that must write anything is not schedulable;
   say so.
3. **Write the prompt so it stands alone.** A headless run has no conversation: name the
   skill and workflow, the files to read, and what the output should look like. Long
   prompts go in a file (`--prompt-file`), read at run time.
4. **Dry run.** `bun ~/.myos/skills/Scheduler/Tools/Scheduler.ts add <name> ... --dry-run`
   and show Harry the schedule and the plist.
5. **Add** on his go (same command without `--dry-run`).
6. **Verify.** `list` shows the job as `loaded`; `cat ~/Library/LaunchAgents/com.myos.<name>.plist`
   reads back; optionally `run <name>` once now and read the log file it names.
