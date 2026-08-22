# Loop-Engineer Command Implementation Plan

**Goal:** `commands/loop-engineer.md` — unattended, scheduled Jira-ticket pipeline. Pulls N tickets via JQL, auto-approves brainstorm+plan for well-scoped (Bounded, concrete-AC) tickets, executes each in its own isolated worktree (sequential or parallel), parks anything Architectural/AC-ambiguous as NEEDS-HUMAN, produces one morning report. Never merges.

**Spec:** [docs/flow/specs/loop-engineer-design.md](../specs/loop-engineer-design.md)

**Design amendment made during planning (flagged by the planner survey, fixed here):** the spec's "live invocation asks via AskUserQuestion, scheduled invocation doesn't" distinction has no reliable detection mechanism anywhere in this codebase or documented tool behavior — a wrong guess risks either hanging an unattended run waiting for an answer that never comes, or silently skipping a question a live human could have answered. Fix: **`/loop-engineer` never calls `AskUserQuestion` at all.** `--mode`/`--count` are always required arguments; `## Auto-Loop Jira Query` is always required in target CLAUDE.md; Jira MCP must always already be authorized. Every gap is a plain STOP-with-clear-error, whether invoked live or via Cron — consistent with this repo's existing "never guess" convention, just without the live/unattended branch that couldn't be reliably detected.

## Global Constraints

- Never call `AskUserQuestion` anywhere in this command — see amendment above.
- Never auto-approve Architectural or Spike classification, or missing/ambiguous AC — always park as NEEDS-HUMAN with a specific reason.
- Never share a worktree between two tickets, in either mode.
- Never merge — hand off to `/pr --batch --target main` only.
- Never guess `--mode`, `--count`, a JQL query, or a Jira MCP tool name.

---

### Task 1: Create `commands/loop-engineer.md`

**Files:**
- Create: `commands/loop-engineer.md`

**Interfaces:**
- Consumes: `flow-brainstorm` skill, `flow-plan` skill (both invoked with an override instruction replacing their own live gate with a stop-and-report), `Agent` tool (`isolation: "worktree"`), Jira/Atlassian MCP (fetch-issue + issue-search capabilities, tool name resolved at runtime).
- Produces: `docs/flow/loop-runs/<date>-ledger.md` (resumability bookkeeping only, never the source of truth for git state), morning report, and hands off to `/pr --batch --target main` (unchanged) as the human's next manual step.

- [ ] **Step 1: Write the command file**

