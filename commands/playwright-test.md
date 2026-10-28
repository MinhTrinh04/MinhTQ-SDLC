---
description: Fast UI test loop — writes (or reuses) a Playwright test for a described user flow, runs it, and hands off to flow-execute for the fix/rerun loop. No brainstorm/plan stage, no approval gate. Verify is the Playwright test's exit code + report only, never Claude's own opinion of the UI.
---

# /playwright-test

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + acceptance criteria) as the user-flow description. If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the flow. (Kept for consistency with `/flow`/`/fix-feature`/`/optimize`'s input adapter, even though README's own `/playwright-test` section only describes a bare feature/flow name — this is a design choice for consistency, not a silent assumption.)
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the user-flow description.

No other input form is supported — do not guess the source from the argument's shape.

The content here is a **user-flow description** (what a user does in the UI, step by step, and what should happen), not a feature spec or bug report — do not route it through `flow-brainstorm` or `flow-plan`.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized flow block: `{source, content, origin_link}`.
2. Check whether Playwright is actually installed/configured in the target repo: look for a Playwright config file (`playwright.config.ts`/`.js`/`.mjs`/`.mts`/`.cjs`, at the repo root or a workspace/package root if this is a monorepo) and a `@playwright/test` (or `playwright`) dependency in the relevant `package.json` (root, or the workspace package's own, honoring a hoisted root dependency).
   - If found: continue to Step 3.
   - If neither can be found after checking both root and workspace level: **STOP and ask via `AskUserQuestion`** — "Playwright chưa được cài trong repo này. Bạn muốn làm gì?":
     - "Cài Playwright giúp tôi (`npm init playwright@latest`)" (recommended)
     - "Để tôi tự cài — dừng lệnh ở đây"
     - "Cancel"
     - **"Để tôi tự cài" or "Cancel":** stop here, do not install anything.
     - **"Cài Playwright giúp tôi":**
       1. Determine install location: single-package repo → repo root. Monorepo → find the frontend workspace by checking each workspace `package.json` for a `react`/`vue`/`@angular/core`/`svelte`/`next`/`vite` dependency; if exactly one matches, install there. If zero or more than one match (genuinely ambiguous), **STOP and ask via `AskUserQuestion`** which workspace path to install into — never guess.
       2. Run `npm init playwright@latest -- --yes` (non-interactive) in that directory via Bash, capturing full output. This scaffolds `playwright.config.*`, an example test, and adds the dependency.
       3. Re-check for the config file + dependency (same check as above). If still missing, **STOP and report the exact install output** — do not retry, do not fall back to a manual `npm i -D @playwright/test && npx playwright install` substitution without telling the user why the first attempt failed.
       4. On success, state plainly what was installed and where, then continue to Step 3.
3. Search the target repo for an existing Playwright test covering this flow (via Glob over the project's test directory — e.g. `tests/**/*.spec.ts`, `e2e/**/*.spec.ts`, or wherever `playwright.config.*` points its `testDir` at) before writing a new one, to avoid a duplicate test for the same flow.
4. Do **not** invoke `flow-brainstorm` or `flow-plan` — this command has no human approval gate. Synthesize a minimal implementation plan inline:
   - Task 1: if Step 3 found no existing test for this flow, write one derived from the user-flow description (concrete steps → Playwright actions/assertions, following the target repo's existing test file conventions if any exist, otherwise the framework's own conventions). Derive the new test file's name using the same sanitization rule as the plan-file `<slug>` in Step 5 below (lowercase, strip/replace anything outside `a-z0-9-`) before it is ever interpolated into a shell command — never build a filename or shell argument directly from raw, untrusted flow-description text. If an existing test already covers this flow, skip straight to Task 2 and say so plainly in the plan.
   - Task 2: run the Playwright test (the project's documented Playwright run command — check `CLAUDE.md` first; if undocumented, STOP and ask the user via `AskUserQuestion` for the exact run command — never guess one, matching the "never guess a command" rule already established for `verifier`/`/optimize`).
5. Write this synthesized plan to `docs/flow/plans/YYYY-MM-DD-playwright-<slug>-plan.md`, where `<slug>` is derived from the first few words of the flow description, lowercased, with every character other than `a-z`, `0-9`, and `-` stripped or replaced with `-` (collapse repeats). If this produces an empty or all-hyphen slug (e.g. the description was empty, emoji-only, or non-Latin script with nothing left after stripping), fall back to `untitled` plus a short disambiguating suffix derived from the description's length and first raw byte value — never pass raw flow-description text into a file path unsanitized, and never leave the slug empty. Before writing, check whether that exact path already exists; if it does (e.g. two flows on the same day reduce to the same slug), append `-2`, `-3`, etc. until the path is free — never silently overwrite a prior run's record-keeping plan file. Record-keeping only: no `planner` subagent dispatch, no `AskUserQuestion` approval wait for this step. State plainly in the file itself that it was auto-synthesized by `/playwright-test`, not reviewed like a `flow-plan` output.
6. Invoke the `flow-execute` skill directly with that plan file's path. `flow-execute` handles the ≤3-round verify retry loop (via the `verifier` subagent, which already has a Playwright MCP branch for frontend/UI changes) and the mandatory `reviewer` subagent — do not reimplement retry logic here, and do not add a separate screenshot/trace-reading step of your own outside that loop.
7. Print `flow-execute`'s final report verbatim to the user — do not summarize away a FAIL into something softer, and do not append your own subjective read of whether the UI "looks right." The Playwright test's exit code and report from `verifier` are the only verdict that counts.

## Hard rules

- Never invoke `flow-brainstorm` or `flow-plan` from this command — there is no approval gate, by design, unlike `/flow` and `/delegate`.
- Never install Playwright without the human explicitly picking that option via `AskUserQuestion` first — no silent install.
- Never guess which workspace is the frontend one in a monorepo when more than one (or none) has a recognizable frontend dependency — ask instead.
- Never substitute a different install command or retry after a failed `npm init playwright@latest` — report the exact failure and stop.
- Never write a duplicate Playwright test for a flow that already has one — always Glob for an existing test first.
- Never guess the Playwright run command if it's undocumented — always ask via `AskUserQuestion`.
- Never interpolate a filename or shell argument derived from raw flow-description text without sanitizing it first (same rule as the plan-file slug).
- Never overwrite an existing record-keeping plan file — check for a path collision and disambiguate first.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never skip writing the record-keeping plan file, even though there is no approval wait on it.
- Never substitute your own opinion of the UI's appearance/behavior for the Playwright test's actual pass/fail result — verify is the exit code + report only.
- Never let `flow-execute` skip its own verify/review loop — this command relies on it entirely for the "max 3 lần lặp" requirement; do not add a second retry loop here.
