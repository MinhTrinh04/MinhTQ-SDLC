---
description: Run flow-brainstorm+flow-plan sequentially (gated) for a batch of features; as soon as each feature's plan is approved, immediately dispatch it to execute+verify+review in the background, one isolated worktree per feature, via the Agent tool.
---

# /flow-batch

Arguments: `$ARGUMENTS` — exactly one of:
- `--jira "ID1,ID2,ID3"` — comma-separated Jira ticket IDs. Requires the Jira/Atlassian MCP connector already authorized; if not, say so plainly and STOP (do not process any feature via a guessed requirement).
- `--file "path1.md,path2.md"` — comma-separated file paths, each read via the Read tool. `.md`/`.txt`/`.pdf` only — `.doc`/`.docx` cannot be read directly; report which file(s) need converting and STOP for those, but continue with the others if at least one is valid.
- Plain text, one feature description per line — each non-empty line is one feature.

Build a list of normalized requirement blocks: `[{name, source, content, origin_link}]`. `name` is a short slug derived from the ticket ID / file basename / first few words of the text line — used later for the worktree branch name and the report.

Optionally, combine with a trailing `--auto-approve` flag (e.g. `/flow-batch --jira "A-1,A-2" --auto-approve`). It removes both Pha 1 approval gates for every feature in the batch — see "Auto-approve mode" below. Pha 2 already dispatches into an isolated worktree in the background regardless of this flag; `--auto-approve` does not change Pha 2's mechanics, only Pha 1's gates.

## Pha 1 — Brainstorm + Plan (sequential, gated)

For each feature in the list, **in order, one at a time**:

1. Invoke the `flow-brainstorm` skill with that feature's requirement block. If `--auto-approve` was passed, also pass `auto_approve: true`.
2. **If `--auto-approve` was NOT passed:** wait for explicit human approval of the design before moving on — `flow-brainstorm` asks this via `AskUserQuestion` with concrete options (Approve/Request changes/Reject), never a bare prose question. Never batch multiple features' approvals into one prompt — one feature's design, one approval, then proceed.
   **If `--auto-approve` was passed:** `flow-brainstorm` commits the spec itself (or has no file to commit, for Bounded/Spike) and returns — no live wait; move straight to step 3.
3. Invoke the `flow-plan` skill with the approved design. If `--auto-approve` was passed, also pass `auto_approve: true`.
4. **If `--auto-approve` was NOT passed:** wait for explicit human approval of the plan — `flow-plan` asks this via `AskUserQuestion` the same way. **If `--auto-approve` was passed:** `flow-plan` commits the plan itself and returns — no live wait.
5. The moment this feature's plan is approved (live gate) or committed (`--auto-approve`), immediately dispatch it into Pha 2 (below) — do not wait for any other feature in the list. Then move on to the next feature's brainstorm.

If a feature's brainstorm reveals it should be dropped or split, say so and adjust the list before dispatching it — never dispatch a bad feature into Pha 2 just to keep the loop moving.

## Pha 2 — Execute (immediate dispatch, isolated, autonomous, background)

As soon as a feature's plan is approved in Pha 1 (step 5 above), call the `Agent` tool for that single feature — do not batch this call, do not wait for other features. Pass `isolation: "worktree"`. Do not pass `run_in_background: false` — the `Agent` tool runs subagents in the background by default, so this call returns immediately and the main thread proceeds straight to the next feature's Pha 1 loop.

The Agent's prompt (substitute `name`, `planPath`, `repoPath` for this one feature):

    You are executing an approved implementation plan for feature "{name}", in repo {repoPath}.

    Read the plan file at {planPath} fully before starting.

    Execute its tasks in order exactly as written: test-first when a test runner exists, minimal implementation, run the test, commit — do not skip steps, do not add steps not in the plan. Never touch files outside what the plan's Files sections list. If the plan is missing something required to finish a task, stop and report it instead of inventing scope.

    After all tasks are done: read this project's CLAUDE.md to find its test/lint/build commands (never guess a command; if none is documented, say so). Run those commands via Bash and capture full output.

    If a command FAILs: read the failure output, fix the specific issue, re-run. Hard limit: 3 verify rounds total. If round 3 still FAILs, STOP — do not attempt a 4th fix — and report status FAIL with all 3 rounds' exact command and output.

    Once verify PASSes (status PASS), review your own diff adversarially, as if you did not write it: look specifically for logic edge cases, security issues (injection, auth bypass, secrets, unsafe deserialization), race conditions, and silent data loss that the tests likely do not cover. Report findings one per line as `path:line: <severity> <problem>. <concrete failure scenario>.` If you find nothing, say exactly "No issues found in reviewed scope." — do not manufacture a finding.

    Return your final report as plain text in exactly this shape, in this order, with no extra commentary before or after it. This is a condensed report for chat — the full command output already lives in your own tool-call history/the worktree, never re-paste it here:

    STATUS: PASS or FAIL

    VERIFY: <N> round(s), each as one line: "Round K: command=<exact command> result=PASS/FAIL" — no output body on a PASS line. On the FIRST round that FAILs, add one line directly under it with just the one-line error message/failing assertion (not the full stdout dump). If the final round is FAIL (hard stop at round 3), that round's line also gets the exact failing command and its full output in full — this is the one case where full detail is warranted, since there's no further fix to summarize.

    REVIEW FINDINGS:
    <one finding per line as specified above, or "No issues found in reviewed scope."> — never trimmed, never softened.

    SUMMARY:
    <2-4 sentences: what was implemented, any real deviation from the plan disclosed inline, nothing else — not a walkthrough of every file touched>

    Also state which git worktree path and branch name hold your changes.

Each dispatched Agent's completion arrives later as a background task-notification, independently of the others and independently of how far Pha 1 has progressed for remaining features. The moment a notification arrives for a feature, report it to the user right away — name, status, verify round count, review findings summary, worktree/branch — do not hold it back or batch it together with other features' results, and do not soften a FAIL into something gentler. Tell the user to review and merge with `superpowers:finishing-a-development-branch` one branch at a time — never auto-merge.

## Auto-approve mode (`--auto-approve`)

- Removes both Pha 1 gates (design, plan) for every feature in the batch — `flow-brainstorm`/`flow-plan` write and commit their files unattended per feature instead of stopping for a human click.
- Never suppresses `flow-brainstorm`'s Step 4 genuine clarifying questions or `flow-plan`'s Step 5 self-review — those still run per feature; only the final approve/reject stop is skipped.
- Does not change Pha 2 at all — dispatch was already immediate, isolated (worktree), and backgrounded before this flag existed.
- Never merges anything — same as without the flag, `/pr` and its own gate still own merging.

## Hard rules

- Never dispatch a feature's Pha 2 Agent call before that specific feature's plan is approved (or committed, under `--auto-approve`) — other features in the batch may still be earlier in Pha 1 at that moment, and that's fine.
- Never wait for a dispatched Agent to finish before continuing Pha 1 for the next feature — the dispatch call must not block the main thread.
- Never let a dispatched Agent wait for human input mid-run — if it reports it's blocked, that surfaces in its final report, not as a live prompt.
- Never batch multiple features' completion reports together — report each one to the user as soon as its background notification arrives.
- Never merge branches yourself after a feature's Pha 2 completes — only report and hand off to the user.
- Never let `--auto-approve` bypass `flow-execute`'s verify/review loop inside Pha 2, or the eventual `/pr` merge gate — it only removes the two Pha 1 approval stops.
- Never let the condensed report format drop or soften a FAIL, a review finding, or a real plan deviation — condensing only removes redundant full-success-output dumps, never substance.
