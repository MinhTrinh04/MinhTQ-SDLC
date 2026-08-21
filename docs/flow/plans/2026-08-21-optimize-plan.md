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
8. Invoke `flow-execute` with that plan file's path to implement the chosen approach only.
9. Re-run the exact same benchmark command from Step 2/3. Compare to baseline.
   - If NOT better: revert `flow-execute`'s commit(s) — use `git revert <sha>..<sha>` if the branch has already been pushed/shared, or `git reset --hard <pre-execute-sha>` if it's still local/unshared. Report the optimization was reverted, with the before/after numbers shown plainly.
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
- **Type/name consistency:** `flow-brainstorm`, `flow-execute` match flow-core plan's Tasks 4 and 6 exactly. Plan-synthesis pattern (Step 7) matches `/fix-feature`'s precedent exactly (docs/flow/plans/2026-08-21-fix-feature-plan.md Task 1 Step 1, Orchestration step 3).
