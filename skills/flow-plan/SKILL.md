---
name: flow-plan
description: Second stage of the /flow pipeline. Takes an approved design/spec, dispatches the planner subagent to survey the codebase, and writes a concrete implementation plan file. Stops for human approval before execution. Standalone rewrite mirroring superpowers:writing-plans's behavior.
---

# flow-plan

## Input

The approved design (chat text) or spec file path from `flow-brainstorm`. You only run after that approval has been given — the `/flow` command enforces this, but if invoked directly, ask for confirmation the design was approved before proceeding.

## Process

1. Dispatch the `planner` subagent (`Agent` tool, `subagent_type: "planner"`) with the approved design and the target repo path. Let it survey the codebase and return a draft plan.
2. Turn the draft into the final plan document: numbered tasks, each with exact Files (create/modify/test) and Interfaces (consumes/produces — exact names/types so a task can be read alone), bite-sized steps (one action each), test-first when a test runner exists in the project.
3. No placeholders: every step must have real content — actual code, actual commands, actual expected output. Never "add tests for the above" or "TBD".
4. Save to `docs/flow/plans/YYYY-MM-DD-<topic>-plan.md` in the target repo, commit it.
5. Self-review: check every requirement from the approved design has a task, check no placeholders slipped in, check type/signature names are consistent task-to-task. Fix inline.
6. **STOP.** Report the plan's path and wait for explicit human approval before `flow-execute` may run.

## Hard rules

- Never execute anything from the plan yourself — you only write it.
- Never accept the `planner` subagent's draft verbatim if it contains placeholders or vague steps — tighten it before saving.
