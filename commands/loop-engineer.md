---
description: Unattended, scheduled Jira-ticket pipeline — pulls N tickets via JQL, auto-approves brainstorm+plan for well-scoped (Bounded, concrete-AC) tickets, executes each in its own isolated worktree (sequential or parallel per --mode), parks anything Architectural or AC-ambiguous as NEEDS-HUMAN, and produces one morning report. Never merges — merging stays with /pr --batch, unchanged.
---

# /loop-engineer

Arguments: `$ARGUMENTS` — REQUIRED: `--mode <sequential|parallel> --count <N>`. Both flags are mandatory on every invocation, live or scheduled — this command never calls `AskUserQuestion`, so there is no live-prompt fallback for a missing flag. `--mode` must be the exact lowercase literal `sequential` or `parallel` — a near-match like `paralel`, `Parallel`, or `PARALLEL` is neither and must never be treated as one of the two. If either flag is missing, `--mode` is not exactly one of those two literals, or `<N>` is not a positive integer: say so plainly and STOP — do not guess a default, do not proceed with any ticket.

This command is designed to be triggered by Claude Code's native Cron/Schedule capability, configured to always pass both flags. No external orchestration tool (n8n or otherwise) is used or needed — MCP connectors (Jira/Atlassian, etc.) belong to the Claude Code environment itself and work identically regardless of what triggers a run.

No other input form is supported — do not accept `--jira`/`--file`/bare text here; ticket sourcing is entirely JQL-driven (Step 1).

## Orchestration

### Step 0 — Jira MCP authorization check (mandatory, before anything else)

Reuse `/jira-sync`'s Step 0a mechanism verbatim, never reimplement: attempt the same fetch-issue capability `--read` mode uses to confirm the Jira/Atlassian MCP connector is authorized.

If unauthorized: print the same setup-guide content `jira-sync.md`'s Step 0b prints (both connection paths — claude.ai connector, local MCP config) as plain informational text, then STOP without processing any ticket. Never call `AskUserQuestion` here (unlike `jira-sync.md`'s own live Step 0b) — this command has no live-prompt path at all.

### Step 1 — Ticket selection

1. Read the target repo's `CLAUDE.md` for a `## Auto-Loop Jira Query` section (same convention as `## Benchmark` in `optimize.md`, `## Shadow Database` in `migration-safe.md`) — its content is a JQL query, e.g. `project = X AND status = "Ready for Auto" ORDER BY priority DESC`.
2. If that section is absent: say so plainly and STOP without processing any ticket. Never guess a query.
3. Run the JQL query via the Jira/Atlassian MCP connector (issue-search capability) and take the first `<N>` (from `--count`) results, in the query's own returned order. Build the working ticket list: `[{ticketId, order}]`.
4. Create `docs/flow/loop-runs/<date>-ledger.md` (date = today, `YYYY-MM-DD`) if it does not already exist for this run; write one line per ticket in the working list in the format `<ticketId>: <STATUS>[ | worktree=<path> | branch=<name>]` — initially `<ticketId>: PENDING`. This ledger is informational/resumability-only — git state (worktrees/branches/commits) is always the source of truth, never this file.
   - If a ledger for today's date already exists (a prior invocation today was interrupted mid-run): read it first. Skip any ticket already at `READY` or `NEEDS-HUMAN` — do not reprocess it. Re-dispatch anything still at `IN-PROGRESS` or `PENDING` exactly as if newly selected — an `IN-PROGRESS` ticket with a recorded `worktree=`/`branch=` uses the resume-dispatch path (Step 3); one with no recorded worktree died before it was ever reported and is safe to treat as first-time.

### Step 2 — Pha 1: Brainstorm + Plan (always sequential, auto-approved per rule)

For each ticket in the working list, **in order, one at a time**:

1. Update the ledger line for this ticket to `IN-PROGRESS`.
2. Fetch the ticket via the Jira/Atlassian MCP (same capability `/jira-sync --read` uses — title, description, acceptance criteria). Build the normalized requirement block: `{source: "jira", content: <title+description+AC>, origin_link: <ticket URL>}`.
3. Invoke the `flow-brainstorm` skill with that block, appending this explicit override instruction:

   > "This is an unattended `/loop-engineer` run. After you reach your normal Step 7 approval gate, do NOT call `AskUserQuestion` and do NOT wait for a live response — instead, clearly state your classification (Spike/Bounded/Architectural) and whether concrete, non-empty acceptance criteria were present in the source ticket, then stop. The caller (`/loop-engineer`) applies its own auto-approval rule to that output, not a human."

