# Jira-Sync Command Implementation Plan

**Goal:** `commands/jira-sync.md` — read a Jira ticket's AC and generate a checklist, or post a progress comment (+ optional "In Review"-only transition, never "Done") after verify has already passed elsewhere.

**Approved design:** two modes (`--read`/`--update`), not the usual `--jira/--file/text` adapter (Jira integration IS this command's purpose). Mandatory MCP-authorization check before anything else — attempt-and-detect, since no separate status-check tool exists. Standalone MCP integration point — does not invoke any flow-* skill/subagent.

**Known limitation (documented, not silently skipped):** the Atlassian MCP is not authorized on this machine. Only the unauthorized-MCP stop path can be verified by a real run here; the `--read`/`--update` success paths are verified by manual trace against this design.

---

### Task 1: Create `commands/jira-sync.md`

**Files:**
- Create: `commands/jira-sync.md`

**Interfaces:**
- Consumes: Jira/Atlassian MCP, described generically by required capability (fetch issue, add comment, transition status) — exact tool names resolved at runtime, not hard-coded (schemas aren't stored in this repo).
- Does NOT consume `flow-brainstorm`/`flow-plan`/`flow-execute`/`planner`/`verifier`/`reviewer`.
- Produces: the `/jira-sync` slash command.

- [ ] **Step 1: Write the command file**

```markdown
---
description: Read a Jira ticket's description + acceptance criteria and generate a work checklist, or post a progress comment (+ optional "In Review" transition, never "Done") back to a ticket after verify has already passed elsewhere.
---

# /jira-sync

Arguments: `$ARGUMENTS` — exactly one of:
- `--read <ticket-ID>` — fetch the ticket's description and acceptance criteria, then generate a checklist of work items derived from the acceptance criteria.
- `--update <ticket-ID> --pr <url>` — post a progress comment to the ticket (summary of what was done + the PR link), and optionally transition its status to "In Review" only.

No other input form is supported — this command does not use the `--jira`/`--file`/text input adapter used by `/flow` and its siblings, because Jira integration is this command's entire purpose, not one of several possible requirement sources.

## Step 0 — MCP authorization check (mandatory, before anything else, in either mode)

Before doing anything else, confirm the Jira/Atlassian MCP connector is authorized on this machine. There is no separate "status check" tool documented anywhere in this repo — the only established way to detect this is to attempt the required capability for the requested mode and observe whether it succeeds or fails on authorization:
- `--read`: attempt to fetch the issue by ID.
- `--update`: attempt to fetch the issue by ID (the same read-only capability as `--read` mode) — never probe by attempting to post a comment, since the real comment text hasn't been composed yet at this point (it's composed later, in `--update` mode's own Step 3) and probing with made-up content would violate the "never fabricate a comment" rule. A successful fetch here both confirms authorization and confirms the ticket exists before anything is composed or posted.

If the attempt fails because the connector is not authorized/connected (rather than, e.g., a bad ticket ID on an authorized connector): state plainly that the Jira/Atlassian MCP needs to be authorized via `/mcp` or claude.ai connector settings, and STOP. Never guess ticket content. Never fabricate a description, acceptance criteria, checklist, comment confirmation, or status change. Do not proceed to any step below until a real, successful MCP response has been observed.

Note on tool names: the exact Jira/Atlassian MCP tool names (e.g. `mcp__<connector>__get_issue`, `mcp__<connector>__add_comment`, `mcp__<connector>__transition_issue`) are resolved at runtime by whichever Jira/Atlassian MCP server is connected in the current session — this file intentionally does not hard-code one, since MCP tool schemas are not stored in this repo. Use whichever live tool fulfills the capability described in each step.

## `--read <ticket-ID>` mode

1. Require `<ticket-ID>` to be present. If it's missing, say so plainly and STOP — do not guess a ticket ID.
2. Fetch the ticket by ID via the Jira/Atlassian MCP (capability: fetch issue, returning at minimum title, description, and acceptance criteria).
3. If the ticket has no acceptance criteria field/content: say so plainly and STOP — do not invent acceptance criteria from the description alone.
4. From the acceptance criteria only, generate a checklist of concrete work items — one checklist item per distinct, testable condition in the AC. Do not add scope not implied by the AC.
5. Present the ticket's title, description, acceptance criteria (verbatim from the fetch), and the generated checklist to the user as the command's output. This command does not itself invoke any stage of the `/flow` pipeline — the checklist is the deliverable; a human decides what to do with it next (e.g. feeding it into `/flow` as bare text).

## `--update <ticket-ID> --pr <url>` mode

1. Require both `<ticket-ID>` and `--pr <url>` to be present. If either is missing, say so plainly and STOP — do not guess a PR URL or ticket ID.
2. This command does not run verify itself — it is invoked only after verify has already passed elsewhere (e.g. as the last step of a `/flow` or `/flow-batch` run). Do not re-run tests/lint/build here.
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
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "commands/jira-sync.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder|flow-brainstorm|flow-plan\b|flow-execute|planner|verifier|reviewer" "commands/jira-sync.md"`
Expected: no matches — confirms zero placeholder text and zero references to flow-* orchestration pieces this command deliberately doesn't use.

- [ ] **Step 4: Smoke-test the unauthorized-MCP stop path (real, exercisable in this environment)**

Invoke `/jira-sync --read TEST-1` in this environment, where the Atlassian MCP connector is confirmed not authorized.
Expected: Step 0 attempts the fetch, observes the authorization failure, states plainly that authorization via `/mcp` or claude.ai connector settings is required, and STOPS — no fabricated ticket description, AC, or checklist produced.

Repeat with `/jira-sync --update TEST-1 --pr https://example.com/pr/1` — same expected stop behavior on the comment-add attempt.

- [ ] **Step 5: Documented limitation — manual trace verification of the authorized paths (cannot be run for real here)**

Because the Atlassian MCP is not authorized on this machine, the `--read` success path and the `--update` success path cannot be exercised end-to-end. State this explicitly in the report as a known limitation, and instead verify by manual trace: re-read the command file's `--read` and `--update` sections and confirm each README Mục 3 behavior (checklist from AC; comment + PR link; In-Review-only, never-Done transition) has a corresponding numbered step, and confirm no step could produce a "Done" transition under any input.

- [ ] **Step 6: Commit**

```bash
git add commands/jira-sync.md && git commit -m "feat: add /jira-sync command (read AC checklist, update comment + In-Review-only transition)"
```

---

## Self-Review Notes

- **Spec coverage:** README Mục 3 `/jira-sync` (đọc AC → checklist; sau verify pass → comment + PR link; optionally "In Review", never "Done") → `--read` mode Steps 1-4, `--update` mode Steps 1-6.
- **Overlap table honored:** "bản thân là command MCP riêng" → no `--jira/--file/text` adapter, no flow-* skill/subagent invocation.
- **MCP-authorization convention reused verbatim** from `flow.md`/`flow-batch.md`'s idiom, applied as attempt-and-detect (no separate status-check mechanism exists elsewhere in this repo).
- **Absolute rule stated twice** (body + Hard rules), matching `/migration-safe`'s precedent for irreversible/high-stakes actions: "In Review" only, "Done" never, no exceptions.
- **Tool-name genericity flagged as a real constraint**, not papered over — tool names resolved at runtime, not hard-coded.
- **Verification limitation documented, not silently skipped** — Step 5 states plainly only the unauthorized-path runs for real here.
