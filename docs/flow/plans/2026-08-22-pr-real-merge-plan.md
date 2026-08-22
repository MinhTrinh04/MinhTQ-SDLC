# PR Real-Merge Implementation Plan

**Goal:** extend `commands/pr.md` (both modes) with a real `git merge`/`gh pr merge` capability, gated behind a dedicated `AskUserQuestion` separate from the existing description-approval gate.

**Approved design:** merging is opt-in per invocation, never implied by the description-approval gate. Single-repo mode: 1 merge gate + 1 separate push gate. Batch mode: 1 aggregate merge gate (or per-branch via "Review each individually") + 1 aggregate push gate, sequential processing from the main worktree, reusing Batch Orchestration Step 2c's conflict+Agent+verifier pattern for resync.

**Spec:** `commands/pr.md` (main repo, direct edit — not a worktree).

## Global Constraints

- Never merge without a dedicated `AskUserQuestion` gate — Step 4's description approval never implies merge approval.
- Never push without a second, separate `AskUserQuestion` — merge approval never implies push approval.
- Never `--squash`/`--rebase` by default — always plain `--merge`.
- Never merge over a dirty worktree.
- Batch mode's merge loop runs only from the main worktree, sequentially, reusing (not duplicating) Step 2c's conflict-resolution mechanism.

---

### Task 1: Insert single-repo mode Step 6

**Files:**
- Modify: `commands/pr.md` — insert after existing Step 5, before `## Batch Orchestration`.

**Interfaces:**
- Consumed by: Batch mode's "Review each individually" merge option (Task 3), which reuses this step verbatim per branch.

- [ ] **Step 1: Insert the new Step 6 text**

```markdown
6. Only after Step 5 completes (published or fallback-printed): gate a real merge via a **separate** `AskUserQuestion`, distinct from Step 4's description-approval gate — "Merge `<current-branch>` vào `<base>` bây giờ?" with exactly these two options: "Approve — merge now", "Skip — leave for later". Never merge on the strength of Step 4's approval alone, and never merge without this explicit gate.
   - "Skip — leave for later": stop here — report that `<current-branch>` (and its PR, if one exists) remains for a human to merge later. Do nothing further.
   - "Approve — merge now": first run `git status --porcelain` in the current worktree. If it prints anything, the worktree is dirty — STOP and report this plainly, do not merge.
     - If `gh` is available (`gh --version`) and an open PR exists for this branch (reuse Step 5's `gh pr view` check): run `gh pr merge --merge` (a plain merge commit — never `--squash`/`--rebase` by default).
     - Otherwise (no `gh`, or no open PR): merge locally — `git checkout <base>`, `git merge <current-branch> --no-ff`, then `git checkout <current-branch>` to return to the original branch afterward.
     - If a remote `origin` is configured (`git remote get-url origin` succeeds), ask one more, **separate** `AskUserQuestion` — "Push `<base>` to origin now?" with options "Approve — push" / "Skip — leave unpushed" — before running `git push origin <base>`. Never push without this explicit second ask; approving the merge never implies approving the push.
     - Report the merge result plainly: fast-forward, or the merge commit SHA.
```

- [ ] **Step 2: Verify insertion location and numbering**

Run: `grep -n "^[0-9]\." "commands/pr.md" | head -20` — confirm single-repo mode's Orchestration is now Steps 1-6, sequential, nothing renumbered incorrectly.

---

### Task 2: Amend the stale batch-mode "never merges" sentence

**Files:**
- Modify: `commands/pr.md` — the closing paragraph of `## Batch Orchestration` (currently: "Never run `git merge <target>` for real as a final merge into `<target>` anywhere in this mode, and never run `gh pr merge`...").

- [ ] **Step 1: Replace the sentence**

Old:
```
Never run `git merge <target>` for real as a final merge into `<target>` anywhere in this mode, and never run `gh pr merge` — batch mode only creates/updates PR bodies; a human merges on GitHub (README.md line 12's "duyệt trước khi merge/deploy/production" principle).
```
New:
```
Steps 1-5 above never run `git merge <target>` for real as a final merge into `<target>`, and never run `gh pr merge` — those steps only create/update PR bodies. Real merging into `<target>`, if desired, happens only in Step 6 below, behind its own explicit aggregate approval gate — never as a side effect of publishing.
```

---

### Task 3: Insert batch mode Step 6 + Step 7

**Files:**
- Modify: `commands/pr.md` — insert after Task 2's amended paragraph, before `## Hard rules`.

