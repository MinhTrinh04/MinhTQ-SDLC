# Playwright-Test Command Implementation Plan

**Goal:** `commands/playwright-test.md` — fast UI test loop (no brainstorm/plan stage, no approval gate), matching README Mục 3's `/playwright-test` spec and the overlap table's "= nhánh Playwright của `verifier` + retry loop của `flow-execute`, không cần brainstorm/plan" ruling.

**Approved design:** input adapter same shape as `/flow`/`/optimize` (keeps `--jira` for consistency with siblings, flagged explicitly since README's own spec doesn't mention it); checks Playwright is actually installed/configured before doing anything (stop, don't install, if missing); Globs for an existing test covering the flow before writing a new one; synthesizes a minimal plan inline (same no-gate pattern as `/fix-feature`, adapted: "no test runner" fallback becomes "Playwright missing → stop" since Playwright itself is the test runner here); hands off to `flow-execute` (which already has the Playwright branch inside `verifier`'s retry loop, ≤3 rounds, mandatory `reviewer`).

---

### Task 1: Create `commands/playwright-test.md`

**Files:**
- Create: `commands/playwright-test.md`

**Interfaces:**
- Consumes: `flow-execute` skill (exact name `flow-execute`), invoked with a self-synthesized plan file path — bypassing `flow-brainstorm`/`flow-plan` entirely, same pattern as `/fix-feature`/`/optimize`. Transitively relies on `flow-execute`'s dispatch of the `verifier` subagent (Playwright MCP branch already built) and the mandatory `reviewer` subagent.
- Produces: the `/playwright-test` slash command.

- [ ] **Step 1: Write the command file**

```markdown
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
2. Check whether Playwright is actually installed/configured in the target repo: look for a `playwright.config.ts`/`.js` file and a `@playwright/test` (or `playwright`) dependency in `package.json`. If either is missing, **say so plainly and STOP** — do not install, configure, or scaffold Playwright yourself; setting up test infrastructure is out of scope for this command.
3. Search the target repo for an existing Playwright test covering this flow (via Glob over the project's test directory — e.g. `tests/**/*.spec.ts`, `e2e/**/*.spec.ts`, or wherever `playwright.config.*` points its `testDir` at) before writing a new one, to avoid a duplicate test for the same flow.
4. Do **not** invoke `flow-brainstorm` or `flow-plan` — this command has no human approval gate. Synthesize a minimal implementation plan inline:
   - Task 1: if Step 3 found no existing test for this flow, write one derived from the user-flow description (concrete steps → Playwright actions/assertions, following the target repo's existing test file conventions if any exist, otherwise the framework's own conventions). If an existing test already covers this flow, skip straight to Task 2 and say so plainly in the plan.
   - Task 2: run the Playwright test (the project's documented Playwright run command — check `CLAUDE.md` first; if undocumented, use `npx playwright test <file>` scoped to just the new/target test file, never the whole suite).
5. Write this synthesized plan to `docs/flow/plans/YYYY-MM-DD-playwright-<slug>-plan.md`, where `<slug>` is derived from the first few words of the flow description, lowercased, with every character other than `a-z`, `0-9`, and `-` stripped or replaced with `-` (collapse repeats) — never pass raw flow-description text into a file path unsanitized. Record-keeping only: no `planner` subagent dispatch, no `AskUserQuestion` approval wait. State plainly in the file itself that it was auto-synthesized by `/playwright-test`, not reviewed like a `flow-plan` output.
6. Invoke the `flow-execute` skill directly with that plan file's path. `flow-execute` handles the ≤3-round verify retry loop (via the `verifier` subagent, which already has a Playwright MCP branch for frontend/UI changes) and the mandatory `reviewer` subagent — do not reimplement retry logic here, and do not add a separate screenshot/trace-reading step of your own outside that loop.
7. Print `flow-execute`'s final report verbatim to the user — do not summarize away a FAIL into something softer, and do not append your own subjective read of whether the UI "looks right." The Playwright test's exit code and report from `verifier` are the only verdict that counts.

## Hard rules

- Never invoke `flow-brainstorm` or `flow-plan` from this command — there is no approval gate, by design, unlike `/flow` and `/flow-batch`.
- Never install, initialize, or configure Playwright in the target repo if it's missing — stop and report the gap instead.
- Never write a duplicate Playwright test for a flow that already has one — always Glob for an existing test first.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never skip writing the record-keeping plan file, even though there is no approval wait on it.
- Never substitute your own opinion of the UI's appearance/behavior for the Playwright test's actual pass/fail result — verify is the exit code + report only.
- Never let `flow-execute` skip its own verify/review loop — this command relies on it entirely for the "max 3 lần lặp" requirement; do not add a second retry loop here.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "commands/playwright-test.md"` (relative to the repo/worktree executing this task)
Expected: file exists, size > 0.

