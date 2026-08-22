# Optimize Command Implementation Plan

**Goal:** `commands/optimize.md` — benchmark a target, brainstorm 2-3 approaches (never auto-picking one), let the human choose, execute the chosen approach, re-benchmark, keep or revert.

**Approved design:** same input adapter as `/flow` (keeps `--jira` for consistency with siblings); reads target repo's `CLAUDE.md` `## Benchmark` section or asks the human directly; overrides `flow-brainstorm`'s "bounded = 1 approach" default to always force 2-3; human picks via `AskUserQuestion`; synthesizes a minimal plan inline (no `flow-plan` stage, mirroring `/fix-feature`'s precedent) and hands it to `flow-execute`; re-benchmarks and reverts if not better.

---

### Task 1: Create `commands/optimize.md`

**Files:**
- Create: `commands/optimize.md`

**Interfaces:**
- Consumes: `flow-brainstorm` skill (exact name `flow-brainstorm`) with an explicit override instruction forcing 2-3 approaches; `flow-execute` skill (exact name `flow-execute`), fed a self-synthesized plan file (same pattern as `/fix-feature`).
- Produces: the `/optimize` slash command.

- [ ] **Step 1: Write the command file**

```markdown
---
description: Benchmark a target, brainstorm 2-3 optimization approaches (never auto-picking one), let the human choose, execute the chosen approach, then re-benchmark and keep or revert based on the result.
---

# /optimize

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + acceptance criteria). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the requirement.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available on the machine, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the description of what to optimize.

No other input form is supported — do not guess the source from the argument's shape.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized requirement block: `{source, content, origin_link}`.
2. Read the target repo's `CLAUDE.md` for a `## Benchmark` section documenting the exact measurement command.
   - If found: use that command verbatim.
   - If absent: STOP and ask the user via `AskUserQuestion` for the exact benchmark/measure command. Never guess or infer one from `package.json` scripts or anything else.
3. Run the benchmark command, record the baseline output/number verbatim.
4. Invoke the `flow-brainstorm` skill with the requirement block, with this explicit override in the invocation instructions: "Always produce 2-3 approaches with trade-offs, regardless of classification (spike/bounded/architectural) — do not default to a single approach for a 'bounded' change; performance/structure trade-offs are always a human call, never auto-select one." This overrides `flow-brainstorm`'s own Step 5 default of "Bounded: one concrete approach."
5. Wait for `flow-brainstorm`'s own approval gate (its own `AskUserQuestion`, Approve/Request changes/Reject) confirming the *set of approaches* is sound — this is not yet the "pick one" gate.
6. Once approved, present the 2-3 approaches to the human via a **separate** `AskUserQuestion` call, one option per approach, for them to pick exactly one. Do not proceed until one is explicitly selected.
7. Synthesize a minimal plan file from the chosen approach only (same pattern as `/fix-feature`: no `flow-plan` stage here), write it to `docs/flow/plans/YYYY-MM-DD-optimize-<slug>-plan.md`, stating plainly it was auto-synthesized from the chosen approach, not a `flow-plan` output.
8. **Record the current commit before touching anything**: run `git rev-parse HEAD` in the target repo and keep that SHA as `<pre-execute-sha>` — Step 9's revert depends on this value existing; do not skip it even though nothing else uses it yet.
9. Invoke `flow-execute` with that plan file's path to implement the chosen approach only.
10. Re-run the exact same benchmark command from Step 2/3. Compare to baseline.
    - If NOT better: revert `flow-execute`'s commit(s) using the `<pre-execute-sha>` recorded in Step 8 — `git revert <pre-execute-sha>..HEAD` if the branch has already been pushed/shared, or `git reset --hard <pre-execute-sha>` if it's still local/unshared. Report the optimization was reverted, with the before/after numbers shown plainly.
    - If better: keep it. Report before/after numbers.

## Hard rules

- Never guess the benchmark command — if `## Benchmark` is absent from the target repo's `CLAUDE.md`, always ask via `AskUserQuestion`.
- Never let `flow-brainstorm` collapse to one approach here, even for a "bounded" classification — this command always needs 2-3 with trade-offs.
- Never auto-select an approach — the human must pick via `AskUserQuestion`, every time.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never keep a change that benchmarks worse than baseline — always revert and say so plainly.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "d:/Github/MinhTQ-SDLC/commands/optimize.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder" "d:/Github/MinhTQ-SDLC/commands/optimize.md"`
Expected: no matches. Confirm `flow-brainstorm`/`flow-execute` names match exactly the `name:` fields in their SKILL.md files.

- [ ] **Step 4: Smoke-test the forced-2-3-approaches override on a scratch repo**

```bash
mkdir -p /tmp/flow-scratch/optimize-repo && cd /tmp/flow-scratch/optimize-repo
git init -q
mkdir -p src
cat > src/sum.js <<'EOF'
function sumSquares(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length; j++) {
      if (i === j) total += arr[i] * arr[i];
    }
  }
  return total;
}
module.exports = { sumSquares };
EOF
cat > CLAUDE.md <<'EOF'
# Scratch optimize repo

