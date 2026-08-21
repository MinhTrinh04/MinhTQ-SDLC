---
name: flow-plan
description: Second stage of the /flow pipeline. Takes an approved design/spec, dispatches the planner subagent to survey the codebase, and writes a concrete implementation plan file. Stops for human approval before execution. Standalone rewrite mirroring superpowers:writing-plans's behavior.
---

# flow-plan

## Input

The approved design (chat text) or spec file path from `flow-brainstorm`. You only run after that approval has been given. If invoked by a command that explicitly states the input is already an approved design (e.g. `/scaffold` passing a spec/API description that skips `flow-brainstorm` entirely), trust that statement and proceed directly — do not ask for a second confirmation, that would be a redundant gate the caller already accounted for. Only ask for confirmation when invoked with no such statement and it's genuinely unclear whether approval happened.

## Process

1. Dispatch the `planner` subagent (`Agent` tool, `subagent_type: "planner"`) with the approved design and the target repo path. Let it survey the codebase and return a draft plan.
2. Turn the draft into the final plan document: numbered tasks, each with exact Files (create/modify/test) and Interfaces (consumes/produces — exact names/types so a task can be read alone), bite-sized steps (one action each), test-first when a test runner exists in the project.
3. No placeholders: every step must have real content — actual code, actual commands, actual expected output. Never "add tests for the above" or "TBD".
4. Save to `docs/flow/plans/YYYY-MM-DD-<topic>-plan.md` in the target repo, commit it.
5. Self-review: check every requirement from the approved design has a task, check no placeholders slipped in, check type/signature names are consistent task-to-task. Fix inline.
6. **STOP and ask via `AskUserQuestion`.** Report the plan's path, then present the gate as an explicit choice, e.g.:
   - "Approve — proceed to flow-execute" (recommended)
   - "Request changes — describe what to adjust" (free text via the tool's built-in Other option)
   - "Reject — stop here"
   Never end the turn on a plain prose question expecting free-text "ok". Do not let `flow-execute` run until "Approve" is selected.

## Hard rules

- Never execute anything from the plan yourself — you only write it.
- Never accept the `planner` subagent's draft verbatim if it contains placeholders or vague steps — tighten it before saving.
- The approval gate in Step 6 uses `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply.
