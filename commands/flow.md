---
description: Run the full flow pipeline (brainstorm → plan → execute → verify → review) for one requirement, from Jira, a file, or plain text.
---

# /flow

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + acceptance criteria). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the requirement.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available on the machine, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the requirement.

Optionally, combine with a trailing `--auto-approve` flag (e.g. `/flow --jira ABC-1 --auto-approve`). See "Auto-approve mode" below.

No other input form is supported — do not guess the source from the argument's shape.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three input forms above, plus the optional `--auto-approve` flag. Build the normalized requirement block: `{source, content, origin_link}`.
2. Invoke the `flow-brainstorm` skill with that block. If `--auto-approve` was passed, also pass `auto_approve: true`.
3. **If `--auto-approve` was NOT passed:** wait for explicit human approval of the design — `flow-brainstorm` itself asks this via `AskUserQuestion` with concrete options (Approve/Request changes/Reject), never a bare prose question. Do not proceed on an ambiguous or implied yes.
   **If `--auto-approve` was passed:** `flow-brainstorm` commits the spec itself (or, for Bounded/Spike, has no file to commit) and returns — no live wait.
4. Invoke the `flow-plan` skill with the approved design. If `--auto-approve` was passed, also pass `auto_approve: true`.
5. **If `--auto-approve` was NOT passed:** wait for explicit human approval of the plan the same way. **If `--auto-approve` was passed:** `flow-plan` commits the plan itself and returns — no live wait.
6. Execute:
   - **Without `--auto-approve`:** invoke the `flow-execute` skill directly with the approved plan's file path, inline in this session (unchanged from prior behavior).
   - **With `--auto-approve`:** dispatch execution via the `Agent` tool with `isolation: "worktree"`, backgrounded by default (same prompt shape as `/batch` dispatch, for this one feature/ticket). Report the worktree path and branch name immediately, then continue — do not block this session waiting for it.
7. Print the final report verbatim to the user — `flow-execute`'s direct return (non-auto-approve path) or the dispatched Agent's report when its background task-notification arrives (auto-approve path). Do not summarize away a FAIL into something softer.

## Auto-approve mode (`--auto-approve`)

- Removes both approval gates (design, plan) — `flow-brainstorm`/`flow-plan` write and commit their files unattended instead of stopping for a human click.
- Never suppresses `flow-brainstorm`'s Step 4 genuine clarifying questions or `flow-plan`'s Step 5 self-review — those still run; only the final approve/reject stop is skipped.
- Moves execution off the main thread into an isolated git worktree (mirrors `/batch`), instead of running inline — so a run started with `--auto-approve` never blocks the chat waiting on `flow-execute`.
- Never skips `flow-execute`'s own verify (≤3 retry rounds) or mandatory `reviewer` — those are unchanged; `--auto-approve` only removes the two human gates before execution starts.
- Never merges anything — the dispatched Agent only produces a review-ready branch, exactly like `/batch`; merging still goes through `/pr` and its own gate.

## Quiet delegation (whenever you dispatch a subagent)

- End every subagent prompt with an output budget: "Return a condensed report of at most 30 lines. Do not paste command output except the last ~15 lines of a failure. Keep full logs in a file under the scratchpad and give its path."
- Prefer `run_in_background: true` when your next step does not depend on the result; use foreground only when you must have the result to continue.
- Never read or tail a background agent's output file (its transcript is large); wait for its report. Do not narrate progress while it runs.
- Relay, do not echo: at most 8 lines per subagent (status, counts, number of findings and the most severe one, any decision needed). Full text only for a FAIL or for findings (one line each, never trimmed). Never paste a whole subagent report into chat.

## Hard rules

- Never skip an approval wait because the change "looks small" — unless `--auto-approve` was explicitly passed.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never let `--auto-approve` bypass `flow-execute`'s verify/review loop or the eventual `/pr` merge gate — it only removes the two upstream approval stops.