4. **Auto-approval rule** (replaces `flow-brainstorm`'s own live gate for this command only):
   - Classification is **exactly and unambiguously Bounded** (not hedged, e.g. never "probably Bounded") AND acceptance criteria are present and concrete (non-empty, not a vague restatement of the title) → auto-approved. Continue to step 5.
   - Classification is **Architectural**, OR acceptance criteria are missing/ambiguous, OR classification is **Spike** (a spike produces a recommendation, not a design `flow-plan` can plan against), OR the override output does not clearly commit to exactly one of the three labels (hedged, missing, or self-contradictory) → **park this ticket**: update its ledger line to `NEEDS-HUMAN: <specific reason>` (e.g. `NEEDS-HUMAN: Architectural classification`, `NEEDS-HUMAN: acceptance criteria missing`, `NEEDS-HUMAN: Spike classification`, `NEEDS-HUMAN: flow-brainstorm output did not clearly state a classification`), do not proceed to `flow-plan`/execute for it, move to the next ticket. Never treat an ambiguous or hedged classification as an implicit Bounded.
5. Invoke the `flow-plan` skill with the approved design, appending the equivalent override instruction: do not call `AskUserQuestion` at its own Step 6 gate — its self-review (leftover-stub-text scan, requirement coverage) already ran; trust its output once produced, no second human-equivalent gate here.
6. The moment this ticket's plan file is written, hand it to Pha 2 (below) per the run's `--mode`.

### Step 3 — Pha 2: Execute (mode-dependent dispatch, always isolated per ticket)

Every ticket's execute+verify+review run happens in its own git worktree, in both modes — never shared.

**First-time dispatch vs. resume dispatch:**
- **First-time** (ticket has no recorded `worktree=`/`branch=` in the ledger yet): dispatch with `isolation: "worktree"` — this auto-creates a fresh worktree+branch. As soon as the Agent tool call returns the worktree path and branch name (even mid-flight in `--mode parallel`, before the Agent finishes its actual work), record them into the ledger line immediately: `<ticketId>: IN-PROGRESS | worktree=<path> | branch=<name>`.
- **Resume** (ticket is `IN-PROGRESS` in the ledger with a `worktree=`/`branch=` already recorded — from an interrupted prior run): do NOT pass `isolation` — dispatch a plain `Agent` call using the resume prompt template below instead of the first-time template, pointing it at the existing worktree. Never create a fresh worktree via `isolation: "worktree"` when one is already recorded for this ticket.

- **`--mode parallel`** (mirrors `/flow-batch`'s existing Pha 2 pipeline exactly): the moment a ticket's plan is ready (Step 2.6) or a resume is due, dispatch that single ticket immediately per the first-time/resume rule above. Do not pass a flag that disables backgrounding — the `Agent` tool backgrounds by default, so this call returns immediately and the main thread continues Step 2 for the next ticket right away, without waiting.
- **`--mode sequential`**: dispatch the same way, but **wait for this ticket's Agent call to fully return** (verify + review done) before starting the next ticket's Step 2 (Pha 1 brainstorm). One worktree per ticket either way — sequential means one ticket fully finishes before the next one *starts*, not a shared workspace.

The first-time dispatched Agent's prompt (substitute `ticketId`, `slug`, `planPath`, `repoPath`, `origin_link` for this one ticket):

    You are executing an approved implementation plan for Jira ticket {ticketId} ("{slug}"), in repo {repoPath}. The ticket is at {origin_link}.

    Read the plan file at {planPath} fully before starting.

    Execute its tasks in order exactly as written: test-first when a test runner exists, minimal implementation, run the test, commit — do not skip steps, do not add steps not in the plan. Never touch files outside what the plan's Files sections list. If the plan is missing something required to finish a task, stop and report it instead of inventing scope.

    After all tasks are done: read this project's CLAUDE.md to find its test/lint/build commands (never guess a command; if none is documented, say so). Run those commands via Bash and capture full output.

    If a command FAILs: read the failure output, fix the specific issue, re-run. Hard limit: 3 verify rounds total. If round 3 still FAILs, STOP — do not attempt a 4th fix — and report status FAIL with all 3 rounds' exact command and output.

    Once verify PASSes (status PASS), review your own diff adversarially, as if you did not write it: look specifically for logic edge cases, security issues (injection, auth bypass, secrets, unsafe deserialization), race conditions, and silent data loss that the tests likely do not cover. Report findings one per line as `path:line: <severity> <problem>. <concrete failure scenario>.` If you find nothing, say exactly "No issues found in reviewed scope." — do not manufacture a finding.

    Return your final report as plain text in exactly this shape, in this order, with no extra commentary before or after it. This is a condensed report for the morning summary — the full command output already lives in your own tool-call history/the worktree, never re-paste it here:

    STATUS: PASS or FAIL

    VERIFY: <N> round(s), each as one line: "Round K: command=<exact command> result=PASS/FAIL" — no output body on a PASS line. On the FIRST round that FAILs, add one line directly under it with just the one-line error message/failing assertion (not the full stdout dump). If the final round is FAIL (hard stop at round 3), that round's line also gets the exact failing command and its full output in full — this is the one case where full detail is warranted, since there's no further fix to summarize.

    REVIEW FINDINGS:
    <one finding per line as specified above, or "No issues found in reviewed scope."> — never trimmed, never softened.

    SUMMARY:
    <2-4 sentences: what was implemented, any real deviation from the plan disclosed inline, nothing else — not a walkthrough of every file touched>

    Also state which git worktree path and branch name hold your changes.

The resume dispatch Agent's prompt (substitute `ticketId`, `slug`, `planPath`, `repoPath`, `origin_link`, `existingWorktreePath`, `existingBranch` for this one ticket):

    You are resuming an interrupted implementation run for Jira ticket {ticketId} ("{slug}"), in repo {repoPath}. The ticket is at {origin_link}.

    A prior run for this ticket was interrupted (session/quota limit) partway through. Its work lives in the existing git worktree at {existingWorktreePath}, branch {existingBranch} — reuse it, do not create a new worktree.

    First, `cd` into {existingWorktreePath} and run `git log --oneline -10` and `git status --porcelain` to see exactly what already landed (committed tasks) and what's still uncommitted or undone. Confirm the worktree path and branch name match what was recorded ({existingWorktreePath} / {existingBranch}) — if they don't match, stop and report the mismatch instead of guessing which is correct.

    Read the plan file at {planPath} fully. Resume from the first task/step not yet reflected in the commit history — never redo a task that's already committed, never skip a task that isn't.

    From this point on, follow the identical execute/verify/review contract as a first-time run: test-first when a test runner exists, minimal implementation, run the test, commit; then run this project's documented test/lint/build commands (never guess; if none documented, say so), fixing and re-running up to 3 verify rounds total; then the mandatory adversarial self-review of the full diff (not just what you added this session).

    Return your final report in the exact same condensed shape as a first-time run (STATUS, VERIFY, REVIEW FINDINGS, SUMMARY, worktree path and branch name) — no full command output dump on a passing round.

Each dispatched Agent's completion arrives later as a background task-notification (in `--mode parallel`) or as this call's direct return (in `--mode sequential`). The moment a result is known for a ticket:
- On `STATUS: PASS`: update the ledger line for this ticket to `READY` (keep the recorded `worktree=`/`branch=` fields — the report references them).
- On `STATUS: FAIL`: update the ledger line for this ticket to `FAILED: <which verify round failed>` (keep the recorded `worktree=`/`branch=` fields — the report references them).

Report each ticket's outcome to the user right away as it becomes known (same discipline as `/flow-batch`) — do not hold it back or batch it with other tickets' results, and do not soften a FAIL into something gentler.

### Step 4 — Resilience to quota/session interruptions

If a dispatched Agent dies mid-run (a task-notification with `status: failed` and a quota/session-limit message), leave that ticket's ledger line at its last known state (`IN-PROGRESS`, with whatever `worktree=`/`branch=` was already recorded for it) — do not guess a result. A later invocation (manual re-run, or the next scheduled trigger) reads today's ledger (Step 1.4), skips tickets already `READY`/`NEEDS-HUMAN`, and re-dispatches anything still `IN-PROGRESS`/`PENDING` using Step 3's resume-dispatch path (the recorded worktree, never a fresh one) if a `worktree=` field is present, or the first-time path if not (an `IN-PROGRESS` ticket with no recorded worktree died before the worktree/branch was ever reported back — safe to treat as first-time).

### Step 5 — Morning report

After every ticket in the working list has reached `READY`, `NEEDS-HUMAN`, or `FAILED` (or the run is interrupted and a later invocation completes it), produce one aggregate report:
- **READY** tickets: ticket ID, worktree path, branch name, verify round count, review findings summary — same shape as `/flow-batch`'s existing per-feature report.
- **NEEDS-HUMAN** tickets: ticket ID + the specific reason recorded in Step 2.4 (Architectural classification, Spike classification, or missing/ambiguous AC) — these were never touched beyond fetch+classify.
- **FAILED** tickets: ticket ID, which verify round failed, last output.

State plainly at the end: no merging happened here — review the report, then run `/pr --batch --target main` (unchanged) to publish/merge READY tickets, one branch at a time, per its own gate.

## Hard rules

- Never call `AskUserQuestion` anywhere in this command, on any invocation — every gap that would normally trigger a live question (missing `--mode`/`--count`, missing `## Auto-Loop Jira Query`, unauthorized Jira MCP) is a plain STOP-and-report instead.
- Never guess `--mode`, `--count`, or a JQL query — always STOP and report if missing, never default silently.
- Never auto-approve an Architectural or Spike classification, or a ticket with missing/ambiguous acceptance criteria — always park as `NEEDS-HUMAN` with the specific reason, never proceed to plan/execute for it.
- Never skip the override instruction to `flow-plan` after overriding `flow-brainstorm`'s gate — both gates are overridden for this command, not just the first.
- Never dispatch a ticket's Pha 2 `Agent` call before that ticket's plan file is actually written (Step 2.6) — other tickets may still be earlier in Pha 1 at that moment, and that's fine.
- Never wait for a dispatched Agent to finish before continuing Pha 1 for the next ticket in `--mode parallel` — the dispatch call must not block the main thread in that mode.
- Never proceed to the next ticket's Pha 1 in `--mode sequential` before the current ticket's Agent call has fully returned.
- Never share a git worktree between two tickets, in either mode.
- Never let a dispatched Agent wait for human input mid-run — if it reports it's blocked, that surfaces in its final report, not as a live prompt.
- Never treat the ledger file as the source of truth for what actually landed — always defer to `git log`/worktree state; the ledger is resumability bookkeeping only.
- Never merge branches from this command, under any framing — report and hand off to `/pr --batch --target main` only, exactly as `/flow-batch` already does.
- Never batch multiple tickets' completion reports together — report each one to the user as soon as its result is known.
- Never hard-code a specific Jira/Atlassian MCP tool name — use whichever live tool fulfills the fetch/search capability described above, same rule as `jira-sync.md`.
- Never treat a near-match `--mode` value (e.g. `paralel`, `Parallel`, `PARALLEL`) as valid — only the exact lowercase literals `sequential` or `parallel` are accepted; anything else is a plain STOP-and-report, never a guessed default.
- Never treat a hedged, missing, or self-contradictory classification output from `flow-brainstorm` (e.g. "probably Bounded", no label stated, or a label that doesn't match one of the three defined buckets) as an implicit Bounded — park it as `NEEDS-HUMAN: flow-brainstorm output did not clearly state a classification` instead.
- Never dispatch a fresh `isolation: "worktree"` Agent call for a ticket that already has a recorded `worktree=`/`branch=` in the ledger — reuse the existing worktree via the resume-dispatch prompt (Step 3) instead of starting over in a new one.
- Never let the condensed report format drop or soften a FAIL, a review finding, or a real plan deviation — condensing only removes redundant full-success-output dumps, never substance.