## Benchmark

Run: node -e "const {sumSquares}=require('./src/sum'); const arr=Array.from({length:20000},(_,i)=>i); const t0=Date.now(); sumSquares(arr); console.log('ms:', Date.now()-t0);"
EOF
git add -A && git commit -q -m "init (O(n^2) sumSquares, should be O(n))"
```

Invoke `/optimize` with bare text: `"Optimize sumSquares() in src/sum.js — it's O(n^2) with a nested loop but only needs the diagonal"` against `/tmp/flow-scratch/optimize-repo`.
Expected: benchmark runs first (baseline ms recorded), `flow-brainstorm` returns 2-3 approaches (not 1) even though this is a bounded change, a separate `AskUserQuestion` prompt appears to pick one approach, `flow-execute` implements only the chosen one, benchmark reruns and the report shows before/after ms.

- [ ] **Step 5: Smoke-test the missing-benchmark path**

```bash
mkdir -p /tmp/flow-scratch/optimize-nobench && cd /tmp/flow-scratch/optimize-nobench
git init -q
echo "# Scratch, no benchmark section" > CLAUDE.md
git add -A && git commit -q -m "init"
```

Invoke `/optimize` with bare text: `"Optimize something"` against `/tmp/flow-scratch/optimize-nobench`.
Expected: `/optimize` stops at Step 2 and asks via `AskUserQuestion` for the exact benchmark command — never infers one.

- [ ] **Step 6: Commit**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add commands/optimize.md && git commit -m "feat: add /optimize command (benchmark, 2-3 approaches, human pick, revert-if-worse)"
```

---

## Self-Review Notes

- **Spec coverage:** README Mục 3 `/optimize` (baseline, 2-3 approaches, human pick, measure+revert) → Orchestration steps 2-9. README Mục 0.5 ("không tự động hoá việc không có tiêu chí xong rõ ràng") → Step 4's explicit override + Hard rules.
- **Placeholder scan:** literal command content, no TBD.
- **Type/name consistency:** `flow-brainstorm`, `flow-execute` match flow-core plan's Tasks 4 and 6 exactly. Plan-synthesis pattern (Step 7) matches `/fix-feature`'s precedent exactly (docs/flow/plans/fix-feature-plan.md Task 1 Step 1, Orchestration step 3).
- **Task 2 coverage:** qualitative branch added to Step 2 for problems with no numeric benchmark (architecture/code-quality/maintainability) — baseline capture and re-measure are skipped, `flow-brainstorm`'s override is reworded to ask for qualitative trade-offs, `flow-execute`'s own mandatory `reviewer` findings (never a second, duplicate dispatch) are surfaced before a human keep/revert gate, and the Step 8 pre-execute SHA is reused for revert since there's no benchmark number to fall back on.

---

### Task 2: Extend `commands/optimize.md`'s Step 2 with a qualitative branch (added 2026-08-22)

**Rationale:** `/optimize` currently hard-requires a `## Benchmark` command and STOPs without one — fine for performance work, but too narrow for "should I restructure this messy module" type problems that aren't measurable by a single number. This task adds a qualitative branch: skip the benchmark entirely, frame trade-offs in complexity/maintainability/risk terms instead, and let the human decide keep-vs-revert after seeing `flow-execute`'s own mandatory adversarial review — never a duplicate `reviewer` call, since `flow-execute` (`skills/flow-execute/SKILL.md` Steps 5-6) already dispatches it after `verifier` PASS.

**Files:**
- Modify: `commands/optimize.md`

**Interfaces:**
- Consumes: `flow-execute`'s own final report (which already includes `reviewer`'s findings, per `skills/flow-execute/SKILL.md`) — reused, not re-dispatched. Consumes the same `<pre-execute-sha>` already captured in Step 8 for the qualitative path's revert mechanism.
- Produces: two new `AskUserQuestion` gates on the qualitative path — "Vấn đề này có đo được bằng số không?" (Step 2 branch) and "Giữ thay đổi này hay revert?" (Step 10 qualitative branch).

