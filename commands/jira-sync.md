---
description: Read a Jira ticket's description + acceptance criteria and generate a work checklist, or post a progress comment (+ optional "In Review" transition, never "Done") back to a ticket after verify has already passed elsewhere.
---

# /jira-sync

Arguments: `$ARGUMENTS` — exactly one of:
- `--read <ticket-ID>` — fetch the ticket's description and acceptance criteria, then generate a checklist of work items derived from the acceptance criteria.
- `--update <ticket-ID> --pr <url>` — post a progress comment to the ticket (summary of what was done + the PR link), and optionally transition its status to "In Review" only.

No other input form is supported — this command does not use the `--jira`/`--file`/text input adapter used by `/flow` and its siblings, because Jira integration is this command's entire purpose, not one of several possible requirement sources.

## Step 0 — MCP authorization check (mandatory, before anything else, in either mode)

### Step 0a — Attempt the required capability

Before doing anything else, confirm the Jira/Atlassian MCP connector is authorized on this machine. There is no separate "status check" tool documented anywhere in this repo — the only established way to detect this is to attempt the required capability for the requested mode and observe whether it succeeds or fails on authorization:
- `--read`: attempt to fetch the issue by ID.
- `--update`: attempt to fetch the issue by ID (the same read-only capability as `--read` mode) — never probe by attempting to post a comment, since the real comment text hasn't been composed yet at this point (it's composed later, in `--update` mode's own Step 3) and probing with made-up content would violate the "never fabricate a comment" rule. A successful fetch here both confirms authorization and confirms the ticket exists before anything is composed or posted.

If this succeeds, proceed directly to the requested mode's steps below — Step 0b does not apply.

### Step 0b — If unauthorized: guided setup, then STOP

If the attempt fails because the connector is not authorized/connected (rather than, e.g., a bad ticket ID on an authorized connector), do not just state a one-line pointer — walk the user through setup:

1. Print the full setup guide, covering both known connection paths:
   - **claude.ai connector path:** go to claude.ai account settings → Connectors section → add/enable the Atlassian connector → sign in and authorize there. Once authorized, Jira tools become available in this session.
   - **Local MCP config path:** either run `/mcp` in an interactive Claude Code session and follow its prompts to add the Atlassian/Jira MCP server, or manually configure `.mcp.json` with an Atlassian MCP server entry and an API token — this requires an Atlassian API token, generated at https://id.atlassian.com/manage-profile/security/api-tokens.
2. Ask, via `AskUserQuestion`, "Bạn dùng cách nào để kết nối Jira?" with options:
   - "claude.ai connector"
   - "Local MCP config (.mcp.json + token, hoặc /mcp)"
   - "Chưa chắc, chỉ cho tôi xem cả 2"
3. Print the detailed guide again for whichever path was chosen (or both, unchanged, if "Chưa chắc, chỉ cho tôi xem cả 2" was chosen) so the relevant instructions are the last thing the user sees, not buried above the question.
4. Regardless of which path applies: STOP after printing the guide. Claude cannot complete OAuth or token setup on the user's behalf — this is informational only, not automated setup. Never guess ticket content. Never fabricate a description, acceptance criteria, checklist, comment confirmation, or status change. Do not proceed to any step below until a real, successful MCP response has been observed on a later invocation.

Note on tool names: the exact Jira/Atlassian MCP tool names (e.g. `mcp__<connector>__get_issue`, `mcp__<connector>__add_comment`, `mcp__<connector>__transition_issue`) are resolved at runtime by whichever Jira/Atlassian MCP server is connected in the current session — this file intentionally does not hard-code one, since MCP tool schemas are not stored in this repo. Use whichever live tool fulfills the capability described in each step.

## `--read <ticket-ID>` mode

1. Require `<ticket-ID>` to be present. If it's missing, say so plainly and STOP — do not guess a ticket ID.
2. Fetch the ticket by ID via the Jira/Atlassian MCP (capability: fetch issue, returning at minimum title, description, and acceptance criteria).
3. If the ticket has no acceptance criteria field/content: say so plainly and STOP — do not invent acceptance criteria from the description alone.
4. From the acceptance criteria only, generate a checklist of concrete work items — one checklist item per distinct, testable condition in the AC. Do not add scope not implied by the AC.
5. Present the ticket's title, description, acceptance criteria (verbatim from the fetch), and the generated checklist to the user as the command's output. This command does not itself invoke any stage of the `/flow` pipeline — the checklist is the deliverable; a human decides what to do with it next (e.g. feeding it into `/flow` as bare text).

## `--update <ticket-ID> --pr <url>` mode

1. Require both `<ticket-ID>` and `--pr <url>` to be present. If either is missing, say so plainly and STOP — do not guess a PR URL or ticket ID.
2. This command does not run verify itself — it is invoked only after verify has already passed elsewhere (e.g. as the last step of a `/flow` or `/delegate` run). Do not re-run tests/lint/build here.
3. Compose a progress comment: a short summary of what was done (supplied by whatever invoked this command, or asked of the user if not supplied) plus the PR link from `--pr`.
4. Post that comment to the ticket via the Jira/Atlassian MCP (capability: add comment to issue).
5. Status transition is OPTIONAL and, if performed, may ONLY ever set the ticket to "In Review" — NEVER "Done", NEVER any other terminal/closing status, under any framing, even if a future invocation of this command explicitly asks for "Done". Moving a ticket to "Done" requires a human acting directly in Jira, not this command, ever.
6. Report to the user which comment text was posted and whether/what status transition was performed.

## Hard rules

- Never proceed past Step 0 without an observed successful MCP response for the requested mode's capability — no guessing ticket content, no fabricated confirmations.
- Never invent acceptance criteria, comments, or status-change confirmations.
- Never transition a ticket to "Done" from this command, under any circumstance, even on explicit request — that is a human-only action taken directly in Jira.
- Never run or re-run verify from this command — `--update` assumes verify already passed elsewhere.
- Never hard-code a specific Jira/Atlassian MCP tool name — use whichever live tool fulfills the capability described above, since tool names are resolved at runtime, not stored in this repo.