```markdown
---
description: Unattended, scheduled Jira-ticket pipeline — pulls N tickets via JQL, auto-approves brainstorm+plan for well-scoped (Bounded, concrete-AC) tickets, executes each in its own isolated worktree (sequential or parallel per --mode), parks anything Architectural or AC-ambiguous as NEEDS-HUMAN, and produces one morning report. Never merges — merging stays with /pr --batch, unchanged.
---

# /loop-engineer

Arguments: `$ARGUMENTS` — REQUIRED: `--mode <sequential|parallel> --count <N>`. Both flags are mandatory on every invocation, live or scheduled — this command never calls `AskUserQuestion`, so there is no live-prompt fallback for a missing or invalid flag. If either is missing, `--mode` is present but is not the exact literal string `sequential` or `parallel` (a typo like `paralel` is neither — never treat a near-match as one of the two), or `<N>` is not a positive integer: say so plainly and STOP — do not guess a default, do not fall back to either mode, do not proceed with any ticket.

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
4. Create `docs/flow/loop-runs/<date>-ledger.md` (date = today, `YYYY-MM-DD`) if it does not already exist for this run; write one line per ticket in the working list: `<ticketId>: PENDING`. Each line's format is `<ticketId>: <STATUS>[ | worktree=<path> | branch=<name>]` — the worktree/branch fields are appended once known (Step 3 fills them in as soon as a dispatch returns them), absent until then. This ledger is informational/resumability-only — git state (worktrees/branches/commits) is always the source of truth, never this file.
   - If a ledger for today's date already exists (a prior invocation today was interrupted mid-run): read it first. Skip any ticket already at `READY` or `NEEDS-HUMAN` — do not reprocess it. Re-dispatch anything still at `IN-PROGRESS` or `PENDING` exactly as if newly selected, but see Step 4 below for `IN-PROGRESS` tickets that already have a recorded `worktree=`/`branch=` — those resume into the existing worktree, they never get a fresh one.

### Step 2 — Pha 1: Brainstorm + Plan (always sequential, auto-approved per rule)

For each ticket in the working list, **in order, one at a time**:

1. Update the ledger line for this ticket to `IN-PROGRESS`.
2. Fetch the ticket via the Jira/Atlassian MCP (same capability `/jira-sync --read` uses — title, description, acceptance criteria). Build the normalized requirement block: `{source: "jira", content: <title+description+AC>, origin_link: <ticket URL>}`.
3. Invoke the `flow-brainstorm` skill with that block, appending this explicit override instruction:

   > "This is an unattended `/loop-engineer` run. After you reach your normal Step 7 approval gate, do NOT call `AskUserQuestion` and do NOT wait for a live response — instead, clearly state your classification (Spike/Bounded/Architectural) and whether concrete, non-empty acceptance criteria were present in the source ticket, then stop. The caller (`/loop-engineer`) applies its own auto-approval rule to that output, not a human."

4. **Auto-approval rule** (replaces `flow-brainstorm`'s own live gate for this command only):
   - Classification is **exactly and unambiguously Bounded** (the override output states the single word "Bounded" as its classification, not a hedge like "probably Bounded" or "Bounded or possibly Architectural") AND acceptance criteria are present and concrete (non-empty, not a vague restatement of the title) → auto-approved. Continue to step 5.
   - Classification is **Architectural**, OR acceptance criteria are missing/ambiguous, OR classification is **Spike** (a spike produces a recommendation, not a design `flow-plan` can plan against), OR the override output does not clearly commit to exactly one of the three labels (hedged, missing, or self-contradictory) → **park this ticket**: update its ledger line to `NEEDS-HUMAN: <specific reason>` (e.g. `NEEDS-HUMAN: Architectural classification`, `NEEDS-HUMAN: acceptance criteria missing`, `NEEDS-HUMAN: Spike classification`, `NEEDS-HUMAN: flow-brainstorm output did not clearly state a classification`), do not proceed to `flow-plan`/execute for it, move to the next ticket. An unclear answer is treated the same as the riskiest case (Architectural) — never treated as an implicit Bounded.
5. Invoke the `flow-plan` skill with the approved design, appending the equivalent override instruction: do not call `AskUserQuestion` at its own Step 6 gate — its self-review (placeholder scan, requirement coverage) already ran; trust its output once produced, no second human-equivalent gate here.
6. The moment this ticket's plan file is written, hand it to Pha 2 (below) per the run's `--mode`.

### Step 3 — Pha 2: Execute (mode-dependent dispatch, always isolated per ticket)

Every ticket's execute+verify+review run happens in its own git worktree, in both modes — never shared.

**First-time dispatch vs. resume dispatch:** before dispatching, check this ticket's ledger line (Step 1.4) for a recorded `worktree=`/`branch=`.
- **No recorded worktree (first time for this ticket):** call the `Agent` tool with `isolation: "worktree"` — it creates a fresh worktree/branch automatically. As soon as the dispatch result is known (either the immediate return in `--mode sequential`, or the background task-notification's `worktree`/`worktreeBranch` fields in `--mode parallel`), write the returned worktree path and branch name into this ticket's ledger line (`worktree=<path> | branch=<name>`) — do this even if the dispatch is still running in `--mode parallel`, as soon as the path/branch is known, not only at completion.
- **Recorded worktree already exists (resuming an `IN-PROGRESS` ticket from an earlier interrupted run):** do NOT pass `isolation: "worktree"` — that always creates a new one. Instead, dispatch a plain `Agent` call whose prompt explicitly instructs it to `cd` into the exact recorded worktree path first, run `git log --oneline -5` and `git status --porcelain` there to see what already landed before this run was interrupted, and continue the plan from wherever it actually left off — never re-run already-committed steps, never assume nothing happened yet.

- **`--mode parallel`** (mirrors `/flow-batch`'s existing Pha 2 pipeline exactly): the moment a ticket's plan is ready (Step 2.6) — or, for a resume, the moment Step 1 determines this ticket needs re-dispatching — call the `Agent` tool for that single ticket immediately (first-time or resume, per the branch above). Do not pass a flag that disables backgrounding — the `Agent` tool backgrounds by default, so this call returns immediately and the main thread continues Step 2 for the next ticket right away, without waiting.
- **`--mode sequential`**: dispatch the same way, but **wait for this ticket's Agent call to fully return** (verify + review done) before starting the next ticket's Step 2 (Pha 1 brainstorm). One worktree per ticket either way — sequential means one ticket fully finishes before the next one *starts*, not a shared workspace.

The dispatched Agent's prompt for a **first-time** dispatch (substitute `ticketId`, `slug`, `planPath`, `repoPath`, `origin_link` for this one ticket):

    You are executing an approved implementation plan for Jira ticket {ticketId} ("{slug}"), in repo {repoPath}. The ticket is at {origin_link}.

    Read the plan file at {planPath} fully before starting.

    Execute its tasks in order exactly as written: test-first when a test runner exists, minimal implementation, run the test, commit — do not skip steps, do not add steps not in the plan. Never touch files outside what the plan's Files sections list. If the plan is missing something required to finish a task, stop and report it instead of inventing scope.

    After all tasks are done: read this project's CLAUDE.md to find its test/lint/build commands (never guess a command; if none is documented, say so). Run those commands via Bash and capture full output.

    If a command FAILs: read the failure output, fix the specific issue, re-run. Hard limit: 3 verify rounds total. If round 3 still FAILs, STOP — do not attempt a 4th fix — and report status FAIL with all 3 rounds' exact command and output.

    Once verify PASSes (status PASS), review your own diff adversarially, as if you did not write it: look specifically for logic edge cases, security issues (injection, auth bypass, secrets, unsafe deserialization), race conditions, and silent data loss that the tests likely do not cover. Report findings one per line as `path:line: <severity> <problem>. <concrete failure scenario>.` If you find nothing, say exactly "No issues found in reviewed scope." — do not manufacture a finding.

    Return your final report as plain text in exactly this shape, in this order, with no extra commentary before or after it:

    STATUS: PASS or FAIL

    VERIFY ROUNDS:
    Round 1: command=<exact command> result=PASS/FAIL
    output: <full output>
    Round 2: (same shape, only if round 1 failed)
    Round 3: (same shape, only if round 2 failed)

    REVIEW FINDINGS:
    <one finding per line as specified above, or "No issues found in reviewed scope.">

    SUMMARY:
    <one paragraph describing what was done>

    Also state which git worktree path and branch name hold your changes.

The dispatched Agent's prompt for a **resume** dispatch (substitute `ticketId`, `slug`, `planPath`, `existingWorktreePath`, `origin_link` for this one ticket — no `isolation` parameter is passed for this call):

    You are resuming an interrupted execution of the approved implementation plan for Jira ticket {ticketId} ("{slug}"). The ticket is at {origin_link}.

    First, `cd` into {existingWorktreePath} — this worktree already exists from a prior, interrupted run. Do not create a new worktree. Run `git log --oneline -10` and `git status --porcelain` there to see exactly what already landed and whether anything is uncommitted.

    Read the plan file at {planPath} fully. Compare its tasks against what `git log` shows already committed — resume from the first task/step that isn't done yet. Never re-run or redo a step whose commit is already present. Never assume nothing happened yet just because this is a resume.

    From this point, follow the exact same execution/verify/review contract as a first-time dispatch: test-first when a test runner exists, minimal implementation, run the test, commit; after all remaining tasks are done, read this project's CLAUDE.md for test/lint/build commands (never guess), run them, ≤3 verify rounds with STOP-and-report on round 3 FAIL; on verify PASS, adversarially review the full diff (not just what this resume added) exactly as a first-time dispatch would.

    Return your final report in the exact same shape as a first-time dispatch: `STATUS`, `VERIFY ROUNDS`, `REVIEW FINDINGS`, `SUMMARY`, and confirm the worktree path/branch name (should match {existingWorktreePath} and its existing branch — report explicitly if this ever fails to match, since that would indicate something went wrong with the resume).

Each dispatched Agent's completion arrives later as a background task-notification (in `--mode parallel`) or as this call's direct return (in `--mode sequential`). The moment a result is known for a ticket:
- On `STATUS: PASS`: update the ledger line for this ticket to `READY` (keep the recorded `worktree=`/`branch=` fields — the report references them).
- On `STATUS: FAIL`: update the ledger line for this ticket to `FAILED: <which verify round failed>` (keep the recorded `worktree=`/`branch=` fields).

Report each ticket's outcome to the user right away as it becomes known (same discipline as `/flow-batch`) — do not hold it back or batch it with other tickets' results, and do not soften a FAIL into something gentler.

### Step 4 — Resilience to quota/session interruptions

If a dispatched Agent dies mid-run (a task-notification with `status: failed` and a quota/session-limit message), leave that ticket's ledger line at its last known state (`IN-PROGRESS`, with whatever `worktree=`/`branch=` was already recorded for it) — do not guess a result. A later invocation (manual re-run, or the next scheduled trigger) reads today's ledger (Step 1.4), skips tickets already `READY`/`NEEDS-HUMAN`, and re-dispatches anything still `IN-PROGRESS`/`PENDING` using Step 3's resume-dispatch path (the recorded worktree, never a fresh one) if a `worktree=` field is present, or the first-time path if not (an `IN-PROGRESS` ticket with no recorded worktree means it died before the worktree/branch was ever reported back — safe to treat as first-time).

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
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "commands/loop-engineer.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Run this repo's own documented test command**

Run: `bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'`
Expected: `PASS`.

