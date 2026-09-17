---
name: flow-execute
description: Third stage of the /flow pipeline. Executes an approved plan task-by-task (TDD when a test runner exists), then runs the verifier subagent for an independent pass/fail, retrying up to 3 rounds on failure, then runs the mandatory reviewer subagent. Never expands scope beyond the plan. Standalone rewrite mirroring superpowers:executing-plans's behavior, plus the verify/retry/review loop from the flow spec.
---

# flow-execute

## Input

The approved plan file path from `flow-plan`.

## Process

1. Read the plan file fully before starting. Do not print or re-quote the plan's content into chat — it was already presented (or auto-approved) at the `flow-plan` gate; reading it here is silent, internal context-gathering, not something to narrate back.
2. Execute tasks in order. For each task: write the failing test first if a test runner exists in the project, run it to confirm it fails, implement the minimal change, run the test to confirm it passes, commit — exactly as the plan's steps specify. Do not skip steps, do not add steps not in the plan. Report progress in chat as short one-line-per-task pings ("Task 3: <title> — done"), not a restatement of that task's Files/Interfaces/steps from the plan doc.
3. If you discover the plan is missing something required to finish a task, STOP and report it to the human — do not silently invent scope. This is the one case where you pause mid-execution.
4. After all tasks are done, dispatch the `verifier` subagent (Task 2) with the full diff/changed-file list — this whole step covers ONE verify cycle for the WHOLE plan (`verifier` is never dispatched per-task; every "round" below is a round of this one plan-level verify cycle). Before the first dispatch, check the target `CLAUDE.md` for a `## Test (changed-only)` section — if present, tell `verifier` this round may use the changed-only command; if absent, tell `verifier` to always use the full suite (no change from today).
   - PASS → if a changed-only command was declared AND this is the first PASS seen in this verify cycle (i.e. no full-suite confirmation round has run yet in this cycle), dispatch `verifier` exactly one more time telling it to run the full-suite command as a confirmation round. This confirmation round does **not** count against the ≤3 retry budget below.
     - Confirmation round PASS → Overall: PASS, continue to step 5.
     - Confirmation round FAIL → treat this as a real FAIL: it now counts as round 1 against the ≤3-round budget from here on, go back and fix the specific issue, and for every remaining round **in this verify cycle** always tell `verifier` to use the full suite (never changed-only again for the rest of this cycle, even though `CLAUDE.md` still declares a changed-only command). This switch applies only to this one verify cycle — a later, separate `flow-execute` invocation (e.g. resuming after a Step 3 STOP) starts a fresh cycle and may use changed-only again from its own round 1.
   - If no `## Test (changed-only)` section is declared, or a full-suite confirmation round already ran and PASSed in this cycle: PASS → continue to step 5 directly, no confirmation round (this is identical to today's behavior).
   - FAIL (from any round that counts against the budget) → read the failure output, fix the specific issue, dispatch `verifier` again.
   - **Hard limit: 3 verify rounds total per cycle, counting only rounds run because of a real FAIL needing a fix** (the one-time full-suite confirmation-after-first-PASS round never counts toward this limit; a confirmation-round FAIL DOES start counting from that point). If the 3rd counted round still FAILs, STOP immediately — print the exact failing command/output from each of the 3 counted rounds — and do not attempt a 4th fix. This is not negotiable regardless of how close the failure looks to being fixed.
5. On verify PASS, dispatch the `reviewer` subagent with the full diff — this step is **mandatory**, never skipped, never optional.
6. Produce the final report: what was done, which commands verified it (with PASS/FAIL per command), what `reviewer` found (or "No issues found").

## Hard rules

- Never touch files outside what the plan's Files sections list.
- Never mark something "done" based on your own read of the code — only `verifier`'s PASS counts.
- Never call `reviewer` before `verifier` reports PASS — order matters, a review of broken code wastes the reviewer's time.
- Never print the plan file's content (or a task's Files/Interfaces/steps block) into chat during execution — the plan was already shown at its own gate; chat during execution gets short progress pings only.
