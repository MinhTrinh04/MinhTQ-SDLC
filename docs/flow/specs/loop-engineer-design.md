# Loop Engineer — Unattended Overnight Ticket Pipeline

> Sub-project spec: `/loop-engineer` — a scheduled, unattended command that pulls N Jira tickets, auto-approves spec+plan for well-scoped tickets, executes them (sequential or parallel, always isolated per-ticket in its own worktree), and produces one morning report. Merging into `main` is explicitly out of scope — that still goes through `/pr --batch`'s human gate, unchanged.

---

## 0. Relationship to the human-gate principle (README Mục 0.4)

This is the third time in this session automating past a human gate has come up. The first two (`/flow-batch` merge, `/pr` merge) were resolved by keeping a dedicated approval gate before the irreversible action (a real `git merge`). This design keeps that same boundary: **spec and plan approval are automated for well-scoped tickets, but merging into `main` is never automated** — `/loop-engineer`'s output is always review-ready branches, never a fait accompli on `main`.

The automation boundary is drawn at classification, not at blanket auto-approval:
- **Bounded ticket, clear acceptance criteria** → auto-approved, proceeds unattended.
- **Architectural ticket, or ambiguous/missing acceptance criteria** → the ticket is parked (not processed), reported for a human to run through `/flow` or `/jira-sync --read` manually during the day. Never auto-decided.

## 1. Trigger — Claude Code's native Cron/Schedule (no n8n)

- Uses the Cron/Schedule capability already available in this Claude Code environment. No external orchestration tool (n8n or otherwise) is needed — MCP connectors (Jira/Atlassian, Figma, etc.) belong to the Claude Code environment itself and work identically regardless of what triggers a run.
- The scheduled job invokes `/loop-engineer --mode <sequential|parallel> --count <N>`. **`--mode` and `--count` must be set when the Cron schedule is created** — an unattended overnight run has no human present to answer an `AskUserQuestion`, so these cannot be left to a live prompt for scheduled runs.
- When `/loop-engineer` is invoked manually (not via Cron) with `--mode`/`--count` omitted, it asks via `AskUserQuestion` before doing anything else — a human is presumed present in that case.

## 2. Ticket selection

- Reads a JQL query from a new `## Auto-Loop Jira Query` section in the target repo's `CLAUDE.md` (same convention as `## Benchmark`, `## Shadow Database`) — e.g. `project = X AND status = "Ready for Auto" ORDER BY priority DESC`.
- If that section is absent: STOP and report the gap (via the morning report if unattended, or `AskUserQuestion` if invoked live) — never guess a query.
- Takes the first `<N>` tickets returned, in the query's own order.

## 3. Pha 1 — Brainstorm + Plan (always sequential, auto-approved per rule)

For each of the `<N>` tickets, in order:

1. Fetch the ticket via the same mechanism `/jira-sync --read` uses (MCP fetch issue — title, description, acceptance criteria).
2. Invoke `flow-brainstorm` with that content.
3. **Auto-approval rule** (replaces the live `AskUserQuestion` gate for this command only):
   - Classification is **Bounded** AND acceptance criteria are present and concrete (not empty, not a vague restatement of the title) → auto-select "Approve," proceed to `flow-plan` for this ticket.
   - Classification is **Architectural**, OR acceptance criteria are missing/ambiguous → **park this ticket**: record it as `NEEDS-HUMAN` with the specific reason (classification or AC gap), do not proceed to plan/execute for it, move to the next ticket.
4. For auto-approved tickets, invoke `flow-plan`. `flow-plan`'s own self-review (placeholder scan, requirement coverage) already runs — trust its output once produced; do not add a second human-equivalent gate here.
5. The moment a ticket's plan is ready, hand it to Pha 2 (below) according to the run's `--mode`.

## 4. Pha 2 — Execute (mode-dependent dispatch, always isolated per ticket)

Every ticket's `flow-execute` run happens in its **own git worktree** — this is true in both modes, never shared, never an exception.

- **`--mode parallel`** (mirrors `/flow-batch`'s existing pipeline): the moment a ticket's plan is ready (Pha 1 step 5), dispatch it immediately via the `Agent` tool with `isolation: "worktree"`, backgrounded by default — do not wait for it. Continue Pha 1 for the next ticket right away. Multiple tickets' `flow-execute` runs proceed concurrently, each in its own worktree.
- **`--mode sequential`**: dispatch the same way (`Agent` tool, `isolation: "worktree"`), but **wait for this ticket's Agent to fully complete** (verify + review done) before starting the next ticket's Pha 1 brainstorm. Still one worktree per ticket — sequential means one ticket fully finishes before the next one *starts*, not that they share a workspace.

Each dispatched Agent's prompt mirrors `/flow-batch`'s existing Pha 2 prompt exactly: read the plan, execute test-first, run the target project's documented verify commands (≤3 retry rounds), dispatch the mandatory adversarial review, return a structured PASS/FAIL report.

## 5. Resilience to quota/session interruptions

Overnight runs can span a session quota reset (observed directly in this session: two background Agent dispatches died mid-run from `You've hit your session limit`, both recovered cleanly because their work was already committed before the interruption). Design accordingly:

- Maintain a small ledger file per run: `docs/flow/loop-runs/<date>-ledger.md`, one line per ticket — `<ticket-id>: PENDING | IN-PROGRESS | READY | NEEDS-HUMAN | FAILED`, updated as each ticket's state changes.
- If a dispatched Agent dies mid-run (task-notification with `status: failed` and a quota/session-limit message), the ledger keeps that ticket at its last known state — a later invocation (manual re-run, or the next scheduled trigger) can inspect the ledger, skip tickets already `READY`/`NEEDS-HUMAN`, and re-dispatch anything still `IN-PROGRESS`/`PENDING`.
- This ledger is informational/resumability-only — it is never the source of truth for git state (the worktrees/branches/commits are), matching how this session already treated background-agent interruptions tonight (inspect `git log` in the worktree to see what actually landed before re-dispatching).

## 6. Morning report

After all `<N>` tickets are processed (or the run is interrupted and later resumed to completion), produce one aggregate report:
- **READY** tickets: branch/worktree, verify round count, review findings summary — same shape as `/flow-batch`'s existing per-feature report.
- **NEEDS-HUMAN** tickets: ticket ID + reason (Architectural classification, or missing/ambiguous AC) — these were never touched beyond the initial fetch+classify.
- **FAILED** tickets: which verify round failed, last output — same as `/flow-batch`'s existing FAILED handling.

No merging happens here. The human reviews the report, then runs `/pr --batch --target main` (unchanged, existing command) to actually publish/merge READY tickets — one branch at a time, per its own established gate.

## 7. What this explicitly does NOT change

- `/pr`'s merge gate (Orchestration Step 5's action-choice, Batch Step 5/7) — unchanged. `/loop-engineer` never merges.
- `/jira-sync`'s own read/update modes — unchanged; `/loop-engineer` reuses the same fetch mechanism internally but is a distinct command.
- `flow-execute`'s verify/review mechanics — unchanged, reused as-is per ticket.
