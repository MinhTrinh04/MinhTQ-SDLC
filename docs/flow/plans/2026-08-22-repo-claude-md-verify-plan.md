# Repo CLAUDE.md Verify Command Implementation Plan

**Goal:** create `CLAUDE.md` at repo root documenting a real, deterministic test command so `agents/verifier.md` can actually `PASS` for this repo (a config/markdown repo with no traditional test suite), instead of always `FAIL`ing for lack of documentation. Then re-run `/pr --batch --target main` against the 6 existing worktrees now that a real verify path exists.

**Approved design:** the "test" is two real checks combined into one command — (1) no placeholder text in `commands/*.md`, `skills/*/SKILL.md`, `agents/*.md`; (2) junction-mirrored folders (`agents/`, `commands/`, `skills/`) match their `~/.claude/` copies exactly.

---

### Task 1: Create `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a documented `## Test` command that `agents/verifier.md` (Step 1: "Read the target project's `CLAUDE.md`...") will discover and run.

- [ ] **Step 1: Write the file**

```markdown
# CLAUDE.md

This repo has no application source code — it's a Claude Code global config repo (spec docs, `agents/`, `commands/`, `skills/` for the `/flow` family, junction-linked into `~/.claude/`). "Test" here means: no placeholder text slipped into any shipped prompt file, and the junctions into `~/.claude/` are actually in sync with this repo (not broken/stale).

## Test

Run:
```
bash -c 'fail=0; grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && fail=1; for d in agents commands skills; do diff -rq "$d" "$HOME/.claude/$d" || fail=1; done; if [ "$fail" = 1 ]; then echo FAIL; exit 1; else echo PASS; fi'
```

Expected on a healthy repo: `PASS`, exit code 0.
- The `grep` finds any leftover placeholder wording in the three shipped-prompt directories (docs/plans are excluded on purpose — those may legitimately discuss what a placeholder looks like, as this very file does).
- The `diff -rq` loop confirms `~/.claude/agents`, `~/.claude/commands`, `~/.claude/skills` are junctions actually pointing at this repo's `agents/`, `commands/`, `skills/` and staying in sync — if they diverge (junction broken, stale copy, manual edit only on one side), this fails.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "CLAUDE.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Run the documented command manually to confirm it actually works (before trusting verifier with it)**

Run the exact command from Step 1 in the repo root.
Expected: `PASS`, exit 0 — since junctions are correctly set up (confirmed earlier this session) and no shipped file currently has placeholder text (confirmed in every prior per-command scan).

- [ ] **Step 4: Dispatch `verifier` against this repo to confirm it discovers and runs this command correctly**

Invoke the `verifier` subagent on `d:/Github/MinhTQ-SDLC`.
Expected: `Overall: PASS`, with the exact command from Step 1 shown as what it ran — not a guessed command, not a repeat of the old "nothing documented" report.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md && git commit -m "feat: add repo CLAUDE.md with real placeholder+junction-sync verify command"
```

---

### Task 2: Re-run `/pr --batch --target main` against the 6 existing worktrees

**Files:** none created/modified — this is a re-run of the already-shipped `/pr` command's batch mode, now that Task 1 gives `verifier` something real to check.

**Interfaces:** consumes `commands/pr.md`'s batch orchestration exactly as already built, `agents/verifier.md` (fixed), `Agent` tool for conflict resolution if any.

- [ ] **Step 1: Run `/pr --batch --target main`**

For each of the 6 worktrees (`agent-a18a2c4b3cdf342dc` jira-sync, `agent-a43ca854053face9d` fix-feature, `agent-a5702c5dcf5bac222` migration-safe, `agent-a603376ca6020264f` playwright-test, `agent-a611fe0e31a0df5e2` scaffold, `agent-acf5f6d415e134716` optimize): merge `main`, dispatch `verifier` (now expected to `PASS` since CLAUDE.md exists and each worktree's own copy of `agents/`/`commands`/`skills`/`CLAUDE.md` will match after the merge brings `main`'s new `CLAUDE.md` in).

Expected: all 6 merge cleanly (no conflicts — Task 1 only touches `CLAUDE.md`, a new file, and none of the 6 branches touch it), all 6 `verifier` PASS, all 6 marked READY.

- [ ] **Step 2: Present the aggregate gate and publish**

Follow the command's own Batch Orchestration Step 4-5 exactly: one `AskUserQuestion` for the whole batch, then `gh pr create`/`gh pr edit` per approved worktree (or the no-`gh` fallback if `gh` isn't installed/authenticated — print each description for manual use instead).

---

## Self-Review Notes

- **Spec coverage:** the two checks map exactly to the approved design's two clauses. Re-run of `/pr --batch` is Task 2, using the already-shipped command unchanged.
- **Placeholder scan:** the CLAUDE.md content itself is excluded from its own scan scope (docs/root files aren't in `commands/*.md`/`skills/*/SKILL.md`/`agents/*.md`) — intentional, since this file legitimately discusses placeholder detection.
- **No guessing:** the command is fully deterministic and explicit, matching `verifier.md`'s "never guess a command" rule — it's *documented*, not inferred.