- [ ] **Step 1: Rewrite the `## Orchestration` and `## Hard rules` sections**

Old (current Steps 2, 3, 4, 10, and Hard rules):
```markdown
2. Read the target repo's `CLAUDE.md` for a `## Benchmark` section documenting the exact measurement command.
   - If found: use that command verbatim.
   - If absent: STOP and ask the user via `AskUserQuestion` for the exact benchmark/measure command. Never guess or infer one from `package.json` scripts or anything else.
3. Run the benchmark command, record the baseline output/number verbatim.
4. Invoke the `flow-brainstorm` skill with the requirement block, with this explicit override in the invocation instructions: "Always produce 2-3 approaches with trade-offs, regardless of classification (spike/bounded/architectural) — do not default to a single approach for a 'bounded' change; performance/structure trade-offs are always a human call, never auto-select one." This overrides `flow-brainstorm`'s own Step 5 default of "Bounded: one concrete approach."
...
10. Re-run the exact same benchmark command from Step 2/3. Compare to baseline.
    - If NOT better: revert `flow-execute`'s commit(s) using the `<pre-execute-sha>` recorded in Step 8 — `git revert <pre-execute-sha>..HEAD` if the branch has already been pushed/shared, or `git reset --hard <pre-execute-sha>` if it's still local/unshared. Report the optimization was reverted, with the before/after numbers shown plainly.
    - If better: keep it. Report before/after numbers.

## Hard rules

- Never guess the benchmark command — if `## Benchmark` is absent from the target repo's `CLAUDE.md`, always ask via `AskUserQuestion`.
- Never let `flow-brainstorm` collapse to one approach here, even for a "bounded" classification — this command always needs 2-3 with trade-offs.
- Never auto-select an approach — the human must pick via `AskUserQuestion`, every time.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never keep a change that benchmarks worse than baseline — always revert and say so plainly.
```

New:
```markdown
2. Read the target repo's `CLAUDE.md` for a `## Benchmark` section documenting the exact measurement command.
   - If found: use that command verbatim, then follow the **quantitative path** — proceed exactly as Steps 3-10 below.
   - If absent: ask the user via `AskUserQuestion` — "Vấn đề này có đo được bằng số không?" — with options:
     - "Có — tôi sẽ nhập lệnh đo": capture the exact benchmark/measure command via the tool's built-in free-text "Other" option. Never guess or infer one from `package.json` scripts or anything else. Then follow the **quantitative path** from Step 3 onward, using the captured command wherever "the benchmark command" is referenced below.
     - "Không — đây là vấn đề định tính (kiến trúc/code quality/maintainability)": follow the **qualitative path** — skip Step 3 entirely and continue at Step 4, using the qualitative wording given there.
3. *(Quantitative path only — skipped entirely on the qualitative path.)* Run the benchmark command, record the baseline output/number verbatim.
4. Invoke the `flow-brainstorm` skill with the requirement block, with this explicit override in the invocation instructions:
   - **Quantitative path:** "Always produce 2-3 approaches with trade-offs, regardless of classification (spike/bounded/architectural) — do not default to a single approach for a 'bounded' change; performance/structure trade-offs are always a human call, never auto-select one."
   - **Qualitative path:** "Always produce 2-3 approaches with trade-offs, regardless of classification (spike/bounded/architectural) — do not default to a single approach for a 'bounded' change; frame every trade-off qualitatively — complexity, maintainability, extensibility/future flexibility, migration risk/cost — never in benchmark numbers; this is always a human call, never auto-select one."

   Either wording overrides `flow-brainstorm`'s own Step 5 default of "Bounded: one concrete approach."
