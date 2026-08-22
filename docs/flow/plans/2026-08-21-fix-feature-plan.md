# Fix-Feature Command Implementation Plan

**Goal:** `commands/fix-feature.md` — fast bug-fix loop (no brainstorm/plan stage, no approval gate), matching README Mục 3's original `/fix-feature` spec and the overlap table's "skip brainstorm+plan entirely" ruling.

**Approved design:** input adapter same shape as `/flow` but content is a bug report + repro steps; command synthesizes a minimal plan inline (no `planner` dispatch, no gate), writes it for record-keeping only, then hands off to `flow-execute` (which already has the ≤3-round verify loop + mandatory reviewer).

---

### Task 1: Create `commands/fix-feature.md`

**Files:**
- Create: `commands/fix-feature.md`

**Interfaces:**
- Consumes: `flow-execute` skill (exact name `flow-execute`), invoked with a plan file path.
- Produces: the `/fix-feature` slash command.

- [ ] **Step 1: Write the command file**

```markdown
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
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "d:/Github/MinhTQ-SDLC/commands/fix-feature.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder" "d:/Github/MinhTQ-SDLC/commands/fix-feature.md"`
Expected: no matches. Confirm `flow-execute` matches the exact `name:` field in `skills/flow-execute/SKILL.md`.

- [ ] **Step 4: Smoke-test the no-gate loop on a scratch repo with a real bug**

```bash
mkdir -p /tmp/flow-scratch/fix-repo && cd /tmp/flow-scratch/fix-repo
git init -q
mkdir -p src
cat > src/add.js <<'EOF'
function add(a, b) { return a - b; } // bug: should be a + b
module.exports = { add };
EOF
cat > CLAUDE.md <<'EOF'
# Scratch fix repo

## Test

Run: node -e "const {add}=require('./src/add'); if(add(2,3)!==5){process.exit(1)}; console.log('PASS');"
EOF
git add -A && git commit -q -m "init (bug: add subtracts instead of adds)"
```

Invoke `/fix-feature` with bare text: `"Bug: add(a, b) in src/add.js returns the wrong result. Repro: add(2, 3) returns -1, expected 5."` against `/tmp/flow-scratch/fix-repo`.
Expected: the transcript shows **no** `flow-brainstorm`/`flow-plan` invocation and **no** `AskUserQuestion` approval prompt at all before `flow-execute` starts — the plan file is written directly, then `flow-execute` runs immediately. Final report shows the bug fixed (`a - b` → `a + b`) and `verifier` PASS.

- [ ] **Step 5: Commit**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add commands/fix-feature.md && git commit -m "feat: add /fix-feature command (no-gate bug-fix loop)"
```

---

## Self-Review Notes

- **Spec coverage:** README Mục 3 `/fix-feature` (test-first, max 3 retries, no explicit gate) → Orchestration steps + Hard rules. Overlap table "skip brainstorm+plan entirely" → Step 2 explicit non-invocation + Step 4 smoke test asserting zero `AskUserQuestion` calls.
- **Placeholder scan:** literal, complete command content; no TBD.
- **Type/name consistency:** `flow-execute` matches the flow-core plan's Task 6 exactly. Plan-file naming pattern (`docs/flow/plans/YYYY-MM-DD-<topic>-plan.md`) matches `flow-plan`'s own convention, reused here for consistency even though this path skips `flow-plan` itself.
