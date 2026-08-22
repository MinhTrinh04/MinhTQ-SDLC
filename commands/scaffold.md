---
description: Scaffold BE endpoint + FE service call + matching types from an already-approved spec/API description, skipping brainstorm (plan → execute → verify).
---

# /scaffold

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + acceptance criteria). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the requirement.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available on the machine, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the requirement.

No other input form is supported — do not guess the source from the argument's shape.

Unlike `/flow`, the input here is treated as an **already-approved** spec/API description (an OpenAPI description or a feature spec), not a raw requirement — `flow-brainstorm` is skipped entirely, no Q&A stage runs. If the user actually wants a brainstorm/Q&A pass first, say so and point them at `/flow` instead of guessing an answer here.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized spec block: `{source, content, origin_link}`.
2. Invoke the `flow-plan` skill directly with that spec block — do not invoke `flow-brainstorm` first; the input already is the approved design.
3. **Wait for explicit human approval** of the plan — `flow-plan` itself asks this via `AskUserQuestion` with concrete options (Approve/Request changes/Reject), never a bare prose question. Do not proceed on an ambiguous or implied yes.
4. Invoke the `flow-execute` skill with the approved plan's file path. `flow-execute` implements the BE endpoint, FE service call, and matching types per the plan, then dispatches the `verifier` subagent to confirm the build passes and, if an integration test exists, call the endpoint through it.
5. Print `flow-execute`'s final report verbatim to the user — do not summarize away a FAIL into something softer.

## Hard rules

- Never invoke `flow-brainstorm` for this command — the spec/API description given is already the approved design. If asked to "brainstorm first" here, redirect to `/flow` instead of guessing.
- Never skip the plan approval wait because the change "looks small."
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Build pass (via `verifier`) is sufficient to call the scaffold done; complex business logic still needs separate human review — say this plainly in the final report rather than implying full correctness.
