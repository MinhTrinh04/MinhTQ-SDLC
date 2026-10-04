---
description: Mute or unmute Claude Code notifications (toast + Telegram) for 30m/1h/4h/8h, or show/test their state. Thin wrapper over ~/.claude/notify-ctl.cmd; does not touch any code.
---

# /notify

Arguments: `$ARGUMENTS` — exactly one of:
- `snooze <30m|1h|4h|8h> [all|toast|telegram]` — mute notifications for that long. Channel defaults to `all`.
- `on` — cancel the snooze immediately.
- `status` — show whether a snooze is active and whether Telegram is connected.
- `test` — send a test notification to every enabled channel.

If `$ARGUMENTS` is empty, run `status`.

## Steps

1. Run exactly this (PowerShell tool, or Bash with the same command), passing the arguments through unchanged:
   ```
   & "$HOME\.claude\notify-ctl.cmd" $ARGUMENTS
   ```
2. Print the script's output as-is, in one or two lines. Add nothing else.

## Hard rules

- If `~/.claude/notify-ctl.cmd` does not exist, say so and tell the user to run `.\install.cmd -Notify` from the repo root — never recreate the shim by hand.
- `telegram-setup` is NOT available through this command: it asks for a secret bot token interactively. If the user asks for it, tell them to run `& "$HOME\.claude\notify-ctl.cmd" telegram-setup` themselves in a terminal. Never ask for, read, or echo a bot token in this session.
- Never edit `~/.claude/settings.json`, `hooks/notify.config.json` or any state file from this command — the control script is the only thing that writes state.
- Any argument other than the four forms above: print the usage list above and STOP; do not guess.
