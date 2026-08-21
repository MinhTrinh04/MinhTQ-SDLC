---
name: flow-execute
description: Third stage of the /flow pipeline. Executes an approved plan task-by-task (TDD when a test runner exists), then runs the verifier subagent for an independent pass/fail, retrying up to 3 rounds on failure, then runs the mandatory reviewer subagent. Never expands scope beyond the plan. Standalone rewrite mirroring superpowers:executing-plans's behavior, plus the verify/retry/review loop from the flow spec.
---

# flow-execute

## Input

The approved plan file path from `flow-plan`.

## Process

1. Read the plan file fully before starting.
2. Execute tasks in order. For each task: write the failing test first if a test runner exists in the project, run it to confirm it fails, implement the minimal change, run the test to confirm it passes, commit — exactly as the plan's steps specify. Do not skip steps, do not add steps not in the plan.
3. If you discover the plan is missing something required to finish a task, STOP and report it to the human — do not silently invent scope. This is the one case where you pause mid-execution.
4. After all tasks are done, dispatch the `verifier` subagent (Task 2) with the full diff/changed-file list.
   - PASS → continue to step 5.
   - FAIL → read the failure output, fix the specific issue, dispatch `verifier` again.
   - **Hard limit: 3 verify rounds total.** If round 3 still FAILs, STOP immediately — print the exact failing command/output from each of the 3 rounds — and do not attempt a 4th fix. This is not negotiable regardless of how close the failure looks to being fixed.
5. On verify PASS, dispatch the `reviewer` subagent with the full diff — this step is **mandatory**, never skipped, never optional.
6. Produce the final report: what was done, which commands verified it (with PASS/FAIL per command), what `reviewer` found (or "No issues found").

## Hard rules

- Never touch files outside what the plan's Files sections list.
- Never mark something "done" based on your own read of the code — only `verifier`'s PASS counts.
- Never call `reviewer` before `verifier` reports PASS — order matters, a review of broken code wastes the reviewer's time.