**Interfaces:**
- Consumes: single-repo Step 6 (Task 1, reused verbatim for "Review each individually"); Batch Orchestration Step 2c's exact Agent+verifier dispatch pattern (reused by reference, not copied).
- Produces: final merge-result report.

- [ ] **Step 1: Insert the new Step 6 + Step 7 text**

```markdown
6. Only after Step 5 completes for every approved worktree (published or fallback-printed): from the **main worktree** (repo root) only — never from inside any feature worktree's directory — present **one aggregate** `AskUserQuestion` gate for the whole batch: "Merge thật N branch (đã publish) vào `<target>` bây giờ?" (N = count of worktrees that reached READY-and-published in Step 5), with exactly these three options:
   - "Approve — merge all now": proceed to the sequential merge loop below.
   - "Skip — leave PRs open": stop here — report which branches still have open PRs, unchanged, for a human to merge later. Do nothing further.
   - "Review each individually": for each READY-and-published worktree, in turn, run single-repo mode's own Step 6 gate above **verbatim** (its "Approve — merge now" / "Skip — leave for later" options and all its checks), once per branch, substituting `<target>` for `<base>`. Skip only its local-fallback push sub-ask here — batch mode's push question is asked once for the whole batch in point 7 below, not per branch.

   On "Approve — merge all now", process the READY-and-published worktrees **sequentially, one at a time, never in parallel** (same discipline as Step 2), from the main worktree with `<target>` checked out:
   a. For each branch, attempt `git merge <branch> --no-ff` into `<target>`.
   b. **Clean fast-forward/auto-merge (expected case):** each worktree already merged `<target>` into itself during Step 2's conflict-check pass, so this should apply cleanly — commit, move to the next branch.
   c. **Not a clean fast-forward** (a prior branch earlier in this same loop already advanced `<target>` past what this branch saw during its own Step 2 merge): in that worktree's own directory, merge `<target>`'s new HEAD back into this worktree's branch first, then dispatch the `Agent` tool to resolve any conflict and the `verifier` subagent to re-verify — reusing the **exact** blocking dispatch-and-wait pattern from Batch Orchestration Step 2c (call once, wait for the result before continuing; Agent-cannot-resolve → `git merge --abort`; verifier FAIL → `git reset --hard ORIG_HEAD`) — then retry `git merge <branch> --no-ff` into `<target>`.
   d. If a branch's merge into `<target>` still fails after one resync attempt: mark it **FAILED** for this step (its PR is left open, untouched), report why, and continue with the remaining branches — one branch's failure never blocks or aborts the others.
   e. After all branches are processed, report the final result: which branches merged into `<target>` (each with its merge commit SHA), and which remain as open PRs (FAILED-to-merge or Skipped), plainly.
7. If any branch merged successfully in point 6 and a remote `origin` is configured (`git remote get-url origin` succeeds, checked once from the main worktree), ask **one more, separate** `AskUserQuestion` for the whole batch — "Push `<target>` to origin now?" with options "Approve — push" / "Skip — leave unpushed" — before running `git push origin <target>`. Never push automatically; this is a single batch-wide ask, not one per branch.
```

- [ ] **Step 2: Verify insertion location and numbering**

Run: `grep -n "^[0-9]\." "commands/pr.md"` — confirm Batch Orchestration is now Steps 0-7, sequential, nothing renumbered incorrectly, and single-repo mode's own Steps 1-6 (Task 1) are unaffected by this insertion (they're a separate numbered list under a different heading).

---

### Task 4: Update `## Hard rules`

**Files:**
- Modify: `commands/pr.md` — `## Hard rules` section.

- [ ] **Step 1: Replace the single-repo "never auto-merge" rule**

Old:
```
- Never auto-merge, never push, never create commits — read-only on git history, at most updates a PR's body text.
```
New:
```
- Never merge (`git merge`/`gh pr merge`) or push, except behind Step 6's dedicated `AskUserQuestion` gate(s) — outside an explicit Step 6 approval, this command remains read-only on git history and at most updates a PR's body text.
```

- [ ] **Step 2: Replace the batch-mode "never merges" rule**

Old:
```
- (Batch mode) Never run `git merge <target>` or `gh pr merge` as a real final merge in any worktree — this mode only creates/updates PR bodies, never merges.
```
New:
```
- (Batch mode) Never run `git merge <target>` or `gh pr merge` as a real final merge except inside batch Step 6, and only after its aggregate `AskUserQuestion` approval — Steps 1-5 only create/update PR bodies, never merge.
```

- [ ] **Step 3: Append new single-repo-scoped Hard rules**

