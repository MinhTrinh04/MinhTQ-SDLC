---
description: Mute or unmute Claude Code notifications (toast + phone via relay) for 30m/1h/4h/8h, or show/test their state. Thin wrapper over ~/.claude/notify-ctl.cmd; does not touch any code.
---

# /notify

Arguments: `$ARGUMENTS` — exactly one of:
- `snooze <30m|1h|4h|8h> [all|toast|telegram]` — mute notifications for that long. Channel defaults to `all`.
- `on` — cancel the snooze immediately.
- `status` — show whether a snooze is active and whether the relay (phone notifications) is configured.
- `test` — send a test notification to every enabled channel.

If `$ARGUMENTS` is empty, run `status`.

## Steps

1. **Validate `$ARGUMENTS` first, before running anything.** It must match one of the forms above exactly: empty; `status`; `test`; `on`; or `snooze` followed by one of `30m`, `1h`, `4h`, `8h` and optionally one of `all`, `toast`, `telegram`. Anything else — including any extra word or any shell metacharacter such as `;`, `&`, `|`, a backtick, `$(`, quotes or a newline — means: print the usage list above and STOP without running any command.
2. Only then run this with the PowerShell tool (it is PowerShell syntax; do not run it through Bash), passing the validated arguments through unchanged:
   ```
   & "$HOME\.claude\notify-ctl.cmd" $ARGUMENTS
   ```
3. Print the script's output as-is, in one or two lines. Add nothing else.

## Hard rules

- If `~/.claude/notify-ctl.cmd` does not exist, say so and tell the user to run `.\install.cmd -Notify` from the repo root — never recreate the shim by hand.
- `relay-setup` is NOT available through this command: it asks for a secret per-machine relay key interactively. If the user asks for it, tell them to run `& "$HOME\.claude\notify-ctl.cmd" relay-setup` themselves in a terminal. Never ask for, read, or echo a relay key (or any bot token) in this session.
- Never edit `~/.claude/settings.json`, `hooks/notify.config.json` or any state file from this command — the control script is the only thing that writes state.
- Any argument other than the four forms above: print the usage list above and STOP; do not guess. This check is a precondition of Step 2, never a follow-up to it.
