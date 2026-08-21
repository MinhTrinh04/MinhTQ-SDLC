# Scaffold Command Implementation Plan

**Goal:** `commands/scaffold.md` — scaffold BE endpoint + FE service call + matching types from an already-approved spec/API description, skipping `flow-brainstorm` (plan → execute → verify only), per README Mục 3 and the overlap table in `docs/flow/specs/2026-08-21-loop-engineering-flow-design.md` Mục 3.

**Approved design:** same input adapter as `/flow`; input IS the approved design (no brainstorm Q&A); one approval gate (after `flow-plan`); `flow-execute` implements and verifies via `verifier` (build pass + integration test call if one exists).

---

### Task 1: Create `commands/scaffold.md`

**Files:**
- Create: `commands/scaffold.md`

**Interfaces:**
- Consumes: `flow-plan` skill (name `flow-plan`) and `flow-execute` skill (name `flow-execute`) exactly as already built — no changes to those files. `verifier` subagent is invoked internally by `flow-execute`, not called a second time by this command.
- Produces: the `/scaffold` slash command.

- [ ] **Step 1: Write the command file**

```markdown
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
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "d:/Github/MinhTQ-SDLC/commands/scaffold.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder" "d:/Github/MinhTQ-SDLC/commands/scaffold.md"`
Expected: no matches. Also confirm by inspection that `flow-plan`/`flow-execute`/`verifier` names match exactly the `name:`/agent-identity fields in `skills/flow-plan/SKILL.md`, `skills/flow-execute/SKILL.md`, `agents/verifier.md`.

- [ ] **Step 4: Smoke-test the skip-brainstorm path on a scratch repo**

```bash
mkdir -p /tmp/flow-scratch/scaffold-repo && cd /tmp/flow-scratch/scaffold-repo
git init -q
cat > CLAUDE.md <<'EOF'
# Scratch scaffold repo

## Build

Run: node -e "process.exit(0)"
EOF
git add -A && git commit -q -m "init"
```

Invoke `/scaffold` with bare text: `"Add a GET /ping endpoint that returns { status: 'ok' }, plus a minimal fetchPing() client function"` against `/tmp/flow-scratch/scaffold-repo`.
Expected: the transcript shows `flow-plan` running directly (no `flow-brainstorm` step at all), stopping once for approval via `AskUserQuestion`, then `flow-execute` running and reporting a verify result — exactly one approval gate total for the whole run, not two.

- [ ] **Step 5: Commit**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add commands/scaffold.md && git commit -m "feat: add /scaffold command (plan+execute+verify, skips brainstorm)"
```

---

## Self-Review Notes

- **Spec coverage:** README Mục 3 `/scaffold` description → Orchestration steps 1-5. Overlap table (design spec Mục 3, "skip flow-brainstorm") → explicit hard rule + Step 4 smoke test asserting exactly one gate.
- **Placeholder scan:** command content is literal and complete; no TBD.
- **Type/name consistency:** `flow-plan`, `flow-execute`, `verifier` match the names already defined in the flow-core plan's Tasks 2, 5, 6 — no renaming.
