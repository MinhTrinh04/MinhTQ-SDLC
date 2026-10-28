---
name: flow-plan
description: Second stage of the /flow pipeline. Takes an approved design/spec, dispatches the planner subagent to survey the codebase, and writes a concrete implementation plan file. Stops for human approval before execution. Standalone rewrite mirroring superpowers:writing-plans's behavior.
---

# flow-plan

## Input

The approved design (chat text) or spec file path from `flow-brainstorm`. You only run after that approval has been given. If invoked by a command that explicitly states the input is already an approved design (e.g. `/scaffold` passing a spec/API description that skips `flow-brainstorm` entirely), trust that statement and proceed directly — do not ask for a second confirmation, that would be a redundant gate the caller already accounted for. Only ask for confirmation when invoked with no such statement and it's genuinely unclear whether approval happened.

Optionally, the caller may also pass an `auto_approve: true` instruction (e.g. from `/flow --auto-approve`, `/flow-batch --auto-approve`). This only removes the Step 6 approval gate — it never skips Step 5's self-review or lets unfinished stand-in content slip through.

## Process

1. Dispatch the `planner` subagent (`Agent` tool, `subagent_type: "planner"`) with the approved design and the target repo path. Let it survey the codebase and return a draft plan.
2. Turn the draft into the final plan document: numbered tasks, each with exact Files (create/modify/test) and Interfaces (consumes/produces — exact names/types so a task can be read alone), bite-sized steps (one action each), test-first when a test runner exists in the project.
3. No unfinished stand-ins: every step must have real content — actual code, actual commands, actual expected output. Never "add tests for the above" or leave a value undecided for later.
4. Write the plan doc content in **Vietnamese** (technical jargon — SOLID, API, REST, class/function names, code snippets, exact commands, file paths — stays in English/as-is; this is normal Vietnamese tech-writing code-switching, not a translation exercise). This Vietnamese rule applies only to plan doc *content* — it never applies to any `commands/*.md`/`skills/*/SKILL.md` file this plan describes creating elsewhere; those stay English, unchanged, following existing sibling conventions.

   Before saving, check whether `docs/flow/plans/<feature>-plan.md` already exists for this feature/command (glob `docs/flow/plans/*<feature-slug>*plan.md` — match by feature/command name, not by date).
   - If it already exists: append this plan as a new section at the end of that SAME file — `### Task N: <short title> (added YYYY-MM-DD)`, continuing the task numbering from where the file left off (never restart numbering, never duplicate an existing Task N). Do not create a new file, do not put the date in the filename. If that existing file is in English (predates this rule), still append the new section in Vietnamese — do not translate the rest of the file.
   - If it does not exist yet: create `docs/flow/plans/<feature>-plan.md` (no date in the filename — the date lives in each Task's heading if it matters later). This is the only case that creates a new file.
   - **Do not commit yet** — writing the file is a local, uncommitted change at this point. Commit only happens in Step 6, after approval.
5. Self-review: check every requirement from the approved design has a task, check no unfinished stand-in content slipped in, check type/signature names are consistent task-to-task. Fix inline.
6. The plan file is on disk but **not yet committed**.
   - **If `auto_approve` was NOT set:** report the plan's path and a short summary (task count + one-line title per task — not the full body; the file is the reading surface). **STOP and ask via `AskUserQuestion`.** Present the gate as an explicit choice, e.g.:
     - "Approve — commit and proceed to flow-execute" (recommended)
     - "Request changes — describe what to adjust" (free text via the tool's built-in Other option)
     - "Reject — stop here"
     Never end the turn on a plain prose question expecting free-text "ok".
     - **"Approve":** only now run `git add`/`git commit` for the plan file. Then let `flow-execute` run.
     - **"Request changes":** revise the file content in place (still uncommitted — no commit exists yet to amend), re-print it, ask again. Repeat until Approve or Reject.
     - **"Reject":** stop here. Leave the file on disk, uncommitted — do not delete it (the human may still want to see the draft) and do not commit it under any circumstance.
   - **If `auto_approve` was set:** skip `AskUserQuestion` entirely. `git add`/`git commit` the plan file immediately. Print one line — `Auto-approved (--auto-approve): plan committed at <path> (N tasks).` — and return control to the caller.

## Quiet delegation (whenever you dispatch `planner`)

- End the `planner` prompt with an output budget: "Return only the plan. No preface and no recap of what you surveyed."
- Do not narrate the survey while it runs and do not echo the planner's draft into chat; the plan file is the reading surface (see the rule below). Relay at most a short summary (task count, one line per task).

## Hard rules

- Never create a new dated plan file for a feature that already has one — append a new Task section to the existing `docs/flow/plans/<feature>-plan.md` instead. A new file is only for a feature with no existing plan doc at all.
- Never execute anything from the plan yourself — you only write it.
- Never accept the `planner` subagent's draft verbatim if it contains unfinished stand-in content or vague steps — tighten it before saving.
- The approval gate in Step 6 uses `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply.
- Never commit the plan file before "Approve" is selected, unless `auto_approve` was set — write it, present it, ask, only then commit. A "Request changes" or "Reject" response must never result in a commit.
- Never write new plan doc content in English — Vietnamese prose with English technical jargon where natural, for any file created from this point forward. Never retroactively translate an existing English plan file when appending a new section to it.
- Never print the full plan doc content into chat — a short summary (task titles) + file path pointer only; the file is the reading surface, not the chat transcript.
- Never let `auto_approve` skip Step 5's self-review or let unfinished stand-in content through — it only removes the Step 6 approval gate.
