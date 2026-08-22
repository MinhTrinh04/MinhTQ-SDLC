# PR-Description Command Implementation Plan

**Goal:** `commands/pr-description.md` — 1-shot, no-loop, fully independent command: reads real git diff/log, generates a PR description, gates human approval, optionally publishes via `gh pr edit` with a graceful manual-fallback path.

**Approved design:** no `--jira`/`--file`/text input adapter (reads git state, not an external requirement) — optional base-branch argument, default `main`. No flow-brainstorm/flow-plan/flow-execute involvement at all. Never auto-merge, never push, never commit.

---

### Task 1: Create `commands/pr-description.md`

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

### Task 2: Batch mode (`--batch --target <branch>`)

**Goal:** extend `commands/pr-description.md` with `--batch --target <branch>` — process every git worktree sequentially, auto-resolve merge conflicts (verify-gated), then gate the whole batch behind ONE approval before creating/updating PRs. See [2026-08-22-pr-description-batch-mode-plan.md](2026-08-22-pr-description-batch-mode-plan.md) for the full implementation plan this section mirrors.

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

- [ ] **Step 5: Append batch-mode Hard rules to the end of the existing `## Hard rules` list**

```markdown
- (Batch mode) Never process worktrees in parallel — one at a time, sequentially, so one worktree's conflict resolution and verify never race another's.
- (Batch mode) Never skip dispatching the full `verifier` subagent after an Agent-resolved conflict — a resolved conflict is not safe to generate a PR from until verify PASSes.
- (Batch mode) Never let one worktree's FAILED status block, skip, or abort processing of the remaining worktrees.
- (Batch mode) Never present more than one `AskUserQuestion` gate for the batch as a whole before publishing — "Review each individually" is the only path that reintroduces per-worktree gates, and those reuse the existing single-repo gate verbatim rather than inventing a new one.
- (Batch mode) Never run `git merge <target>` or `gh pr merge` as a real final merge in any worktree — this mode only creates/updates PR bodies, never merges.
- (Batch mode) Reuse, never reimplement: the `<target>` ref-format validation (identical rule to `<base>`), the Write-tool temp-file rule, the no-gh/no-open-PR fallback, and the three-section diff/template generation logic — all defined once above in single-repo mode.
```

- [ ] **Step 6: Commit**

```bash
cd "D:/Github/MinhTQ-SDLC/.claude/worktrees/agent-a83ea87dabd36223d" && git add commands/pr-description.md && git commit -m "feat: add /pr-description --batch mode (sequential multi-worktree PR creation, verify-gated conflict resolution)"
```

**Known issue found during smoke testing (2026-08-22):** the Batch Orchestration Step 2b text instructs the Agent to complete the merge (`git commit`) *before* verify runs, but then instructs `git merge --abort` on verifier FAIL. Once a merge is committed, `MERGE_HEAD` no longer exists and `git merge --abort` fails with `fatal: There is no merge to abort`. The correct recovery command is `git reset --hard ORIG_HEAD` (git sets `ORIG_HEAD` to the pre-merge commit on a successful merge commit). `commands/pr-description.md`'s Batch Orchestration point 2b still says `git merge --abort`; this needs a follow-up fix.

---

## Self-Review Notes

- **Spec coverage:** README Mục 3 `/pr-description` (diff→description→template→publish-or-print, no auto-merge) → Orchestration steps 1-5 + Hard rules. Overlap table ("Độc lập | Việc 1-shot, không loop/retry") → explicit absence of any flow-* skill invocation, confirmed by Step 3's naming scan.
- **Intentional deviation from siblings:** no `--jira`/`--file`/bare-text input adapter — Arguments section says so explicitly, per the approved design.
- **No repo precedent for `gh` CLI wording** — this file is the first place it's defined; exact commands (`gh --version`, `gh pr view`, `gh pr edit --body-file`) spelled out inline, no assumed wrapper.
- **Risk resolved:** `--body-file` used instead of inline `--body` to avoid multi-line/quoting issues flagged by the planner survey.
- **Placeholder scan:** literal, complete command content; no TBD.