- [ ] **Step 3: Placeholder + naming consistency scan**

Run: `grep -niE "TBD|todo:|fill in|placeholder" "commands/playwright-test.md"`
Expected: no matches. Confirm `flow-execute` matches the exact `name:` field in `skills/flow-execute/SKILL.md`.

- [ ] **Step 4: Smoke-test the missing-Playwright-config path**

```bash
mkdir -p /tmp/flow-scratch/pw-noconfig && cd /tmp/flow-scratch/pw-noconfig
git init -q
echo '{"name":"scratch"}' > package.json
git add -A && git commit -q -m "init, no playwright"
```

Invoke `/playwright-test` with bare text: `"User logs in with valid credentials and sees the dashboard"` against `/tmp/flow-scratch/pw-noconfig`.
Expected: command stops at Step 2 of Orchestration, states plainly Playwright isn't installed/configured, and does not attempt to run `npm install @playwright/test` or scaffold a config.

- [ ] **Step 5: Smoke-test the no-gate write-new-test path (Playwright present, no existing test for the flow)**

```bash
mkdir -p /tmp/flow-scratch/pw-repo/tests && cd /tmp/flow-scratch/pw-repo
git init -q
npm init -y -q
npm install -D @playwright/test -q
npx playwright install --with-deps chromium -q || true
cat > playwright.config.ts <<'EOF'
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests' });
EOF
git add -A && git commit -q -m "init playwright, no tests yet"
```

Invoke `/playwright-test` with bare text describing a simple flow against a static HTML page served locally.
Expected: transcript shows Glob search for existing tests (none found), no `flow-brainstorm`/`flow-plan` invocation, no `AskUserQuestion` approval prompt before `flow-execute` starts, a new `.spec.ts` file written under `tests/`, plan file written directly, then `flow-execute` runs immediately. Final report is `verifier`'s Playwright PASS/FAIL, not a prose UI opinion.

- [ ] **Step 6: Commit**

```bash
git add commands/playwright-test.md && git commit -m "feat: add /playwright-test command (no-gate UI test loop)"
```

---

## Self-Review Notes

- **Spec coverage:** README Mục 3 `/playwright-test` (write-test-if-missing, run, max 3 retries, exit-code-only verify) → Orchestration steps 2-7 + Hard rules. Overlap table's "= nhánh Playwright của verifier + retry loop của flow-execute, không cần brainstorm/plan" → Step 4's explicit non-invocation of `flow-brainstorm`/`flow-plan` + Step 6's direct `flow-execute` handoff.
- **`--jira` decision explicitly flagged inline** in the command's own Arguments section (not silently assumed) — mirrors the `/optimize` precedent of keeping it for input-adapter consistency across siblings.
- **Adapted, not copied, fallback:** unlike `/fix-feature`'s "no test runner → manual verification command" fallback, `/playwright-test`'s fallback is "Playwright missing → stop, don't install" — because Playwright IS the test runner here, there's no manual-verification substitute that makes sense; the correct behavior is refusal, not substitution.
- **Placeholder scan:** literal, complete command content; no TBD.
- **Type/name consistency:** `flow-execute` matches the flow-core plan's Task 6 exactly. Plan-file naming pattern matches `/fix-feature`'s and `/optimize`'s precedent exactly.
