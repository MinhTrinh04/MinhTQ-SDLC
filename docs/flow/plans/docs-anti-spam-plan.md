# Docs Anti-Spam Implementation Plan

**Goal:** stop `flow-plan`/`flow-brainstorm` from creating a new dated doc file every time an existing feature/command gets a follow-up change. Switch to one file per feature (`docs/flow/plans/<feature>-plan.md`, `docs/flow/specs/<topic>-design.md`), appended with a new Task/section on each subsequent change. Then retroactively consolidate every existing doc in this repo onto the new convention.

**Approved design:**
1. Drop the `YYYY-MM-DD-` prefix from plan/spec filenames going forward — date moves into the content (per-Task heading), not the filename.
2. `flow-plan`: before writing, check whether `docs/flow/plans/<feature>-plan.md` already exists. If yes, append a new `### Task N: <title> (added YYYY-MM-DD)` section (continuing the existing numbering) instead of creating a new file. If no, create it as before (new filename convention).
3. `flow-brainstorm`'s architectural spec-writing step: same rule, for `docs/flow/specs/<topic>-design.md`.
4. Retroactively consolidate every existing multi-file feature's plans into one file each, and rename every single-file plan/spec to drop its date prefix.

---

### Task 1: Fix `skills/flow-plan/SKILL.md`

**Files:**
- Modify: `skills/flow-plan/SKILL.md`

- [ ] **Step 1: Replace the file-naming instruction**

