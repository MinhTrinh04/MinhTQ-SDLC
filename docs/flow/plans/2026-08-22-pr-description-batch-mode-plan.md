# PR-Description Batch Mode Implementation Plan

**Goal:** extend `commands/pr-description.md` with `--batch --target <branch>` — process every git worktree sequentially, auto-resolve merge conflicts (verify-gated), then gate the whole batch behind ONE approval before creating/updating PRs.

**Approved design:** batch mode is additive, does not alter single-repo mode. Sequential (never parallel) per-worktree processing. Conflict → dispatch `Agent` to resolve → re-run full `verifier` → FAIL means abort+skip that worktree only (never blocks others). One aggregate `AskUserQuestion` gate for the whole batch (Approve all / Review each individually / Cancel). Never a real `git merge`/`gh pr merge` into `<target>` — only creates/updates PRs, human merges on GitHub (README.md line 12's "duyệt trước khi merge/deploy/production").

**Spec:** [commands/pr-description.md](../../../commands/pr-description.md) (currently only in worktree `D:\Github\MinhTQ-SDLC\.claude\worktrees\agent-a83ea87dabd36223d` — not yet merged to main).

## Global Constraints

- Batch mode never processes worktrees in parallel — strictly sequential.
- Conflict resolution is never trusted without a full `verifier` re-run PASS.
- One worktree's FAILED status never blocks/skips/aborts the others.
- At most one `AskUserQuestion` gate for the whole batch before publishing (except the "Review each individually" fallback, which reuses the existing single-repo gate verbatim, once per worktree).
- Reuse, never reimplement: `<base>`/`<target>` ref-validation, Write-tool temp-file rule, no-gh/no-open-PR fallback, three-section diff/template logic — all already defined in single-repo mode.
- Never a real `git merge <target>` or `gh pr merge` as a final merge anywhere in this mode.

---

### Task 1: Update front matter + Arguments section

**Files:**
- Modify: `D:\Github\MinhTQ-SDLC\.claude\worktrees\agent-a83ea87dabd36223d\commands\pr-description.md`

**Interfaces:** none (doc-only).

- [ ] **Step 1: Append to the frontmatter `description:`**

Old:
```
description: Generate a PR description (What changed / Why / How to test) from real git diff + commit log against a base branch, gate human approval, then optionally publish via gh pr edit or print for manual paste. 1-shot, no loop/retry, fully independent of the multi-stage requirement pipeline.
```
New:
```
description: Generate a PR description (What changed / Why / How to test) from real git diff + commit log against a base branch, gate human approval, then optionally publish via gh pr edit or print for manual paste. 1-shot, no loop/retry, fully independent of the multi-stage requirement pipeline. Also supports --batch --target <branch> to process every git worktree sequentially and publish per-worktree via gh pr create/edit behind a single aggregate approval gate.
```

- [ ] **Step 2: Replace the Arguments line with a two-form description**

Old:
```
Arguments: `$ARGUMENTS` — OPTIONAL, a single base branch name; defaults to `main` if omitted.
```
New:
```
Arguments: `$ARGUMENTS` — either:
- OPTIONAL, a single base branch name; defaults to `main` if omitted (single-repo mode, unchanged — see Orchestration below).
- `--batch --target <branch>` — batch mode: process every git worktree in this repo against `<branch>`, sequentially (see Batch Orchestration below). `<branch>` is REQUIRED in this form — if `--batch` is passed without `--target <branch>`, say so plainly and STOP, do not guess a target.
```

- [ ] **Step 3: Append a clause to the "does not use --jira/--file" paragraph**

Old (ends with):
```
...treat any argument as a candidate base-branch name only, or "no argument" (→ `main`).
```
New (append):
```
...treat any argument as a candidate base-branch name only, or "no argument" (→ `main`). The only other recognized flags are `--batch`/`--target <branch>` (batch mode, see below); any other flag-looking argument is still treated as a literal (probably wrong) base-branch name, same as before.
```

- [ ] **Step 4: Verify no existing text was altered beyond these 3 additive edits**

Run: `git diff commands/pr-description.md` in the worktree after this task, confirm only these 3 spots changed (all pure additions, no deletions).

---

### Task 2: Insert the "Batch Orchestration" section

**Files:**
- Modify: same file, insert between existing `## Orchestration` (ends after single-repo mode's Step 5) and `## Hard rules`.

**Interfaces:**
- Consumes (reused, not duplicated): Orchestration Step 1's ref-validation rule (applied to `<target>`); Steps 2-3's diff/log/template logic; Step 4's `AskUserQuestion` gate (verbatim, for "Review each individually"); Step 5's `gh` availability/open-PR-check/Write-tool-temp-file/`--body-file` logic.
- Consumes: `agents/verifier.md` (dispatched via `Agent` tool, blocking — wait for its result).
- Produces: the new batch-mode orchestration, only active when `--batch --target <branch>` is passed.

- [ ] **Step 1: Insert the new section verbatim**

```markdown
## Batch Orchestration (`--batch --target <branch>`)

Batch mode does not replace single-repo mode above — it is a separate invocation path for when this repo has multiple git worktrees (e.g. features dispatched by `/flow-batch`'s Pha 2) that each need a PR opened/updated against the same `<target>`.

0. Validate `<target>` using the exact same shell-metacharacter check Orchestration Step 1 applies to `<base>` (only `a-z`, `A-Z`, `0-9`, `/`, `-`, `_`, `.`; no spaces/quotes/`$`/backticks/`;`/`|`). If it fails, say so plainly and STOP — same rule, same reason, reused verbatim, not reimplemented.
1. Run `git worktree list` via Bash in the main repo. Parse the output; exclude the row whose path equals the repo root (the main worktree) — every remaining row is one candidate worktree/branch to process. Do not use a branch-name heuristic to find the main worktree — the main worktree's branch is not guaranteed to be `main`/`master` and may even be detached.
2. Process the remaining worktrees **sequentially, one at a time, never in parallel**:
   a. In that worktree's directory, run `git merge <target>`.
   b. **On conflict:** call the `Agent` tool once with a prompt stating: the worktree's path and branch name; that it is already an isolated worktree (do not request or expect `isolation: "worktree"` — none is needed here, unlike `/flow-batch`'s Pha 2, since this worktree already IS the isolation boundary); to read both sides of every conflicted file (via Bash `git diff`/`git status` and Read) and resolve them; then `git add` the resolved files and complete the merge (`git commit` with the default merge message). Unlike `commands/flow-batch.md`'s fire-and-forget dispatch pattern, **wait for this Agent's result before continuing** — do not move on to another worktree or to the verify step until this call returns, because verify is meaningless until the merge is actually resolved.
      Once resolution is reported, dispatch the `verifier` subagent (per `agents/verifier.md`) against this worktree to run the project's documented test/lint/build commands, and wait for its result the same way.
      If `verifier` reports FAIL (its Overall line is FAIL): run `git merge --abort` in this worktree, mark this worktree **FAILED** with the reason (state which check failed and the last ~30 lines of output verifier reported), and move on to the next worktree immediately — one worktree's failure never blocks or aborts processing of the others.
   c. **On no conflict, or on resolve+verify PASS:** generate the PR description for this worktree using the identical Orchestration Steps 2-3 logic above (same `git log`/`git diff` commands, same three-section template, `## What changed` / `## Why` / `## How to test`) — but substitute `<target>` for `<base>` and run the commands from inside this worktree's directory instead of the single-repo mode's working directory. Do not duplicate or rewrite the template text — apply the same steps with only the ref and working directory swapped. Mark this worktree **READY** and keep its generated description.
3. After every worktree has been processed (READY or FAILED), print one aggregate report: the count and list of READY worktrees (branch name + its generated description), then the count and list of FAILED worktrees (branch name + failure reason, per point 2b). Do not publish anything yet.
4. Present exactly one `AskUserQuestion` gate for the whole batch, with exactly these three options:
   - "Approve all — open/update N PRs" (N = count of READY worktrees): proceed to Step 5 below for every READY worktree, no further per-worktree confirmation.
   - "Review each individually": for each READY worktree, in turn, run the existing single-repo mode's own Orchestration Step 4 `AskUserQuestion` gate ("Approve as-is" / "Edit — describe changes" / "Cancel") exactly as written there, using that worktree's generated description; only worktrees individually approved there proceed to Step 5. "Edit" still requires a fresh re-approval before proceeding, same rule as single-repo mode.
   - "Cancel": stop immediately — do not touch any worktree's git state further and do not publish anything. FAILED worktrees remain merge-aborted from Step 2b; READY worktrees' generated descriptions are simply discarded, not saved anywhere.
5. For each worktree approved (via either path in Step 4), apply the existing single-repo mode's Orchestration Step 5 publish logic unchanged in substance, with `<target>` in place of `<base>` and this worktree's branch as the head:
   - Check `gh --version`, then check whether an open PR already exists for this worktree's branch targeting `<target>` (`gh pr view`, run from inside this worktree's directory so it resolves this branch's context, not an assumed one — same caveat single-repo mode Step 5 already states).
   - If `gh` available and no PR exists yet: write the description to a temp file **using the Write tool** (never shell-interpolated — same injection-safety rule as single-repo mode, the description contains attacker-influenceable commit-message/diff text), then run `gh pr create --base <target> --head <worktree-branch> --title <title> --body-file <tmpfile>`, where `<title>` is derived from the first line of the generated `## What changed` section (never fabricated separately from the diff-derived content).
   - If `gh` available and a PR already exists: write the description to a temp file the same way, then run `gh pr edit --body-file <tmpfile>` exactly as single-repo mode Step 5 does.
   - If `gh` is unavailable: same expected fallback as single-repo mode — print this worktree's description plainly for manual use and say why (no `gh`). This is not an error.
   - Report each PR's URL (or fallback notice) back to the user as soon as it completes; delete each temp file right after use.

Never run `git merge <target>` for real as a final merge into `<target>` anywhere in this mode, and never run `gh pr merge` — batch mode only creates/updates PR bodies; a human merges on GitHub (README.md line 12's "duyệt trước khi merge/deploy/production" principle).
```

- [ ] **Step 2: Verify insertion location**

Run: `grep -n "^## " "commands/pr-description.md"` — confirm section order is `# /pr-description` → `## Orchestration` → `## Batch Orchestration` → `## Hard rules`, nothing reordered or deleted.

---

### Task 3: Append batch-mode Hard rules

**Files:**
- Modify: same file, append to the end of the existing `## Hard rules` list.

**Interfaces:** none (doc-only).

- [ ] **Step 1: Append these bullets to the end of the existing list**

```markdown
- (Batch mode) Never process worktrees in parallel — one at a time, sequentially, so one worktree's conflict resolution and verify never race another's.
- (Batch mode) Never skip dispatching the full `verifier` subagent after an Agent-resolved conflict — a resolved conflict is not safe to generate a PR from until verify PASSes.
- (Batch mode) Never let one worktree's FAILED status block, skip, or abort processing of the remaining worktrees.
- (Batch mode) Never present more than one `AskUserQuestion` gate for the batch as a whole before publishing — "Review each individually" is the only path that reintroduces per-worktree gates, and those reuse the existing single-repo gate verbatim rather than inventing a new one.
- (Batch mode) Never run `git merge <target>` or `gh pr merge` as a real final merge in any worktree — this mode only creates/updates PR bodies, never merges.
- (Batch mode) Reuse, never reimplement: the `<target>` ref-format validation (identical rule to `<base>`), the Write-tool temp-file rule, the no-gh/no-open-PR fallback, and the three-section diff/template generation logic — all defined once above in single-repo mode.
```

- [ ] **Step 2: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder|flow-brainstorm|flow-plan|flow-execute" "commands/pr-description.md"`
Expected: no matches (batch mode stays independent of the requirement pipeline, same as single-repo mode).

- [ ] **Step 3: Smoke-test — all-clean batch (no conflicts)**

```bash
mkdir -p /tmp/flow-scratch/batch-pr-clean && cd /tmp/flow-scratch/batch-pr-clean
git init -q
echo "base" > file.txt && git add -A && git commit -q -m "init"
git branch feat-a && git branch feat-b
git worktree add ../batch-pr-clean-a feat-a
git worktree add ../batch-pr-clean-b feat-b
cd ../batch-pr-clean-a && echo "change-a" >> file.txt && git commit -aqm "feat: change a"
cd ../batch-pr-clean-b && echo "change-b" >> other.txt 2>/dev/null; git add -A && git commit -qm "feat: change b"
```

Invoke `/pr-description --batch --target main` from `/tmp/flow-scratch/batch-pr-clean`.
Expected: both worktrees merge `main` cleanly (no conflict, no `Agent` dispatch needed), both marked READY, aggregate report shows 2 READY / 0 FAILED, one `AskUserQuestion` gate presented for the whole batch.

- [ ] **Step 4: Smoke-test — conflict, resolved, verify PASS**

Extend the Step 3 fixture: have `feat-a` and `main` both modify the same line of `file.txt` differently, so merging `main` into `feat-a` conflicts. Add a `CLAUDE.md` with a trivial always-passing test command to that worktree.
Invoke `/pr-description --batch --target main`.
Expected: conflict detected on `feat-a`, `Agent` dispatched and awaited (not fire-and-forget), `verifier` dispatched and awaited, verify PASS, `feat-a` marked READY with the merge committed; `feat-b` (no conflict) also READY.

- [ ] **Step 5: Smoke-test — conflict, resolved, verify FAIL (one worktree fails, others unaffected)**

Same as Step 4 but rig `feat-a`'s `CLAUDE.md` test command to always fail.
Expected: conflict resolved by `Agent`, `verifier` reports FAIL, `git merge --abort` run in `feat-a`'s worktree, `feat-a` marked FAILED with the reason, `feat-b` still processed and marked READY — aggregate report shows 1 READY / 1 FAILED, gate only covers the READY one.

- [ ] **Step 6: Smoke-test — "Review each individually" and "Cancel" paths**

Repeat Step 3's clean 2-worktree setup. Invoke `/pr-description --batch --target main`, choose "Review each individually" at the aggregate gate.
Expected: the existing single-repo Approve/Edit/Cancel gate appears once per READY worktree, in turn.
Repeat again, choose "Cancel" at the aggregate gate.
Expected: command stops immediately, no `gh` command attempted for either worktree.

- [ ] **Step 7: Commit**

```bash
cd "D:/Github/MinhTQ-SDLC/.claude/worktrees/agent-a83ea87dabd36223d" && git add commands/pr-description.md && git commit -m "feat: add /pr-description --batch mode (sequential multi-worktree PR creation, verify-gated conflict resolution)"
```

---

### Task 4: Sync `docs/flow/plans/2026-08-21-pr-description-plan.md` in the main repo

**Files:**
- Modify: `docs/flow/plans/2026-08-21-pr-description-plan.md`

**Interfaces:** none (doc-only) — this file currently only documents single-repo mode; this repo's established convention (per recent commits) is keeping `docs/flow/plans/*.md` in sync with what's actually shipped in the command file.

- [ ] **Step 1: Append a "Task 2: Batch mode" section**

Mirror this plan's Task 1-3 content (the exact new/modified text blocks above) into that file as its own `### Task 2` section, so the plan doc stays the authoritative source matching the command file, consistent with how `2026-08-21-flow-batch-plan.md` was marked superseded/updated in place for its own redesign.

- [ ] **Step 2: Commit**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add docs/flow/plans/2026-08-21-pr-description-plan.md && git commit -m "docs: sync pr-description plan with --batch mode addition"
```

---

## Self-Review Notes

- **Spec coverage:** approved design's 5 orchestration points map to Task 2's Steps 0-5 exactly. "One approval gate for the whole batch" → Step 4. "Never real merge" → closing paragraph + Task 3 Hard rules. "Reuse not reimplement" → explicit callouts throughout Task 2 + a dedicated Hard rule.
- **Placeholder scan:** all inserted text is literal and complete; no TBD.
- **Type/name consistency:** `verifier` matches `agents/verifier.md`'s identity exactly; `Agent` tool usage matches the tool's actual documented parameters (no `isolation` needed here, since the worktree already exists — a deliberate deviation from `/flow-batch`'s pattern, called out explicitly per the planner survey's risk #3).
- **Risk carried over from survey:** this edits the worktree copy of `commands/pr-description.md` directly (not yet merged to main) — consistent with how the rest of this session's post-review patches (findings fixes) were applied directly to each feature's own worktree before merge.
