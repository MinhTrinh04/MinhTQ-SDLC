# Scaffold Command Implementation Plan

**Goal:** `commands/scaffold.md` — scaffold BE endpoint + FE service call + matching types from an already-approved spec/API description, skipping `flow-brainstorm` (plan → execute → verify only), per README Mục 3 and the overlap table in `docs/flow/specs/loop-engineering-flow-design.md` Mục 3.

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

---

### Task 2: Rewrite `/scaffold` to always brainstorm tech-stack approaches first (added 2026-08-22)

**Rationale:** the original design (Task 1) assumed `/scaffold`'s input was always an already-approved spec/API description. In practice the command is also invoked with a bare project idea, not a ready spec — and choosing a tech stack is a subjective human decision (README Mục 0.5), so it must never be skipped or auto-decided. This task reverses the "skip flow-brainstorm entirely" premise: `flow-brainstorm` now always runs first, forced (via an explicit override in the invocation, mirroring `/optimize`'s pattern) to always produce 2-3 approaches regardless of classification, with the human picking via `AskUserQuestion` before `flow-plan` runs.

**Files:**
- Modify: `commands/scaffold.md`

**Interfaces:**
- Consumes: `flow-brainstorm` skill (name `flow-brainstorm`), `flow-plan` skill (name `flow-plan`), `flow-execute` skill (name `flow-execute`) — all exactly as already built, no changes to those files. `verifier` subagent is invoked internally by `flow-execute`, not called a second time by this command.
- Produces: the updated `/scaffold` slash command.

- [ ] **Step 1: Rewrite `commands/scaffold.md` to its new final content**

```markdown
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
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "commands/scaffold.md"`
Expected: file exists, size > 0, content matches Step 1 above exactly.

- [ ] **Step 3: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder" "commands/scaffold.md"`
Expected: no matches. Confirm `flow-brainstorm`/`flow-plan`/`flow-execute`/`verifier` names match `skills/flow-brainstorm/SKILL.md`, `skills/flow-plan/SKILL.md`, `skills/flow-execute/SKILL.md`, `agents/verifier.md` exactly.

- [ ] **Step 4: Smoke-test the always-brainstorm path on a scratch repo**

```bash
mkdir -p /tmp/flow-scratch/scaffold-repo-2 && cd /tmp/flow-scratch/scaffold-repo-2
git init -q
cat > CLAUDE.md <<'EOF'
# Scratch scaffold repo 2

## Build

Run: node -e "process.exit(0)"
EOF
git add -A && git commit -q -m "init"
```

Invoke `/scaffold` with bare text: `"A tiny notes API: users can create and list short text notes"` against `/tmp/flow-scratch/scaffold-repo-2`.
Expected: transcript shows exactly two `AskUserQuestion` gates before `flow-plan` even starts — (1) `flow-brainstorm`'s "approaches are sound" gate, (2) the separate "pick one approach" gate (with an "Other" option visible) — then `flow-plan`'s own approval gate (third overall), then `flow-execute` running and reporting a verify result. Total: three approval gates for the whole run, and no step silently defaults to a single approach.

- [ ] **Step 5: Commit**

```bash
git add commands/scaffold.md docs/flow/plans/scaffold-plan.md && git commit -m "feat(scaffold): always brainstorm 2-3 tech-stack approaches before planning"
```

## Self-Review Notes (Task 2)

- **Spec coverage:** approved design's five bullet points → Orchestration steps 2-6 (brainstorm always runs, override wording matches `/optimize` exactly, separate pick gate with "Other" mention, flow-plan invoked with chosen approach as approved design) plus updated Hard rules and input-adapter/opening-paragraph wording.
- **Precedent match:** override-instruction wording is character-for-character parallel to `commands/optimize.md` Orchestration step 4, substituting "tech-stack" for the optimize wording and citing README Mục 0.5 the same way `docs/flow/plans/optimize-plan.md`'s own Self-Review Notes do.
- **Stale-wording removal:** old opening paragraph and Hard rules asserting "flow-brainstorm is skipped entirely" / "redirect to /flow" fully removed — no leftover contradiction between prose and Orchestration.
- **Known non-change flagged:** `skills/flow-plan/SKILL.md`'s Input section still names `/scaffold` as *the* example of a command that "skips flow-brainstorm entirely". That line is not edited by this task — a caller can still assert "already approved" to flow-plan, which is exactly what `/scaffold` Orchestration step 5 now does after the human picks an approach — but the specific example naming is now stale/misleading about `/scaffold`'s own default path and should be revisited in a follow-up doc pass.
- **Known non-change flagged:** `README.md`'s `/scaffold` section (Mục 3) still describes the old flow with no brainstorm/tech-stack-pick step — out of scope for this task (only `commands/scaffold.md` and this plan doc were named), worth a deliberate follow-up decision.
- **Placeholder scan:** command content is literal and complete; no TBD.
- **Type/name consistency:** `flow-brainstorm`, `flow-plan`, `flow-execute`, `verifier` match the names already defined in the flow-core plan and used identically in `/optimize` — no renaming.
