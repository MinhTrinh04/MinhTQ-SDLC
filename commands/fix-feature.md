---
description: Fast bug-fix loop — reads a bug report + repro steps, writes a failing test that reproduces it, fixes it minimally, and hands off to flow-execute for the verify/review loop. No brainstorm/plan stage, no approval gate.
---

# /fix-feature

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + steps to reproduce). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the bug.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the bug report.

No other input form is supported — do not guess the source from the argument's shape.

The content here is a **bug report + steps to reproduce**, not a feature spec — do not route it through `flow-brainstorm` or `flow-plan`.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized bug report block: `{source, content, origin_link}`.
2. Do **not** invoke `flow-brainstorm` or `flow-plan` — this command has no human approval gate. Synthesize a minimal implementation plan inline, derived directly from the repro steps in the bug report:
   - Task 1: if the target project has a test runner, write a failing test that reproduces the bug (derive the exact repro steps/inputs from the bug report; run it to confirm it fails before touching any fix code). If the project has **no** test runner (check for a documented test command in its `CLAUDE.md` first), fall back to a manual verification step instead: a single documented command (matching the style `verifier` expects from `CLAUDE.md`) that reproduces the bug's exact observable symptom, with its current (buggy) output recorded — do not silently skip this task just because no test framework exists.
   - Task 2: implement the minimal fix.
   - Task 3: rerun the test (or manual verification command) from Task 1 to confirm it now PASSes / shows the corrected output.
3. Write this synthesized plan to `docs/flow/plans/YYYY-MM-DD-fix-<slug>-plan.md`, where `<slug>` is derived from the first few words of the bug title, lowercased, with every character other than `a-z`, `0-9`, and `-` stripped or replaced with `-` (collapse repeats) — never pass raw bug-report text into a file path unsanitized. Record-keeping only: no `planner` subagent dispatch, no `AskUserQuestion` approval wait. State plainly in the file itself that it was auto-synthesized by `/fix-feature`, not reviewed like a `flow-plan` output.
4. Invoke the `flow-execute` skill directly with that plan file's path. `flow-execute` handles the ≤3-round verify retry loop (via the `verifier` subagent) and the mandatory `reviewer` subagent — do not reimplement retry logic here.
5. Print `flow-execute`'s final report verbatim to the user — do not summarize away a FAIL into something softer.

## Hard rules

- Never invoke `flow-brainstorm` or `flow-plan` from this command — there is no approval gate, by design, unlike `/flow` and `/flow-batch`.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never skip writing the record-keeping plan file, even though there is no approval wait on it.
- Never let `flow-execute` skip its own verify/review loop — this command relies on it entirely for the "max 3 lần lặp" requirement; do not add a second retry loop here.