Old (Process step 4):
```
4. Save to `docs/flow/plans/YYYY-MM-DD-<topic>-plan.md` in the target repo, commit it.
```
New:
```
4. Before saving, check whether `docs/flow/plans/<feature>-plan.md` already exists for this feature/command (glob `docs/flow/plans/*<feature-slug>*plan.md` — match by feature/command name, not by date). 
   - If it already exists: append this plan as a new section at the end of that SAME file — `### Task N: <short title> (added YYYY-MM-DD)`, continuing the task numbering from where the file left off (never restart numbering, never duplicate an existing Task N). Do not create a new file, do not put the date in the filename.
   - If it does not exist yet: create `docs/flow/plans/<feature>-plan.md` (no date in the filename — the date lives in each Task's heading if it matters later). This is the only case that creates a new file.
   Commit either way.
```

- [ ] **Step 2: Add a Hard rule**

Append to `## Hard rules`:
```
- Never create a new dated plan file for a feature that already has one — append a new Task section to the existing `docs/flow/plans/<feature>-plan.md` instead. A new file is only for a feature with no existing plan doc at all.
```

- [ ] **Step 3: Verify**

Run: `bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'` (this repo's own CLAUDE.md test). Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add skills/flow-plan/SKILL.md && git commit -m "fix: flow-plan appends to existing per-feature plan file instead of always creating a new dated one"
```

---

### Task 2: Fix `skills/flow-brainstorm/SKILL.md`

**Files:**
- Modify: `skills/flow-brainstorm/SKILL.md`

- [ ] **Step 1: Replace the architectural spec-writing instruction**

Old (Process step 6, architectural bullet):
```
   - Architectural: sectioned design, then write to `docs/flow/specs/YYYY-MM-DD-<topic>-design.md`, commit it.
```
New:
```
   - Architectural: sectioned design. Check whether `docs/flow/specs/<topic>-design.md` already exists for this topic (glob by topic/feature name, not date). If it exists, append this design as a new dated section at the end of that SAME file instead of creating a new one. If it doesn't exist yet, create `docs/flow/specs/<topic>-design.md` (no date in the filename). Commit either way.
```

- [ ] **Step 2: Add a Hard rule**

Append to `## Hard rules`:
```
- Never create a new dated spec file for a topic that already has one — append a new dated section to the existing `docs/flow/specs/<topic>-design.md` instead.
```

- [ ] **Step 3: Verify**

Run the same CLAUDE.md test command. Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add skills/flow-brainstorm/SKILL.md && git commit -m "fix: flow-brainstorm appends to existing per-topic spec file instead of always creating a new dated one"
```

---

### Task 3: Consolidate multi-file features into one file each

**Files:**
- Create: `docs/flow/plans/flow-batch-plan.md` (merge `2026-08-21-flow-batch-plan.md` + `2026-08-21-flow-batch-pipeline-redesign-plan.md`)
- Create: `docs/flow/plans/pr-plan.md` (merge `2026-08-21-pr-description-plan.md` + `2026-08-22-pr-description-batch-mode-plan.md` + `2026-08-22-pr-real-merge-plan.md` + `2026-08-22-pr-combined-gate-plan.md`, in that chronological order)
- Delete: the 6 source files above once merged content is verified intact.

- [ ] **Step 1: Build `docs/flow/plans/flow-batch-plan.md`**

Concatenate `2026-08-21-flow-batch-plan.md`'s content (dropping its "Superseded" banner at the top, since it's being unified now, not superseded) as `### Task 1` (renumber its internal tasks to fit under one umbrella if needed, or keep as-is if it already reads as one self-contained plan), followed by `2026-08-21-flow-batch-pipeline-redesign-plan.md`'s content as the next Task(s), each section prefixed with `(added 2026-08-21)`. Preserve every line of actual content — this is a reorganization (headings/numbering), not a rewrite; do not drop or paraphrase any instructional text.

- [ ] **Step 2: Build `docs/flow/plans/pr-plan.md`**

Concatenate, in order: `2026-08-21-pr-description-plan.md` (added 2026-08-21), `2026-08-22-pr-description-batch-mode-plan.md` (added 2026-08-22), `2026-08-22-pr-real-merge-plan.md` (added 2026-08-22), `2026-08-22-pr-combined-gate-plan.md` (added 2026-08-22) — each as its own `### Task N: <title> (added <date>)` block, renumbering sequentially across the whole merged file so there's one continuous Task list, not four restarting at Task 1. Preserve every line of actual content.

- [ ] **Step 3: Delete the 6 now-merged source files**

```bash
git rm docs/flow/plans/2026-08-21-flow-batch-plan.md docs/flow/plans/2026-08-21-flow-batch-pipeline-redesign-plan.md docs/flow/plans/2026-08-21-pr-description-plan.md docs/flow/plans/2026-08-22-pr-description-batch-mode-plan.md docs/flow/plans/2026-08-22-pr-real-merge-plan.md docs/flow/plans/2026-08-22-pr-combined-gate-plan.md
```

- [ ] **Step 4: Verify no content was lost**

For each merged file, run `wc -l` on the new consolidated file and compare against the sum of the source files' line counts (accounting for removed duplicate headers) — confirm the new file's line count is in the same ballpark (not drastically shorter, which would indicate accidental truncation).

- [ ] **Step 5: Commit**

```bash
git add docs/flow/plans/flow-batch-plan.md docs/flow/plans/pr-plan.md && git commit -m "docs: consolidate flow-batch and pr plan files into one file per feature"
```

---

### Task 4: Rename remaining single-file plans/specs to drop the date prefix

**Files:**
- Rename: `docs/flow/plans/2026-08-21-fix-feature-plan.md` → `docs/flow/plans/fix-feature-plan.md`
- Rename: `docs/flow/plans/2026-08-21-flow-core-pipeline-plan.md` → `docs/flow/plans/flow-core-pipeline-plan.md`
- Rename: `docs/flow/plans/2026-08-21-jira-sync-plan.md` → `docs/flow/plans/jira-sync-plan.md`
- Rename: `docs/flow/plans/2026-08-21-migration-safe-plan.md` → `docs/flow/plans/migration-safe-plan.md`
- Rename: `docs/flow/plans/2026-08-21-optimize-plan.md` → `docs/flow/plans/optimize-plan.md`
- Rename: `docs/flow/plans/2026-08-21-playwright-test-plan.md` → `docs/flow/plans/playwright-test-plan.md`
- Rename: `docs/flow/plans/2026-08-21-scaffold-plan.md` → `docs/flow/plans/scaffold-plan.md`
- Rename: `docs/flow/plans/2026-08-22-repo-claude-md-verify-plan.md` → `docs/flow/plans/repo-claude-md-verify-plan.md`
- Rename: `docs/flow/plans/2026-08-22-verifier-overall-consistency-plan.md` → `docs/flow/plans/verifier-overall-consistency-plan.md`
- Rename: `docs/flow/specs/2026-08-21-loop-engineering-flow-design.md` → `docs/flow/specs/loop-engineering-flow-design.md`

- [ ] **Step 1: Rename each file via `git mv`**

```bash
git mv docs/flow/plans/2026-08-21-fix-feature-plan.md docs/flow/plans/fix-feature-plan.md
git mv docs/flow/plans/2026-08-21-flow-core-pipeline-plan.md docs/flow/plans/flow-core-pipeline-plan.md
git mv docs/flow/plans/2026-08-21-jira-sync-plan.md docs/flow/plans/jira-sync-plan.md
git mv docs/flow/plans/2026-08-21-migration-safe-plan.md docs/flow/plans/migration-safe-plan.md
git mv docs/flow/plans/2026-08-21-optimize-plan.md docs/flow/plans/optimize-plan.md
git mv docs/flow/plans/2026-08-21-playwright-test-plan.md docs/flow/plans/playwright-test-plan.md
git mv docs/flow/plans/2026-08-21-scaffold-plan.md docs/flow/plans/scaffold-plan.md
git mv docs/flow/plans/2026-08-22-repo-claude-md-verify-plan.md docs/flow/plans/repo-claude-md-verify-plan.md
git mv docs/flow/plans/2026-08-22-verifier-overall-consistency-plan.md docs/flow/plans/verifier-overall-consistency-plan.md
git mv docs/flow/specs/2026-08-21-loop-engineering-flow-design.md docs/flow/specs/loop-engineering-flow-design.md
```

- [ ] **Step 2: Fix cross-references**

Search the whole repo for any remaining reference to the old dated filenames (other plan files, commands, skills may link to them by path) and update to the new names:

```bash
grep -rl "2026-08-2[12]-" --include="*.md" . | grep -v "^docs/flow/plans/pr-plan.md\|^docs/flow/plans/flow-batch-plan.md"
```

Fix every match found (update the path reference to the renamed file, or to the consolidated `pr-plan.md`/`flow-batch-plan.md` from Task 3 if it pointed at one of the 6 merged-away files).

- [ ] **Step 3: Verify**

Run this repo's CLAUDE.md test command. Expected: `PASS`. Also re-run the Task 4 Step 2 grep — expect zero remaining stale references.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: rename remaining plan/spec files to drop date prefix, fix cross-references"
```

---

## Self-Review Notes

- **Spec coverage:** the approved design's 4 points map to Tasks 1 (flow-plan fix), 2 (flow-brainstorm fix), 3 (consolidate multi-file features), 4 (rename single-file ones + fix references).
- **No content loss:** Task 3 Step 4 explicitly checks line counts before deleting sources; Task 4 explicitly re-checks for dangling references after renaming.
- **This plan file itself already follows the new convention** — named `docs-anti-spam-plan.md`, no date prefix, ready to receive future Task additions if this rule itself needs revisiting later instead of spawning a new file.
