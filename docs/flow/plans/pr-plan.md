# PR Command Implementation Plan

**Consolidated (2026-08-22):** merges the following, in chronological order, into one continuous Task list (Tasks 1-14): PR-Description Command plan (2026-08-21), PR-Description Batch Mode plan (2026-08-22), PR Real-Merge plan (2026-08-22), PR Combined Gate plan (2026-08-22). Every task/section below is preserved from its source, only renumbered.

# PR-Description Command Implementation Plan

**Goal:** `commands/pr-description.md` — 1-shot, no-loop, fully independent command: reads real git diff/log, generates a PR description, gates human approval, optionally publishes via `gh pr edit` with a graceful manual-fallback path.

**Approved design:** no `--jira`/`--file`/text input adapter (reads git state, not an external requirement) — optional base-branch argument, default `main`. No flow-brainstorm/flow-plan/flow-execute involvement at all. Never auto-merge, never push, never commit.

---

### Task 1: Create `commands/pr-description.md` (added 2026-08-21)

**Files:**
- Create: `commands/pr-description.md`

**Interfaces:**
- Consumes: nothing from the flow-* family. Ad hoc: `git diff`, `git log`, optionally `gh pr view`/`gh pr edit` (Bash).
- Produces: the `/pr-description` slash command.

- [ ] **Step 1: Write the command file**

```markdown
---
description: Generate a PR description (What changed / Why / How to test) from real git diff + commit log against a base branch, gate human approval, then optionally publish via gh pr edit or print for manual paste. 1-shot, no loop/retry, fully independent of the multi-stage requirement pipeline.
---

# /pr-description

Arguments: `$ARGUMENTS` — OPTIONAL, a single base branch name; defaults to `main` if omitted.

This command does **not** use the `--jira`/`--file`/bare-text input adapter used by `/flow`, `/fix-feature`, `/optimize`, `/playwright-test` — it reads from git itself, not an external requirement/spec/bug report. Do not accept or attempt to parse `--jira`/`--file` flags here even if passed by habit — treat any argument as a candidate base-branch name only, or "no argument" (→ `main`).

## Orchestration

1. Determine `<base>` = `$ARGUMENTS` if non-empty, else `main`. Before using it anywhere, validate it looks like a plausible git ref: only `a-z`, `A-Z`, `0-9`, `/`, `-`, `_`, `.` — no spaces, quotes, `$`, backticks, `;`, `|`, or other shell metacharacters. If it fails this check, say so plainly and STOP — never pass an unvalidated argument into a shell command, even one that would "just" produce a git error if wrong.
2. Run `git log <base>..HEAD --oneline` and `git diff <base>...HEAD` in the target repo via Bash to get the real commit messages and diff, using `<base>` only after it has passed Step 1's validation. If either command errors (e.g. `<base>` doesn't exist, or not in a git repo), state the actual error plainly and STOP — never fabricate a diff or commit list.
3. Read the diff and commit messages, generate a PR description using exactly this template, in this order: `## What changed`, `## Why`, `## How to test`.
4. Print the generated description in chat, then gate via `AskUserQuestion` with exactly these three options: "Approve as-is", "Edit — describe changes", "Cancel". This is a real approval gate despite having no other flow-* dependency, per README's "verify: không auto-merge; người đọc lại mô tả trước khi publish."
   - "Edit — describe changes": ask what to change, regenerate, then re-present the same `AskUserQuestion` gate again — never publish on an edit request without a fresh approval.
   - "Cancel": stop immediately, do nothing further, no publish attempt.