- [ ] **Step 4: Manual inspection confirming every `AskUserQuestion` mention is prohibitive, never permissive**

Run: `grep -n "AskUserQuestion" commands/loop-engineer.md` and read each matched line.
Expected: every match is phrased as "never call," "do NOT call," or "no `AskUserQuestion`" — i.e. documenting the prohibition — never a sentence instructing this command to actually invoke it (that would be a real bug; the earlier "expect 0 mentions" check was itself wrong, since the file must name the tool to prohibit it).

- [ ] **Step 5: Smoke-test the missing-flags path (real, exercisable without any MCP)**

Invoke `/loop-engineer` with no arguments.
Expected: STOPs immediately stating `--mode` and `--count` are required — no `AskUserQuestion`, no guess, no attempt to reach Step 0.

- [ ] **Step 6: Smoke-test the unauthorized-Jira-MCP path (real, exercisable in this environment)**

Invoke `/loop-engineer --mode sequential --count 1` in this environment, where the Atlassian MCP connector is confirmed not authorized (verified earlier this session via `ToolSearch` — no Jira/Atlassian tools present).
Expected: Step 0 attempts the fetch, observes the authorization failure, prints the setup guide as plain text (no `AskUserQuestion`), and STOPs — no ticket processed, no fabricated data.

- [ ] **Step 7: Smoke-test the missing-JQL-query path**

