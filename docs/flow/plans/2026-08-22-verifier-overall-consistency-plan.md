# Verifier Overall-Value Consistency Implementation Plan

**Goal:** `agents/verifier.md` produces a deterministic `Overall: FAIL` when no test/lint/build command is documented — never a third value like `NOT_APPLICABLE`.

**Approved design:** add an explicit clause to Step 1 and clarify Output format that `Overall` only ever has two values. No policy change — unverifiable still blocks, per the strict decision already made in `/pr --batch` usage.

---

### Task 1: Fix `agents/verifier.md`

**Files:**
- Modify: `agents/verifier.md`

**Interfaces:** none — prompt-only subagent, no code interface change. Used by `flow-execute`, `/pr --batch`, and any future flow-* caller.

- [ ] **Step 1: Add explicit clause to "What you do" Step 1**

Old:
```
1. Read the target project's `CLAUDE.md` (or equivalent project doc) to find its test, lint, and build commands. If none is documented, say so explicitly in your report — do not guess a command.
```
New:
```
1. Read the target project's `CLAUDE.md` (or equivalent project doc) to find its test, lint, and build commands. If none is documented, say so explicitly in your report — do not guess a command. This is not a neutral outcome: not being able to verify means you cannot confirm the change is safe, so it counts as **Overall: FAIL** — never report a third value (e.g. "NOT_APPLICABLE") for Overall just because nothing was documented to run.
```

- [ ] **Step 2: Clarify the Output format section**

Old:
```
## Output format

\`\`\`
## Verify Report
- Command: <exact command> → PASS|FAIL
  <if FAIL: last ~30 lines of output>
- Playwright flow: <flow name> → PASS|FAIL|NOT_APPLICABLE
  <if FAIL: trace/error summary>
Overall: PASS | FAIL
\`\`\`
```
New:
```
## Output format

\`\`\`
## Verify Report
- Command: <exact command> → PASS|FAIL
  <if FAIL: last ~30 lines of output>
  <if no command was documented: state that explicitly here instead of a command/result line>
- Playwright flow: <flow name> → PASS|FAIL|NOT_APPLICABLE
  <if FAIL: trace/error summary>
Overall: PASS | FAIL
\`\`\`

`Overall` has exactly two possible values, always — `PASS` or `FAIL`. There is no third value. `NOT_APPLICABLE` exists only on the Playwright flow line (a per-check status meaning "this check didn't apply here"), never on the `Overall` line. If nothing was documented to run at all, `Overall` is `FAIL` — per Step 1's rule above.
```

- [ ] **Step 3: Verify the edit**

Run: `grep -n "Overall" "agents/verifier.md"` — confirm both the Step 1 clause and Output format clarification are present, and confirm no stray `NOT_APPLICABLE` wording remains attached to `Overall` anywhere in the file.

- [ ] **Step 4: Regression-smoke-test on the exact repo/scenario that surfaced the bug**

Invoke the `verifier` subagent against this repo (`D:\Github\MinhTQ-SDLC`, which has no `CLAUDE.md`/test infra — the exact condition that produced 3 FAIL + 3 NOT_APPLICABLE across 6 calls during `/pr --batch` earlier).
Expected: `Overall: FAIL`, every time, with no `NOT_APPLICABLE` appearing on the Overall line. Run it twice to confirm determinism (not just luck).

- [ ] **Step 5: Commit**

```bash
git add agents/verifier.md && git commit -m "fix: verifier.md Overall is always PASS/FAIL, never a third value when nothing is documented to verify"
```

---

## Self-Review Notes

- **Spec coverage:** the exact bug observed (3 FAIL + 3 NOT_APPLICABLE for the identical situation across 6 `/pr --batch` calls) is closed by Step 1's explicit clause + Step 2's clarification.
- **No policy change:** unverifiable still counts as blocking (FAIL) — matches the user's earlier strict decision, only removes the ambiguity that let the subagent invent a different value.
- **Placeholder scan:** literal, complete replacement text; no TBD.
- **Blast radius:** this subagent is shared by `flow-execute`, `/pr --batch`, and any future flow-* caller — fixing it once here fixes it everywhere it's dispatched, no per-caller changes needed.
