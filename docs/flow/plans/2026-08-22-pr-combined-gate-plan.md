# PR Combined Gate Implementation Plan

**Goal:** ask "chỉ PR / PR rồi merge / merge thẳng bỏ qua PR" as ONE clear upfront choice, right after description approval — instead of a late separate merge gate discovered only after PR is already published.

**Approved design:** keep the existing description-approval gate (Step 4 in both modes) exactly as-is. Insert a new gate immediately after "Approve"/"Approve all" is chosen, with exactly 4 options (`AskUserQuestion`'s option limit): "Chỉ tạo/update PR" / "Tạo PR rồi merge luôn" / "Merge thẳng, bỏ qua PR" / "Cancel". Branch orchestration on this choice — publish only, publish+merge, merge-only (skip publish), or stop. Remove the old separate late merge gate (Orchestration Step 6's own question, Batch Step 6's own question) since it's now folded into this earlier combined choice — keep all the merge *mechanics* (dirty check, gh/local merge, conflict handling, resync, push sub-ask) unchanged, just triggered earlier.

**Spec:** `commands/pr.md` (main repo, direct edit).

## Global Constraints

- `AskUserQuestion` allows at most 4 explicit options — the new combined gate uses exactly 4, and it stays a **separate** question from Step 4's description gate (not merged into it, since Step 4 already has 3 options of its own: Approve as-is/Edit/Cancel or Approve all/Review individually/Cancel).
- Never lose the ability to cleanly stop — "Cancel" stays an explicit option on the new gate.
- Merge mechanics (dirty check, gh vs local merge, conflict-abort-and-report, resync-on-non-fast-forward, push sub-ask) are unchanged in substance — only when they're triggered changes.
- Push stays its own separate ask, never implied by the new combined choice.

---

### Task 1: Single-repo mode — insert combined gate, remove old late merge gate

**Files:**
- Modify: `commands/pr.md`

**Interfaces:** none (doc-only), internal step renumbering within the same command file.

- [ ] **Step 1: Replace old Step 6 (the late merge gate) with the new combined gate, inserted as Step 5, renumbering the old Step 5 (publish) to Step 6 and folding its trigger condition**

Old (current Steps 5-6, lines 21-30):
```
5. Only if approved: check whether the `gh` CLI is available (`gh --version`). If available, check whether an open PR exists for the current branch targeting `<base>` (`gh pr view --json url`; `gh pr view` with no args uses the current branch's context by default when run inside the repo — verify this resolves the correct branch, not an assumed one).
   - If `gh` available AND an open PR exists: write the description to a temp file **using the Write tool** (never by shell-interpolating the generated text into an `echo`/heredoc/redirect command line — the description contains attacker-influenceable content from commit messages and diff text, and building a shell command by string-concatenating it in is a command-injection risk), then run `gh pr edit --body-file <tmpfile>` — **use `--body-file`, not inline `--body <description>`**, since the description is multi-line and inline argument passing is unreliable across shells/quoting (especially on Windows/PowerShell). Report the PR URL back to the user, then delete the temp file.
   - If `gh` is unavailable, or no open PR exists yet: this is an expected fallback, not an error — print the final description clearly for the user to paste manually, and say plainly why (no `gh` / no open PR yet).
6. Only after Step 5 completes (published or fallback-printed): gate a real merge via a **separate** `AskUserQuestion`, distinct from Step 4's description-approval gate — "Merge `<current-branch>` vào `<base>` bây giờ?" with exactly these two options: "Approve — merge now", "Skip — leave for later". Never merge on the strength of Step 4's approval alone, and never merge without this explicit gate.
   - "Skip — leave for later": stop here — report that `<current-branch>` (and its PR, if one exists) remains for a human to merge later. Do nothing further.
   - "Approve — merge now": first run `git status --porcelain` in the current worktree. If it prints anything, the worktree is dirty — STOP and report this plainly, do not merge.
     - If `gh` is available (`gh --version`) and an open PR exists for this branch (reuse Step 5's `gh pr view` check): run `gh pr merge --merge` (a plain merge commit — never `--squash`/`--rebase` by default).
     - Otherwise (no `gh`, or no open PR): merge locally — `git checkout <base>`, then `git merge <current-branch> --no-ff`. If this merge reports a conflict, run `git merge --abort` immediately, `git checkout <current-branch>` to return, and STOP — report the conflict plainly and that no merge happened; do not attempt to resolve it yourself here (this single-repo path has no `Agent`/`verifier` resync machinery — that only exists in batch mode). Only on a clean merge, `git checkout <current-branch>` to return to the original branch afterward.
     - If a remote `origin` is configured (`git remote get-url origin` succeeds), ask one more, **separate** `AskUserQuestion` — "Push `<base>` to origin now?" with options "Approve — push" / "Skip — leave unpushed" — before running `git push origin <base>`. Never push without this explicit second ask; approving the merge never implies approving the push.
     - Report the merge result plainly: fast-forward, or the merge commit SHA.
```

New (replaces both, as Steps 5-6):
```
5. Only if Step 4 was approved: present a **new, separate** `AskUserQuestion` — the action choice — with exactly these 4 options:
   - "Chỉ tạo/update PR": go to Step 6 below, publish-only path, then stop (no merge follows).
   - "Tạo PR rồi merge luôn": go to Step 6, publish path, then immediately continue into the merge mechanics further down this step — no additional merge-approval question is asked, this choice already answers it.
   - "Merge thẳng, bỏ qua PR": skip Step 6's publish logic entirely (no PR created or updated) and go straight to the merge mechanics further down this step.
   - "Cancel": stop immediately, do nothing further — no publish, no merge.

   **Publish path (Step 6, run when "Chỉ tạo/update PR" or "Tạo PR rồi merge luôn" was chosen):** check whether the `gh` CLI is available (`gh --version`). If available, check whether an open PR exists for the current branch targeting `<base>` (`gh pr view --json url`; `gh pr view` with no args uses the current branch's context by default when run inside the repo — verify this resolves the correct branch, not an assumed one).
   - If `gh` available AND an open PR exists: write the description to a temp file **using the Write tool** (never by shell-interpolating the generated text into an `echo`/heredoc/redirect command line — the description contains attacker-influenceable content from commit messages and diff text, and building a shell command by string-concatenating it in is a command-injection risk), then run `gh pr edit --body-file <tmpfile>` — **use `--body-file`, not inline `--body <description>`**, since the description is multi-line and inline argument passing is unreliable across shells/quoting (especially on Windows/PowerShell). Report the PR URL back to the user, then delete the temp file.
   - If `gh` is unavailable, or no open PR exists yet: this is an expected fallback, not an error — print the final description clearly for the user to paste manually, and say plainly why (no `gh` / no open PR yet).
   - If "Chỉ tạo/update PR" was chosen: stop here — do not proceed to the merge mechanics below.

   **Merge mechanics (run only when "Tạo PR rồi merge luôn" or "Merge thẳng, bỏ qua PR" was chosen — never a separate approval question here, Step 5's choice already authorized this):** first run `git status --porcelain` in the current worktree. If it prints anything, the worktree is dirty — STOP and report this plainly, do not merge.
   - If `gh` is available (`gh --version`) and an open PR exists for this branch (only possible when "Tạo PR rồi merge luôn" was chosen — reuse the publish path's `gh pr view` check): run `gh pr merge --merge` (a plain merge commit — never `--squash`/`--rebase` by default).
   - Otherwise (no `gh`, no PR, or "Merge thẳng, bỏ qua PR" was chosen — there is never a PR in that path by definition): merge locally — `git checkout <base>`, then `git merge <current-branch> --no-ff`. If this merge reports a conflict, run `git merge --abort` immediately, `git checkout <current-branch>` to return, and STOP — report the conflict plainly and that no merge happened; do not attempt to resolve it yourself here (this single-repo path has no `Agent`/`verifier` resync machinery — that only exists in batch mode). Only on a clean merge, `git checkout <current-branch>` to return to the original branch afterward.
   - If a remote `origin` is configured (`git remote get-url origin` succeeds), ask one more, **separate** `AskUserQuestion` — "Push `<base>` to origin now?" with options "Approve — push" / "Skip — leave unpushed" — before running `git push origin <base>`. Never push without this explicit ask; the Step 5 choice never implies push approval.
   - Report the merge result plainly: fast-forward, or the merge commit SHA.
```

- [ ] **Step 2: Verify numbering**

Run: `grep -n "^[0-9]\." "commands/pr.md" | head -20` — confirm single-repo mode's Orchestration is now Steps 1-5 (with Step 5 containing the combined gate + both publish and merge mechanics inline), no duplicate/skipped numbers.

---

### Task 2: Batch mode — insert combined gate, remove old late merge gate

**Files:**
- Modify: `commands/pr.md`

**Interfaces:** consumes Task 1's single-repo Step 5 (referenced, not duplicated, for "Review each individually").

- [ ] **Step 1: Replace old Step 5-6-7 (publish, late merge gate, push ask) with the new combined gate + inline publish/merge mechanics, keeping the resync loop's exact mechanics unchanged**

Old (current Steps 4-7 plus the paragraph between them, lines 50-76):
```
4. Present exactly one `AskUserQuestion` gate for the whole batch, with exactly these three options:
   - "Approve all — open/update N PRs" (N = count of READY worktrees): proceed to Step 5 below for every READY worktree, no further per-worktree confirmation.
   - "Review each individually": for each READY worktree, in turn, run the existing single-repo mode's own Orchestration Step 4 `AskUserQuestion` gate ("Approve as-is" / "Edit — describe changes" / "Cancel") exactly as written there, using that worktree's generated description; only worktrees individually approved there proceed to Step 5. "Edit" still requires a fresh re-approval before proceeding, same rule as single-repo mode.
   - "Cancel": stop immediately — do not touch any worktree's git state further and do not publish anything. FAILED worktrees remain merge-aborted from Step 2b; READY worktrees' generated descriptions are simply discarded, not saved anywhere.
5. For each worktree approved (via either path in Step 4), apply the existing single-repo mode's Orchestration Step 5 publish logic unchanged in substance, with `<target>` in place of `<base>` and this worktree's branch as the head:
   [... publish bullets unchanged ...]

Steps 1-5 above never run `git merge <target>` for real as a final merge into `<target>`, and never run `gh pr merge` — those steps only create/update PR bodies. Real merging into `<target>`, if desired, happens only in Step 6 below, behind its own explicit aggregate approval gate — never as a side effect of publishing.

6. Only after Step 5 completes for every approved worktree (published or fallback-printed): from the **main worktree** (repo root) only — never from inside any feature worktree's directory — present **one aggregate** `AskUserQuestion` gate for the whole batch: "Merge thật N branch (đã publish) vào `<target>` bây giờ?" (N = count of worktrees that reached READY-and-published in Step 5), with exactly these three options:
   - "Approve — merge all now": proceed to the sequential merge loop below.
   - "Skip — leave PRs open": stop here — report which branches still have open PRs, unchanged, for a human to merge later. Do nothing further.
   - "Review each individually": for each READY-and-published worktree, in turn, run single-repo mode's own Step 6 gate above **verbatim** (its "Approve — merge now" / "Skip — leave for later" options and all its checks), once per branch, substituting `<target>` for `<base>`. Skip only its local-fallback push sub-ask here — batch mode's push question is asked once for the whole batch in point 7 below, not per branch.

   On "Approve — merge all now", first run `git status --porcelain` in the main worktree. [...resync loop a-e unchanged...]
7. If any branch merged successfully in point 6 [...push ask unchanged...]
```

New (replaces the gate + trigger wording; the publish bullets under old Step 5 and the resync loop's steps a-e stay byte-identical, only re-homed under the new structure):
```
4. Present exactly one `AskUserQuestion` gate for the whole batch — the description-review gate, unchanged in shape — with exactly these three options:
   - "Approve all": proceed to Step 5 below for every READY worktree, no further per-worktree confirmation of the *description* (the action choice comes next, in Step 5).
   - "Review each individually": for each READY worktree, in turn, run the existing single-repo mode's own Orchestration Step 4 `AskUserQuestion` gate ("Approve as-is" / "Edit — describe changes" / "Cancel") exactly as written there, using that worktree's generated description; worktrees individually approved there each then go through single-repo mode's own Step 5 combined action-choice gate (Task 1) on their own, substituting `<target>` for `<base>`. "Edit" still requires a fresh re-approval before proceeding, same rule as single-repo mode.
   - "Cancel": stop immediately — do not touch any worktree's git state further and do not publish anything. FAILED worktrees remain merge-aborted from Step 2b; READY worktrees' generated descriptions are simply discarded, not saved anywhere.
5. Only if "Approve all" was chosen in Step 4: present a **new, separate** `AskUserQuestion` — the batch action choice — with exactly these 4 options:
   - "Chỉ tạo/update PR cho N worktree" (N = count of READY worktrees): go to Step 6 below, publish-only path for every READY worktree, then stop (no merge loop follows).
   - "Tạo PR rồi merge luôn": go to Step 6, publish path for every READY worktree, then immediately continue into the merge loop further down (Step 7) — no additional aggregate merge-approval question is asked, this choice already answers it.
   - "Merge thẳng cho N worktree, bỏ qua PR": skip Step 6's publish logic entirely for all worktrees (no PRs created/updated) and go straight to the merge loop (Step 7).
   - "Cancel": stop immediately — do not touch any worktree's git state further, do not publish, do not merge.
6. **Publish path (run when "Chỉ tạo/update PR cho N worktree" or "Tạo PR rồi merge luôn" was chosen):** for each worktree approved in Step 4, apply the existing single-repo mode's publish logic unchanged in substance, with `<target>` in place of `<base>` and this worktree's branch as the head:
   - Check `gh --version`, then check whether an open PR already exists for this worktree's branch targeting `<target>` (`gh pr view`, run from inside this worktree's directory so it resolves this branch's context, not an assumed one — same caveat single-repo mode states).
   - If `gh` available and no PR exists yet: write the description to a temp file **using the Write tool** (never shell-interpolated — same injection-safety rule as single-repo mode, the description contains attacker-influenceable commit-message/diff text), then run `gh pr create --base <target> --head <worktree-branch> --title <title> --body-file <tmpfile>`. Derive `<title>` from the first non-empty **content line** under the `## What changed` heading (not the heading text itself — never literally title a PR `## What changed`). This title is attacker-influenceable the same way the body is, but `gh pr create` has no `--title-file` equivalent, so it must go inline — before using it as a CLI argument, strip or replace every character outside a safe printable set (`a-z`, `A-Z`, `0-9`, spaces, and basic punctuation `.,:()/-`) with a space, and collapse repeated spaces. Never pass the raw, unsanitized title into the command line, even truncated.
   - If `gh` available and a PR already exists: write the description to a temp file the same way, then run `gh pr edit --body-file <tmpfile>` exactly as single-repo mode does.
   - If `gh` is unavailable: same expected fallback as single-repo mode — print this worktree's description plainly for manual use and say why (no `gh`). This is not an error.
   - Report each PR's URL (or fallback notice) back to the user as soon as it completes; delete each temp file right after use.
   - If "Chỉ tạo/update PR cho N worktree" was chosen: stop here — do not proceed to Step 7.

   This publish path never runs `git merge <target>` for real as a final merge, and never runs `gh pr merge` — it only creates/updates PR bodies. Real merging into `<target>`, when it happens, is Step 7 below — reached only via Step 5's earlier choice, never a separate late question.
7. **Merge loop (run only when "Tạo PR rồi merge luôn" or "Merge thẳng cho N worktree, bỏ qua PR" was chosen — never a separate aggregate approval question here, Step 5's choice already authorized this):** from the **main worktree** (repo root) only — never from inside any feature worktree's directory. First run `git status --porcelain` in the main worktree. If it prints anything, the main worktree is dirty — STOP the whole merge loop before touching anything, and report this plainly (none of the worktrees get merged; any PRs from Step 6 remain open).

   Otherwise, process the worktrees selected by Step 5 (all READY worktrees on "Tạo PR rồi merge luôn"/"Merge thẳng cho N worktree, bỏ qua PR") **sequentially, one at a time, never in parallel** (same discipline as Step 2), from the main worktree with `<target>` checked out:
   a. For each branch, attempt `git merge <branch> --no-ff` into `<target>`.
   b. **Clean fast-forward/auto-merge (expected case):** each worktree already merged `<target>` into itself during Step 2's conflict-check pass, so this should apply cleanly — commit, move to the next branch.
   c. **Not a clean fast-forward** (a prior branch earlier in this same loop already advanced `<target>` past what this branch saw during its own Step 2 merge): in that worktree's own directory, merge `<target>`'s new HEAD back into this worktree's branch first, then dispatch the `Agent` tool to resolve any conflict and the `verifier` subagent to re-verify — reusing the **exact** blocking dispatch-and-wait pattern from Batch Orchestration Step 2c (call once, wait for the result before continuing; Agent-cannot-resolve → `git merge --abort`; verifier FAIL → `git reset --hard ORIG_HEAD`) — then retry `git merge <branch> --no-ff` into `<target>`.
   d. If a branch's merge into `<target>` still fails after one resync attempt: mark it **FAILED** for this step (its PR, if any, is left open, untouched), report why, and continue with the remaining branches — one branch's failure never blocks or aborts the others.
   e. After all branches are processed, report the final result: which branches merged into `<target>` (each with its merge commit SHA), and which remain unmerged (FAILED-to-merge — or, on "Merge thẳng", never had a PR to fall back to, so report the branch name plainly for manual handling), plainly.
8. If any branch merged successfully in Step 7 and a remote `origin` is configured (`git remote get-url origin` succeeds, checked once from the main worktree), ask **one more, separate** `AskUserQuestion` for the whole batch — "Push `<target>` to origin now?" with options "Approve — push" / "Skip — leave unpushed" — before running `git push origin <target>`. Never push automatically; this is a single batch-wide ask, not one per branch.
```

- [ ] **Step 2: Verify numbering**

Run: `grep -n "^[0-9]\." "commands/pr.md"` — confirm Batch Orchestration is now Steps 0-8, sequential, nothing renumbered incorrectly, and single-repo mode's Steps 1-5 (Task 1) are unaffected by this insertion.

---

### Task 3: Update `## Hard rules` to match the new step numbers and combined-gate wording

**Files:**
- Modify: `commands/pr.md`

- [ ] **Step 1: Fix all stale Step-number references**

Search for and update every Hard rule that names a specific old step number so it points at the new location:
- "Orchestration Step 6" (single-repo merge gate/mechanics) → "Orchestration Step 5" (now where the combined gate + merge mechanics live).
- "Batch Orchestration Step 6" (merge loop) → "Batch Orchestration Step 7".
- "Step 7" (batch push ask) → "Step 8".
- Any rule phrased as "Never merge without going through Step X's dedicated `AskUserQuestion` gate — separate from Step 4's description-approval gate" should be reworded to: "Never merge or publish without going through the Step 5 action-choice gate — a separate question from Step 4's description-approval gate; approving the description in Step 4 never implies choosing to publish or merge."

- [ ] **Step 2: Placeholder + consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder|flow-brainstorm|flow-plan|flow-execute" "commands/pr.md"` — expect no matches.
Run: `grep -n "Step 6\|Step 7" "commands/pr.md"` — confirm no remaining reference to the OLD Step 6 (single-repo late merge gate) or OLD Step 6/7 (batch late merge gate/push ask) — every remaining "Step 6"/"Step 7" mention should refer to the NEW locations (single-repo Step 5's internals aren't separately numbered, so "Step 6" should only appear in batch mode context now, referring to the new publish step, and "Step 7"/"Step 8" for the new merge loop/push ask).

- [ ] **Step 3: Run this repo's own documented test command**

Run the exact command from `CLAUDE.md`'s `## Test` section against the repo root. Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add commands/pr.md && git commit -m "refactor: /pr asks PR-vs-merge choice once, upfront, instead of a late separate merge gate"
```

---

### Task 4: Re-run against the 6 existing worktrees with the new combined gate

**Files:** none — this is a live re-run of the already-updated command, not a code change.

- [ ] **Step 1: Run the new combined-gate flow for the 6 worktrees**

For each of `jira-sync`, `fix-feature`, `migration-safe`, `playwright-test`, `scaffold`, `optimize` (branches already merged with `main` and verified PASS from the prior session): re-enter batch mode manually — since `gh` has no `auth` yet, choose the **"Merge thẳng cho N worktree, bỏ qua PR"** path at the new Step 5 gate (matches current real capability: no `gh` auth means no PR could be created anyway) — proceed straight to Step 7's merge loop for all 6.

Expected: same outcome as the actual capability already smoke-tested in Task 3 of `2026-08-22-pr-real-merge-plan.md` (sequential merge into `main`, resync-on-non-fast-forward reusing Step 2c's Agent+verifier pattern) — this time exercised through the new combined-gate entry point instead of the old two-gate flow.

---

## Self-Review Notes

- **Spec coverage:** the approved design's every clause (single upfront 4-option gate, remove old late gates, keep merge mechanics unchanged, push stays separate) maps to Task 1 (single-repo) and Task 2 (batch) exactly.
- **Option-count constraint resolved:** kept Step 4 (description review) and the new action-choice gate as two separate questions, rather than cramming 5+ options into one — this is why the design's original "fold into Step 4" idea was adjusted to "a new Step 5 immediately following Step 4's approval," while still being asked upfront/early exactly as the user wanted, before any publish or merge action happens.
- **Placeholder scan:** all inserted/replaced text is literal and complete; no TBD.
- **Renumbering discipline:** Task 3 explicitly re-scans Hard rules for stale step-number references — the single most likely place for this restructure to leave a dangling/wrong pointer.