5. Only if approved: check whether the `gh` CLI is available (`gh --version`). If available, check whether an open PR exists for the current branch targeting `<base>` (`gh pr view --json url`; `gh pr view` with no args uses the current branch's context by default when run inside the repo — verify this resolves the correct branch, not an assumed one).
   - If `gh` available AND an open PR exists: write the description to a temp file **using the Write tool** (never by shell-interpolating the generated text into an `echo`/heredoc/redirect command line — the description contains attacker-influenceable content from commit messages and diff text, and building a shell command by string-concatenating it in is a command-injection risk), then run `gh pr edit --body-file <tmpfile>` — **use `--body-file`, not inline `--body <description>`**, since the description is multi-line and inline argument passing is unreliable across shells/quoting (especially on Windows/PowerShell). Report the PR URL back to the user, then delete the temp file.
   - If `gh` is unavailable, or no open PR exists yet: this is an expected fallback, not an error — print the final description clearly for the user to paste manually, and say plainly why (no `gh` / no open PR yet).

## Hard rules

- Never auto-merge, never push, never create commits — read-only on git history, at most updates a PR's body text.
- Never fabricate diff/commit content if the git commands fail — stop and report the actual error.
- Never publish (via `gh pr edit`) without going through the `AskUserQuestion` approval gate first, and never treat an "Edit" response as approval — only "Approve as-is" (or a fresh approval after edits) authorizes publishing.
- Never treat a missing `gh` CLI or missing open PR as an error condition — both are expected, documented fallback paths that end in printing the description for manual use.
- Never accept `--jira`/`--file` on this command — if passed, treat the whole argument as a literal (probably wrong) base branch name and let Step 2's git error surface naturally.
- Never use inline `gh pr edit --body <description>` for a multi-line description — always `--body-file` with a temp file.
- Never interpolate `<base>` into a shell command before it has passed the ref-format validation in Orchestration Step 1.
- Never write the generated description to the temp file via shell string-interpolation — use the Write tool.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "commands/pr-description.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder|flow-brainstorm|flow-plan|flow-execute" "commands/pr-description.md"`
Expected: no matches at all — including zero references to the flow-* family, confirming true independence per the overlap table.

- [ ] **Step 4: Smoke-test the approve-and-publish path (gh available, open PR exists)**

On a scratch repo with `gh` CLI installed/authenticated, a feature branch with commits ahead of `main`, and an open PR already created for that branch: invoke `/pr-description`.
Expected: `git log`/`git diff` run against `main`, description generated with the three-section template, `AskUserQuestion` gate shown with the three named options, choosing "Approve as-is" runs `gh pr edit --body-file <tmpfile>` and reports the PR URL. No commits, pushes, or merges occur.

- [ ] **Step 5: Smoke-test the no-gh fallback path**

On a scratch repo without `gh` on PATH (or `gh` present but no open PR for the branch): invoke `/pr-description`.
Expected: description generated and gated the same way; on approval, no error — prints the final description plainly for manual paste, states why (no `gh` / no open PR).

- [ ] **Step 6: Smoke-test the Cancel path**

Invoke `/pr-description`, choose "Cancel" at the gate.
Expected: command stops immediately after printing the generated description; no `gh` command is ever attempted.

- [ ] **Step 7: Smoke-test the bad-base-branch error path**

Invoke `/pr-description nonexistent-branch` in a repo where that branch doesn't exist.
Expected: `git diff`/`git log` fails, the command states the actual git error plainly and stops — no fabricated diff.

- [ ] **Step 8: Commit**

```bash
git add commands/pr-description.md && git commit -m "feat: add /pr-description command (1-shot, no flow-* dependency)"
```

---

### Task 2: Batch mode (`--batch --target <branch>`) (added 2026-08-21)

**Goal:** extend `commands/pr-description.md` with `--batch --target <branch>` — process every git worktree sequentially, auto-resolve merge conflicts (verify-gated), then gate the whole batch behind ONE approval before creating/updating PRs. See Task 3 below for the full implementation plan this section mirrors.

**Approved design:** batch mode is additive, does not alter single-repo mode. Sequential (never parallel) per-worktree processing. Conflict → dispatch `Agent` to resolve → re-run full `verifier` → FAIL means abort+skip that worktree only (never blocks others). One aggregate `AskUserQuestion` gate for the whole batch (Approve all / Review each individually / Cancel). Never a real `git merge`/`gh pr merge` into `<target>` — only creates/updates PRs, human merges on GitHub (README.md line 12's "duyệt trước khi merge/deploy/production").

**Files:**
- Modify: `commands/pr-description.md`

**Interfaces:**
- Consumes (reused, not duplicated): Orchestration Step 1's ref-validation rule (applied to `<target>`); Steps 2-3's diff/log/template logic; Step 4's `AskUserQuestion` gate (verbatim, for "Review each individually"); Step 5's `gh` availability/open-PR-check/Write-tool-temp-file/`--body-file` logic.
- Consumes: `agents/verifier.md` (dispatched via `Agent` tool, blocking — wait for its result).
- Produces: the new batch-mode orchestration, only active when `--batch --target <branch>` is passed.

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

- [ ] **Step 4: Insert the "Batch Orchestration" section between `## Orchestration` and `## Hard rules`**

```markdown
## Batch Orchestration (`--batch --target <branch>`)

Batch mode does not replace single-repo mode above — it is a separate invocation path for when this repo has multiple git worktrees (e.g. features dispatched by `/flow-batch`'s Pha 2) that each need a PR opened/updated against the same `<target>`.

0. Validate `<target>` using the exact same shell-metacharacter check Orchestration Step 1 applies to `<base>` (only `a-z`, `A-Z`, `0-9`, `/`, `-`, `_`, `.`; no spaces/quotes/`$`/backticks/`;`/`|`). If it fails, say so plainly and STOP — same rule, same reason, reused verbatim, not reimplemented.
1. Run `git worktree list` via Bash in the main repo. Its **first row is always the main worktree** — exclude it positionally (never by comparing paths for equality; path-string comparison breaks on Windows across case, trailing slashes, short-vs-long paths, and symlink/junction resolution). Every remaining row is one candidate worktree/branch to process.
2. Process the remaining worktrees **sequentially, one at a time, never in parallel**:
   a. Before attempting anything, check this worktree's own state:
      - Run `git status --porcelain`. If it prints anything, the worktree is dirty (uncommitted changes) — mark it **FAILED** ("dirty worktree, uncommitted changes present") and move to the next worktree without touching it further.
      - Run `git symbolic-ref -q HEAD`. If this fails (non-zero exit), the worktree is in detached-HEAD state — mark it **FAILED** ("detached HEAD, no branch name available for `--head`") and move to the next worktree; a detached worktree has no branch name to open a PR from anyway.
   b. In that worktree's directory, run `git merge <target>`.
   c. **On conflict:** call the `Agent` tool once with a prompt stating: the worktree's path and branch name; that it is already an isolated worktree (do not request or expect `isolation: "worktree"` — none is needed here, unlike `/flow-batch`'s Pha 2, since this worktree already IS the isolation boundary); to read both sides of every conflicted file (via Bash `git diff`/`git status` and Read) and resolve them; then `git add` the resolved files and complete the merge (`git commit` with the default merge message); and to report explicitly whether it fully resolved and committed, or could not (e.g. leftover conflict markers, the commit itself failed). Unlike `commands/flow-batch.md`'s fire-and-forget dispatch pattern, **wait for this Agent's result before continuing** — do not move on to another worktree or to the verify step until this call returns, because verify is meaningless until the merge is actually resolved.
      - If the Agent reports it could NOT fully resolve and commit: run `git merge --abort` (safe here — the merge was never committed) and mark this worktree **FAILED** ("conflict resolution incomplete"). Move to the next worktree.
      - If the Agent reports it resolved and committed successfully: dispatch the `verifier` subagent (per `agents/verifier.md`) against this worktree to run the project's documented test/lint/build commands, and wait for its result the same way.
        If `verifier` reports FAIL (its Overall line is FAIL): the merge is already committed at this point, so `git merge --abort` will fail with "no merge to abort" and do nothing — instead run `git reset --hard ORIG_HEAD` (git sets `ORIG_HEAD` to the pre-merge commit automatically whenever a merge produces a commit) to actually undo it. Mark this worktree **FAILED** with the reason (state which check failed and the last ~30 lines of output verifier reported), and move on to the next worktree immediately — one worktree's failure never blocks or aborts processing of the others.
   d. **On no conflict (clean auto-merge):** the merge is already committed by git itself with no `Agent` involved — still dispatch the `verifier` subagent against this worktree the same way as the conflict path, and wait for its result. If FAIL: `git reset --hard ORIG_HEAD` (same reasoning as above — the auto-merge is already a real commit), mark **FAILED**, move on. A clean merge is not exempt from verification — an auto-merge can still break the build.
   e. **On resolve+verify PASS, or clean-merge+verify PASS:** generate the PR description for this worktree using the identical Orchestration Steps 2-3 logic above (same `git log`/`git diff` commands, same three-section template, `## What changed` / `## Why` / `## How to test`) — but substitute `<target>` for `<base>` and run the commands from inside this worktree's directory instead of the single-repo mode's working directory. Do not duplicate or rewrite the template text — apply the same steps with only the ref and working directory swapped. Mark this worktree **READY** and keep its generated description.
3. After every worktree has been processed (READY or FAILED), print one aggregate report: the count and list of READY worktrees (branch name + its generated description), then the count and list of FAILED worktrees (branch name + failure reason, per point 2b). Do not publish anything yet.
4. Present exactly one `AskUserQuestion` gate for the whole batch, with exactly these three options:
   - "Approve all — open/update N PRs" (N = count of READY worktrees): proceed to Step 5 below for every READY worktree, no further per-worktree confirmation.
   - "Review each individually": for each READY worktree, in turn, run the existing single-repo mode's own Orchestration Step 4 `AskUserQuestion` gate ("Approve as-is" / "Edit — describe changes" / "Cancel") exactly as written there, using that worktree's generated description; only worktrees individually approved there proceed to Step 5. "Edit" still requires a fresh re-approval before proceeding, same rule as single-repo mode.
   - "Cancel": stop immediately — do not touch any worktree's git state further and do not publish anything. FAILED worktrees remain merge-aborted from Step 2b; READY worktrees' generated descriptions are simply discarded, not saved anywhere.
5. For each worktree approved (via either path in Step 4), apply the existing single-repo mode's Orchestration Step 5 publish logic unchanged in substance, with `<target>` in place of `<base>` and this worktree's branch as the head:
   - Check `gh --version`, then check whether an open PR already exists for this worktree's branch targeting `<target>` (`gh pr view`, run from inside this worktree's directory so it resolves this branch's context, not an assumed one — same caveat single-repo mode Step 5 already states).
   - If `gh` available and no PR exists yet: write the description to a temp file **using the Write tool** (never shell-interpolated — same injection-safety rule as single-repo mode, the description contains attacker-influenceable commit-message/diff text), then run `gh pr create --base <target> --head <worktree-branch> --title <title> --body-file <tmpfile>`. Derive `<title>` from the first non-empty **content line** under the `## What changed` heading (not the heading text itself — never literally title a PR `## What changed`). This title is attacker-influenceable the same way the body is (it comes from commit-message/diff content), but `gh pr create` has no `--title-file` equivalent, so it must go inline — before using it as a CLI argument, strip or replace every character outside a safe printable set (`a-z`, `A-Z`, `0-9`, spaces, and basic punctuation `.,:()/-`) with a space, and collapse repeated spaces. Never pass the raw, unsanitized title into the command line, even truncated.
   - If `gh` available and a PR already exists: write the description to a temp file the same way, then run `gh pr edit --body-file <tmpfile>` exactly as single-repo mode Step 5 does.
   - If `gh` is unavailable: same expected fallback as single-repo mode — print this worktree's description plainly for manual use and say why (no `gh`). This is not an error.
   - Report each PR's URL (or fallback notice) back to the user as soon as it completes; delete each temp file right after use.

Never run `git merge <target>` for real as a final merge into `<target>` anywhere in this mode, and never run `gh pr merge` — batch mode only creates/updates PR bodies; a human merges on GitHub (README.md line 12's "duyệt trước khi merge/deploy/production" principle).
```

- [ ] **Step 5: Append batch-mode Hard rules to the end of the existing `## Hard rules` list**

```markdown
- (Batch mode) Never process worktrees in parallel — one at a time, sequentially, so one worktree's conflict resolution and verify never race another's.
- (Batch mode) Never skip dispatching the full `verifier` subagent after an Agent-resolved conflict — a resolved conflict is not safe to generate a PR from until verify PASSes.
- (Batch mode) Never let one worktree's FAILED status block, skip, or abort processing of the remaining worktrees.
- (Batch mode) Never present more than one `AskUserQuestion` gate for the batch as a whole before publishing — "Review each individually" is the only path that reintroduces per-worktree gates, and those reuse the existing single-repo gate verbatim rather than inventing a new one.
- (Batch mode) Never run `git merge <target>` or `gh pr merge` as a real final merge in any worktree — this mode only creates/updates PR bodies, never merges.
- (Batch mode) Reuse, never reimplement: the `<target>` ref-format validation (identical rule to `<base>`), the Write-tool temp-file rule, the no-gh/no-open-PR fallback, and the three-section diff/template generation logic — all defined once above in single-repo mode.
- (Batch mode) Never use `git merge --abort` after the merge has already produced a commit — it fails silently ("no merge to abort") and leaves the bad commit in place. Once committed (conflict-resolved or clean auto-merge), use `git reset --hard ORIG_HEAD` to actually undo it. `git merge --abort` is only valid for an in-progress, uncommitted conflict.
- (Batch mode) Never skip `verifier` on a clean (no-conflict) auto-merge — a clean merge can still break the build; both the conflict path and the clean-merge path are verify-gated before READY.
- (Batch mode) Never attempt a merge on a dirty or detached-HEAD worktree — check `git status --porcelain` and `git symbolic-ref -q HEAD` first; mark FAILED and skip instead.
- (Batch mode) Never pass the `gh pr create` title as raw, unsanitized text — strip anything outside a safe printable set before it goes on the command line, same injection concern as the body text.
- (Batch mode) Never exclude the main worktree from `git worktree list` by path-string comparison — use its fixed first-row position instead.
```

- [ ] **Step 6: Commit**

```bash
cd "D:/Github/MinhTQ-SDLC/.claude/worktrees/agent-a83ea87dabd36223d" && git add commands/pr-description.md && git commit -m "feat: add /pr-description --batch mode (sequential multi-worktree PR creation, verify-gated conflict resolution)"
```

**Post-review fixes applied (2026-08-22, commit `bcb1e83` in the feature worktree):** smoke testing and adversarial review surfaced 7 findings, all patched — the `git merge --abort`-after-commit bug (now `git reset --hard ORIG_HEAD`), missing `verifier` gate on the clean-merge path, unhandled dirty/detached-HEAD worktrees, fragile path-equality main-worktree exclusion (now positional), unsanitized `gh pr create --title` (shell-injection class, now sanitized), unhandled incomplete-Agent-resolution case, and ambiguous title-derivation wording. This section already reflects the patched behavior.

---

## Self-Review Notes (Tasks 1-2)

- **Spec coverage:** README Mục 3 `/pr-description` (diff→description→template→publish-or-print, no auto-merge) → Orchestration steps 1-5 + Hard rules. Overlap table ("Độc lập | Việc 1-shot, không loop/retry") → explicit absence of any flow-* skill invocation, confirmed by Step 3's naming scan.
- **Intentional deviation from siblings:** no `--jira`/`--file`/bare-text input adapter — Arguments section says so explicitly, per the approved design.
- **No repo precedent for `gh` CLI wording** — this file is the first place it's defined; exact commands (`gh --version`, `gh pr view`, `gh pr edit --body-file`) spelled out inline, no assumed wrapper.
- **Risk resolved:** `--body-file` used instead of inline `--body` to avoid multi-line/quoting issues flagged by the planner survey.
- **Placeholder scan:** literal, complete command content; no TBD.

---

## PR-Description Batch Mode Plan (added 2026-08-22)

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

### Task 3: Update front matter + Arguments section (added 2026-08-22)

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

### Task 4: Insert the "Batch Orchestration" section (added 2026-08-22)

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

### Task 5: Append batch-mode Hard rules (added 2026-08-22)

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

### Task 6: Sync `docs/flow/plans/pr-plan.md` in the main repo (added 2026-08-22)

**Files:**
- Modify: `docs/flow/plans/pr-plan.md`

**Interfaces:** none (doc-only) — this file currently only documents single-repo mode; this repo's established convention (per recent commits) is keeping `docs/flow/plans/*.md` in sync with what's actually shipped in the command file.

- [ ] **Step 1: Append a "Task 2: Batch mode" section**

Mirror this plan's Task 1-3 content (the exact new/modified text blocks above) into that file as its own `### Task 2` section, so the plan doc stays the authoritative source matching the command file, consistent with how `flow-batch-plan.md` was marked superseded/updated in place for its own redesign.

- [ ] **Step 2: Commit**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add docs/flow/plans/pr-plan.md && git commit -m "docs: sync pr-description plan with --batch mode addition"
```

---

## Self-Review Notes (Tasks 3-6)

- **Spec coverage:** approved design's 5 orchestration points map to Task 2's Steps 0-5 exactly. "One approval gate for the whole batch" → Step 4. "Never real merge" → closing paragraph + Task 3 Hard rules. "Reuse not reimplement" → explicit callouts throughout Task 2 + a dedicated Hard rule.
- **Placeholder scan:** all inserted text is literal and complete; no TBD.
- **Type/name consistency:** `verifier` matches `agents/verifier.md`'s identity exactly; `Agent` tool usage matches the tool's actual documented parameters (no `isolation` needed here, since the worktree already exists — a deliberate deviation from `/flow-batch`'s pattern, called out explicitly per the planner survey's risk #3).
- **Risk carried over from survey:** this edits the worktree copy of `commands/pr-description.md` directly (not yet merged to main) — consistent with how the rest of this session's post-review patches (findings fixes) were applied directly to each feature's own worktree before merge.

---

## PR Real-Merge Plan (added 2026-08-22)

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

### Task 7: Insert single-repo mode Step 6 (added 2026-08-22)

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

### Task 8: Amend the stale batch-mode "never merges" sentence (added 2026-08-22)

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

### Task 9: Insert batch mode Step 6 + Step 7 (added 2026-08-22)

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

### Task 10: Update `## Hard rules` (added 2026-08-22)

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

## Self-Review Notes (Tasks 7-10)

- **Spec coverage:** every clause of the approved design (single-repo Step 6, batch Step 6+7, resync reuse, dirty-check, push-gate separation, no-squash-default) maps to a task above.
- **Placeholder scan:** all inserted text is literal and complete; no TBD.
- **Consistency:** Task 5 Step 5's grep explicitly re-scans for stale "never merge" absolutes left over from before this change — a real risk the planner survey flagged (risk #1), addressed by Tasks 2 and 4 together.
- **No duplication:** batch Step 6c explicitly reuses Step 2c's dispatch pattern "by reference" (naming it, not re-writing a second copy of the Agent/verifier prompt text) — matches the approved design's explicit "reuse, do not duplicate" instruction.

---

## PR Combined Gate Plan (added 2026-08-22)

**Goal:** ask "chỉ PR / PR rồi merge / merge thẳng bỏ qua PR" as ONE clear upfront choice, right after description approval — instead of a late separate merge gate discovered only after PR is already published.

**Approved design:** keep the existing description-approval gate (Step 4 in both modes) exactly as-is. Insert a new gate immediately after "Approve"/"Approve all" is chosen, with exactly 4 options (`AskUserQuestion`'s option limit): "Chỉ tạo/update PR" / "Tạo PR rồi merge luôn" / "Merge thẳng, bỏ qua PR" / "Cancel". Branch orchestration on this choice — publish only, publish+merge, merge-only (skip publish), or stop. Remove the old separate late merge gate (Orchestration Step 6's own question, Batch Step 6's own question) since it's now folded into this earlier combined choice — keep all the merge *mechanics* (dirty check, gh/local merge, conflict handling, resync, push sub-ask) unchanged, just triggered earlier.

**Spec:** `commands/pr.md` (main repo, direct edit).

## Global Constraints

- `AskUserQuestion` allows at most 4 explicit options — the new combined gate uses exactly 4, and it stays a **separate** question from Step 4's description gate (not merged into it, since Step 4 already has 3 options of its own: Approve as-is/Edit/Cancel or Approve all/Review individually/Cancel).
- Never lose the ability to cleanly stop — "Cancel" stays an explicit option on the new gate.
- Merge mechanics (dirty check, gh vs local merge, conflict-abort-and-report, resync-on-non-fast-forward, push sub-ask) are unchanged in substance — only when they're triggered changes.
- Push stays its own separate ask, never implied by the new combined choice.

---

### Task 11: Single-repo mode — insert combined gate, remove old late merge gate (added 2026-08-22)

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

### Task 12: Batch mode — insert combined gate, remove old late merge gate (added 2026-08-22)

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

### Task 13: Update `## Hard rules` to match the new step numbers and combined-gate wording (added 2026-08-22)

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

### Task 14: Re-run against the 6 existing worktrees with the new combined gate (added 2026-08-22)

**Files:** none — this is a live re-run of the already-updated command, not a code change.

- [ ] **Step 1: Run the new combined-gate flow for the 6 worktrees**

For each of `jira-sync`, `fix-feature`, `migration-safe`, `playwright-test`, `scaffold`, `optimize` (branches already merged with `main` and verified PASS from the prior session): re-enter batch mode manually — since `gh` has no `auth` yet, choose the **"Merge thẳng cho N worktree, bỏ qua PR"** path at the new Step 5 gate (matches current real capability: no `gh` auth means no PR could be created anyway) — proceed straight to Step 7's merge loop for all 6.

Expected: same outcome as the actual capability already smoke-tested in Task 9 above (sequential merge into `main`, resync-on-non-fast-forward reusing Step 2c's Agent+verifier pattern) — this time exercised through the new combined-gate entry point instead of the old two-gate flow.

---

## Self-Review Notes (Tasks 11-14)

- **Spec coverage:** the approved design's every clause (single upfront 4-option gate, remove old late gates, keep merge mechanics unchanged, push stays separate) maps to Task 1 (single-repo) and Task 2 (batch) exactly.
- **Option-count constraint resolved:** kept Step 4 (description review) and the new action-choice gate as two separate questions, rather than cramming 5+ options into one — this is why the design's original "fold into Step 4" idea was adjusted to "a new Step 5 immediately following Step 4's approval," while still being asked upfront/early exactly as the user wanted, before any publish or merge action happens.
- **Placeholder scan:** all inserted/replaced text is literal and complete; no TBD.
- **Renumbering discipline:** Task 3 explicitly re-scans Hard rules for stale step-number references — the single most likely place for this restructure to leave a dangling/wrong pointer.
