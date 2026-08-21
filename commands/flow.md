---
description: Run the full flow pipeline (brainstorm → plan → execute → verify → review) for one requirement, from Jira, a file, or plain text.
---

# /flow

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + acceptance criteria). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the requirement.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available on the machine, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the requirement.

No other input form is supported — do not guess the source from the argument's shape.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized requirement block: `{source, content, origin_link}`.
2. Invoke the `flow-brainstorm` skill with that block.
3. **Wait for explicit human approval** of the design. Do not proceed on an ambiguous or implied yes — ask directly if unclear.
4. Invoke the `flow-plan` skill with the approved design.
5. **Wait for explicit human approval** of the plan.
6. Invoke the `flow-execute` skill with the approved plan's file path.
7. Print `flow-execute`'s final report verbatim to the user — do not summarize away a FAIL into something softer.

## Hard rules

- Never skip an approval wait because the change "looks small."
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