```bash
mkdir -p /tmp/flow-scratch/loop-engineer-noquery && cd /tmp/flow-scratch/loop-engineer-noquery
git init -q
echo "# Scratch, no Auto-Loop Jira Query section" > CLAUDE.md
git add -A && git commit -q -m "init"
```

Trace Step 1 against this scratch repo (Jira MCP auth is assumed available for this specific trace — this step tests the JQL-missing path, not the auth path already covered in Step 6).
Expected: Step 1.2 STOPs, states `## Auto-Loop Jira Query` is absent, does not guess a query, does not process any ticket.

- [ ] **Step 8: Manual trace — mode/worktree isolation logic**

Re-read Step 3's parallel vs sequential branches and confirm: (a) both branches pass `isolation: "worktree"` to every `Agent` call, no exception; (b) only the sequential branch's prose says to wait for the call to return before continuing; (c) neither branch ever reuses one worktree path across two different `ticketId` substitutions.

- [ ] **Step 9: Commit**

```bash
git add commands/loop-engineer.md && git commit -m "feat: add /loop-engineer command (unattended overnight Jira-ticket pipeline, no AskUserQuestion, never merges)"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/flow/specs/loop-engineer-design.md` (0-7) maps to this plan's Orchestration Steps 0-5 and Hard rules, with one deliberate amendment (live/unattended `AskUserQuestion` branching removed — see amendment note at the top of this plan) that strictly tightens safety (fewer ways to guess wrong) rather than loosening it.
- **Placeholder scan:** literal, complete command content; no TBD. The words "gap," "missing," "ambiguous" appear descriptively, not as unfinished stand-ins.
- **Type/name consistency:** `flow-brainstorm`, `flow-plan`, `Agent` tool usage, and the Pha 2 dispatch prompt match `flow-batch.md`'s exact established conventions; the Jira fetch/auth mechanism matches `jira-sync.md`'s exactly (Step 0a/0b naming, capability-based tool-name genericity).
- **Boundary respected:** this command never touches `commands/pr.md` or any merge logic — confirmed by Hard rules and by Step 5's explicit hand-off wording.
