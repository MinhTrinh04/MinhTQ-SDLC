---
description: Brainstorm 2-3 tech-stack approaches for a new feature/API idea, let the human pick, then scaffold BE endpoint + FE service call + matching types (brainstorm → plan → execute → verify).
---

# /scaffold

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + acceptance criteria). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the requirement.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available on the machine, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the project idea/description.

No other input form is supported — do not guess the source from the argument's shape.

Unlike `/flow`, the input here does not need to already be a ready spec/API description — a project idea is enough. `flow-brainstorm` always runs first to turn that idea into 2-3 concrete tech-stack approaches; the human then picks one before anything is planned or built.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized requirement block: `{source, content, origin_link}`.
2. Invoke the `flow-brainstorm` skill with the requirement block, with this explicit override in the invocation instructions: "Always produce 2-3 tech-stack approaches with trade-offs, regardless of classification — never auto-select one; choosing a tech stack is always a subjective human decision (README Mục 0.5)." This overrides `flow-brainstorm`'s own Step 5 default of "Bounded: one concrete approach."
3. Wait for `flow-brainstorm`'s own approval gate (its own `AskUserQuestion`, Approve/Request changes/Reject) confirming the *set of approaches* is sound — this is not yet the "pick one" gate.
4. Once approved, present the 2-3 approaches to the human via a **separate** `AskUserQuestion` call, one option per approach. Mention plainly that they can also use the tool's built-in free-text "Other" option to propose their own stack instead of picking a presented option. Do not proceed until one is explicitly selected (a presented option or an "Other" free-text answer).
5. Invoke the `flow-plan` skill directly with the chosen approach as the approved design (state explicitly in the invocation that this is already human-approved — `flow-plan`'s own "trust an already-approved design" branch applies here, so it will not ask a second confirmation).
6. **Wait for explicit human approval** of the plan — `flow-plan` itself asks this via `AskUserQuestion` with concrete options (Approve/Request changes/Reject), never a bare prose question. Do not proceed on an ambiguous or implied yes.
7. Invoke the `flow-execute` skill with the approved plan's file path. `flow-execute` implements the BE endpoint, FE service call, and matching types per the plan, then dispatches the `verifier` subagent to confirm the build passes and, if an integration test exists, call the endpoint through it.
8. Print `flow-execute`'s final report verbatim to the user — do not summarize away a FAIL into something softer.

## Hard rules

- Never skip `flow-brainstorm` for this command, even if the input already looks like a ready spec/API description — always produce 2-3 tech-stack approaches first.
- Never let `flow-brainstorm` collapse to one approach here, even for a "bounded" classification — this command always needs 2-3 with trade-offs.
- Never auto-select an approach — the human must pick via `AskUserQuestion`, every time (a presented option or their own "Other" free-text stack).
- Never skip the plan approval wait because the change "looks small."
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Build pass (via `verifier`) is sufficient to call the scaffold done; complex business logic still needs separate human review — say this plainly in the final report rather than implying full correctness.
