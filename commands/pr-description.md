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