...
8. **Record the current commit before touching anything**: run `git rev-parse HEAD` in the target repo and keep that SHA as `<pre-execute-sha>` — Step 10's revert depends on this value on both paths; do not skip it even on the qualitative path, where there is no benchmark to fall back on if the human decides to revert.
9. Invoke `flow-execute` with that plan file's path to implement the chosen approach only. `flow-execute` internally dispatches `verifier` (retry ≤3) and, on PASS, the mandatory `reviewer` subagent — both unchanged, on either path.
10. Branch on which path is active:
    - **Quantitative path:** re-run the exact same benchmark command from Step 2/3. Compare to baseline.
      - If NOT better: revert `flow-execute`'s commit(s) using the `<pre-execute-sha>` recorded in Step 8 — `git revert <pre-execute-sha>..HEAD` if the branch has already been pushed/shared, or `git reset --hard <pre-execute-sha>` if it's still local/unshared. Report the optimization was reverted, with the before/after numbers shown plainly.
      - If better: keep it. Report before/after numbers.
    - **Qualitative path:** there is no re-measure step. `flow-execute`'s final report already includes `reviewer`'s findings (per `skills/flow-execute/SKILL.md` Steps 5-6) — reuse those, never dispatch `reviewer` a second time against the same diff. Present those findings to the human via a **new, separate** `AskUserQuestion` — "Giữ thay đổi này hay revert?" — with options "Giữ — approve" / "Revert".
      - If "Revert": use the same `<pre-execute-sha>` revert mechanism as the quantitative branch — `git revert <pre-execute-sha>..HEAD` if pushed/shared, `git reset --hard <pre-execute-sha>` if local/unshared.
      - If "Giữ — approve": report `reviewer`'s findings (already produced by `flow-execute`) verbatim and state plainly that the change is kept.

## Hard rules

- Never guess the benchmark command on the quantitative path — if `## Benchmark` is absent from the target repo's `CLAUDE.md` and the human confirms the problem is measurable, always ask via `AskUserQuestion` for the exact command; never infer one from `package.json` scripts or anything else.
- Never let `flow-brainstorm` collapse to one approach here, even for a "bounded" classification — this command always needs 2-3 with trade-offs, on either path.
- Never auto-select an approach — the human must pick via `AskUserQuestion`, every time, on either path.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never keep a change that benchmarks worse than baseline on the quantitative path — always revert and say so plainly.
- On the qualitative path, never dispatch `reviewer` a second time — reuse the findings `flow-execute` already produced (it mandates `reviewer` after `verifier` PASS); with no number to fall back on, that review is the only check before the keep/revert decision.
- On the qualitative path, never auto-keep or auto-revert — always present `reviewer`'s findings and let the human choose via the "Giữ — approve" / "Revert" `AskUserQuestion`, since there's no number to decide by.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "commands/optimize.md"`
Expected: file exists, size increased from the Task 1 baseline.

- [ ] **Step 3: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder" "commands/optimize.md"`
Expected: no matches. Confirm `flow-execute` matches `skills/flow-execute/SKILL.md`'s `name:` field exactly (no direct `reviewer` reference needed here since it's consumed indirectly via `flow-execute`'s report, per the fixed design).

- [ ] **Step 4: Smoke-test the qualitative branch on a scratch repo**

```bash
mkdir -p /tmp/flow-scratch/optimize-qual && cd /tmp/flow-scratch/optimize-qual
git init -q
echo "# Scratch, no benchmark section" > CLAUDE.md
git add -A && git commit -q -m "init"
```

Invoke `/optimize` with bare text: `"The UserService class has 400 lines mixing auth, billing, and email concerns — it's hard to change safely"` against `/tmp/flow-scratch/optimize-qual`.
Expected: Step 2 asks "Vấn đề này có đo được bằng số không?"; choosing "Không — đây là vấn đề định tính (kiến trúc/code quality/maintainability)" skips baseline capture entirely (no benchmark command run), `flow-brainstorm` returns 2-3 approaches framed in complexity/maintainability/extensibility/migration-risk terms (no numbers), the approach-pick `AskUserQuestion` still appears, `flow-execute` runs (dispatching its own mandatory `reviewer` internally, not a second time), and its findings are shown before a final "Giữ thay đổi này hay revert?" prompt.

- [ ] **Step 5: Regression-check the quantitative branch and its "Có" sub-branch still work**

Reuse Task 1's Step 4 scratch repo (has `## Benchmark` in `CLAUDE.md`) and confirm the found-benchmark path is unchanged (Steps 3-10 quantitative, before/after numbers, revert-if-worse).

Then, against a fresh scratch repo with no `## Benchmark` section, invoke `/optimize` and choose "Có — tôi sẽ nhập lệnh đo" at the Step 2 prompt, supplying a command via the `AskUserQuestion` free-text option.
Expected: behaves identically to the "found in CLAUDE.md" case from Step 3 onward, using the human-supplied command as the benchmark.

- [ ] **Step 6: Commit**

```bash
git add commands/optimize.md docs/flow/plans/optimize-plan.md && git commit -m "feat: add qualitative (non-benchmark) branch to /optimize, reusing flow-execute's mandatory reviewer instead of a duplicate dispatch"
```