Append (grouped with the other approval-gate rules, before the `(Batch mode)`-prefixed block):
```
- Never merge without going through Step 6's dedicated `AskUserQuestion` gate — separate from Step 4's description-approval gate; Step 4's approval never implies merge approval.
- Never merge over a dirty worktree — check `git status --porcelain` immediately before merging in single-repo mode's Step 6; if dirty, STOP and report, do not merge.
- Never push without a second, separate, explicit `AskUserQuestion` approval distinct from the merge approval — approving a merge never implies approving a push.
- Never use `gh pr merge --squash` or `--rebase` by default — always `--merge` (a plain merge commit) unless a human explicitly requests otherwise.
```

- [ ] **Step 4: Append new batch-mode Hard rules**

Append at the end of `## Hard rules`:
```
- (Batch mode) Never run Step 6's aggregate merge gate or the merge loop itself from inside a feature worktree — always from the main worktree (repo root).
- (Batch mode) Never present more than one aggregate `AskUserQuestion` merge-gate for the whole batch, except when "Review each individually" is chosen, which reuses single-repo mode's own per-branch Step 6 gate verbatim, once per branch — same pattern already established for the publish-approval gate in Step 4.
- (Batch mode) Never push automatically after a batch merge — ask via one separate, batch-wide `AskUserQuestion` (Step 7) before `git push origin <target>`.
- (Batch mode) Reuse, never reimplement, the conflict+Agent+verifier dispatch pattern from Batch Orchestration Step 2c when resyncing a branch whose merge into `<target>` isn't a clean fast-forward.
```

- [ ] **Step 5: Placeholder + consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder|flow-brainstorm|flow-plan|flow-execute" "commands/pr.md"` — expect no matches (per this repo's own `CLAUDE.md` test convention).
Run: `grep -n "never auto-merge\|never merge\|never push" "commands/pr.md"` — read every match and confirm none contradicts the new Step 6/7 capability (no stale absolute "never merge" phrasing left anywhere).

- [ ] **Step 6: Run this repo's own documented test command**

Run the exact command from `CLAUDE.md`'s `## Test` section against the repo root.
Expected: `PASS`.

- [ ] **Step 7: Smoke-test the single-repo merge gate on a scratch repo**

```bash
mkdir -p /tmp/flow-scratch/pr-merge-single && cd /tmp/flow-scratch/pr-merge-single
git init -q
echo base > f.txt && git add -A && git commit -q -m "init"
git checkout -qb feat-x
echo change >> f.txt && git commit -aqm "feat: change"
```

Invoke `/pr` from the `feat-x` branch (base defaults to `main`... adjust to this scratch repo's default branch name if not `main`).
Expected: description generated → Step 4 gate → (no `gh`, so fallback print) → Step 6's separate merge gate appears — choosing "Skip" leaves `main` untouched (`git log main..feat-x --oneline` still shows the commit); choosing "Approve" merges (`git log main --oneline` now includes the feat-x commit), and since no `origin` remote exists, no push gate appears.

- [ ] **Step 8: Smoke-test the batch merge gate + resync path on a scratch repo**

Reuse a 3-worktree scratch fixture similar to earlier `/pr --batch` smoke tests, where worktree A and worktree B both get merged into `target` sequentially and B's earlier `target`-merge-in is now stale relative to A's just-landed merge (force this by having A and B touch different files, but merge A into target first so target's HEAD moves past what B saw).
Expected: A merges cleanly (fast-forward). B's `git merge <branch-b> --no-ff` into target is NOT a clean fast-forward (target advanced) — triggers the resync path: target's new HEAD merges into B's worktree, `Agent`+`verifier` dispatched and awaited, then B merges into target successfully. Final report lists both A and B merged with their SHAs.

- [ ] **Step 9: Commit**

```bash
git add commands/pr.md && git commit -m "feat: add real-merge capability to /pr (single-repo + batch), gated behind dedicated AskUserQuestion approvals"
```

---

## Self-Review Notes

- **Spec coverage:** every clause of the approved design (single-repo Step 6, batch Step 6+7, resync reuse, dirty-check, push-gate separation, no-squash-default) maps to a task above.
- **Placeholder scan:** all inserted text is literal and complete; no TBD.
- **Consistency:** Task 5 Step 5's grep explicitly re-scans for stale "never merge" absolutes left over from before this change — a real risk the planner survey flagged (risk #1), addressed by Tasks 2 and 4 together.
- **No duplication:** batch Step 6c explicitly reuses Step 2c's dispatch pattern "by reference" (naming it, not re-writing a second copy of the Agent/verifier prompt text) — matches the approved design's explicit "reuse, do not duplicate" instruction.
