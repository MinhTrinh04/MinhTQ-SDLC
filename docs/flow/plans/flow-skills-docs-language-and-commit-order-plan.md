# Flow Skills — Vietnamese Docs + Write-Before-Commit Implementation Plan

**Goal:** two changes to `skills/flow-plan/SKILL.md` and `skills/flow-brainstorm/SKILL.md`: (1) new plan/spec doc content is written in Vietnamese from now on (jargon stays English), (2) write the doc file, present it, get approval, THEN commit — never commit before approval.

**Approved design:** language rule applies only to `docs/flow/plans/*.md`/`docs/flow/specs/*.md` content going forward — never retroactive, never touching `commands/*.md`/`skills/*/SKILL.md` output. Commit ordering flips from write+commit-then-ask to write-then-ask-then-commit-only-on-Approve.

**Note on this plan document itself:** written in English, since the new Vietnamese rule only binds documents created *after* this change lands — this plan predates its own effect.

## Global Constraints

- Vietnamese rule scope: `docs/flow/plans/*.md` and `docs/flow/specs/*.md` content only. Never retroactive on existing English files. Never affects `commands/*.md`/`skills/*/SKILL.md` shipped-prompt content.
- Commit ordering: file is written to disk but never `git add`/`git commit`ed until the human selects "Approve." "Request changes" revises the uncommitted file and re-asks. "Reject" leaves the file uncommitted on disk (not deleted — the human may still want to see what was drafted, but it must never enter git history without approval).

---

### Task 1: Update `skills/flow-plan/SKILL.md`

**Files:**
- Modify: `skills/flow-plan/SKILL.md`

- [ ] **Step 1: Replace Process step 4 (file-naming + commit) to defer commit**

Old:
```
4. Before saving, check whether `docs/flow/plans/<feature>-plan.md` already exists for this feature/command (glob `docs/flow/plans/*<feature-slug>*plan.md` — match by feature/command name, not by date). 
   - If it already exists: append this plan as a new section at the end of that SAME file — `### Task N: <short title> (added YYYY-MM-DD)`, continuing the task numbering from where the file left off (never restart numbering, never duplicate an existing Task N). Do not create a new file, do not put the date in the filename.
   - If it does not exist yet: create `docs/flow/plans/<feature>-plan.md` (no date in the filename — the date lives in each Task's heading if it matters later). This is the only case that creates a new file.
   Commit either way.
```
New:
```
4. Write the plan doc content in **Vietnamese** (technical jargon — SOLID, API, REST, class/function names, code snippets, exact commands, file paths — stays in English/as-is; this is normal Vietnamese tech-writing code-switching, not a translation exercise). This Vietnamese rule applies only to plan doc *content* — it never applies to any `commands/*.md`/`skills/*/SKILL.md` file this plan describes creating elsewhere; those stay English, unchanged, following existing sibling conventions.

   Before saving, check whether `docs/flow/plans/<feature>-plan.md` already exists for this feature/command (glob `docs/flow/plans/*<feature-slug>*plan.md` — match by feature/command name, not by date).
   - If it already exists: append this plan as a new section at the end of that SAME file — `### Task N: <short title> (added YYYY-MM-DD)`, continuing the task numbering from where the file left off (never restart numbering, never duplicate an existing Task N). Do not create a new file, do not put the date in the filename. If that existing file is in English (predates this rule), still append the new section in Vietnamese — do not translate the rest of the file.
   - If it does not exist yet: create `docs/flow/plans/<feature>-plan.md` (no date in the filename — the date lives in each Task's heading if it matters later). This is the only case that creates a new file.
   - **Do not commit yet** — writing the file is a local, uncommitted change at this point. Commit only happens in Step 6, after approval.
```

- [ ] **Step 2: Replace Process step 6 (approval gate) to commit only after Approve**

Old:
```
6. **STOP and ask via `AskUserQuestion`.** Report the plan's path, then present the gate as an explicit choice, e.g.:
   - "Approve — proceed to flow-execute" (recommended)
   - "Request changes — describe what to adjust" (free text via the tool's built-in Other option)
   - "Reject — stop here"
   Never end the turn on a plain prose question expecting free-text "ok". Do not let `flow-execute` run until "Approve" is selected.
```
New:
```
6. Report the plan's path and print its content (or a clear pointer to read it) so the human can actually review it — the file is on disk but **not yet committed**. **STOP and ask via `AskUserQuestion`.** Present the gate as an explicit choice, e.g.:
   - "Approve — commit and proceed to flow-execute" (recommended)
   - "Request changes — describe what to adjust" (free text via the tool's built-in Other option)
   - "Reject — stop here"
   Never end the turn on a plain prose question expecting free-text "ok".
   - **"Approve":** only now run `git add`/`git commit` for the plan file. Then let `flow-execute` run.
   - **"Request changes":** revise the file content in place (still uncommitted — no commit exists yet to amend), re-print it, ask again. Repeat until Approve or Reject.
   - **"Reject":** stop here. Leave the file on disk, uncommitted — do not delete it (the human may still want to see the draft) and do not commit it under any circumstance.
```

- [ ] **Step 3: Update Hard rules**

Old:
```
- Never create a new dated plan file for a feature that already has one — append a new Task section to the existing `docs/flow/plans/<feature>-plan.md` instead. A new file is only for a feature with no existing plan doc at all.
- Never execute anything from the plan yourself — you only write it.
- Never accept the `planner` subagent's draft verbatim if it contains unfinished stand-in content or vague steps — tighten it before saving.
- The approval gate in Step 6 uses `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply.
```
New:
```
- Never create a new dated plan file for a feature that already has one — append a new Task section to the existing `docs/flow/plans/<feature>-plan.md` instead. A new file is only for a feature with no existing plan doc at all.
- Never execute anything from the plan yourself — you only write it.
- Never accept the `planner` subagent's draft verbatim if it contains unfinished stand-in content or vague steps — tighten it before saving.
- The approval gate in Step 6 uses `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply.
- Never commit the plan file before "Approve" is selected — write it, present it, ask, only then commit. A "Request changes" or "Reject" response must never result in a commit.
- Never write new plan doc content in English — Vietnamese prose with English technical jargon where natural, for any file created from this point forward. Never retroactively translate an existing English plan file when appending a new section to it.
```

- [ ] **Step 4: Verify**

Run: `bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'`
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add skills/flow-plan/SKILL.md && git commit -m "feat(flow-plan): new plan docs written in Vietnamese, commit only after approval (write-before-commit)"
```

---

### Task 2: Update `skills/flow-brainstorm/SKILL.md`

**Files:**
- Modify: `skills/flow-brainstorm/SKILL.md`

- [ ] **Step 1: Replace the architectural bullet in Process step 6 to defer commit + add Vietnamese rule**

Old:
```
   - Architectural: sectioned design. Check whether `docs/flow/specs/<topic>-design.md` already exists for this topic (glob by topic/feature name, not date). If it exists, append this design as a new dated section at the end of that SAME file instead of creating a new one. If it doesn't exist yet, create `docs/flow/specs/<topic>-design.md` (no date in the filename). Commit either way.
```
New:
```
   - Architectural: sectioned design, written in **Vietnamese** (technical jargon — SOLID, API, REST, class/function names, code snippets, exact commands, file paths — stays in English/as-is; this is code-switching, not translation). This rule applies only to spec doc *content* — never to any `commands/*.md`/`skills/*/SKILL.md` file the design describes creating elsewhere. Check whether `docs/flow/specs/<topic>-design.md` already exists for this topic (glob by topic/feature name, not date). If it exists, append this design as a new dated section at the end of that SAME file instead of creating a new one — even if the existing file is in English (predates this rule), append the new section in Vietnamese, do not translate the rest. If it doesn't exist yet, create `docs/flow/specs/<topic>-design.md` (no date in the filename). **Do not commit yet** — that only happens after Step 7's approval, below.
```

- [ ] **Step 2: Replace Process step 7 (approval gate) to commit only after Approve**

Old:
```
7. **STOP and ask via `AskUserQuestion`.** Never end the turn on a plain prose question waiting for free-text "ok". Present the approval gate as an explicit choice. The "Approve" option's label must name whatever the caller's actual next step is — do not hardcode "proceed to flow-plan": if the invoking command skips `flow-plan` (e.g. it synthesizes its own plan and hands off straight to `flow-execute`, as `/fix-feature`/`/optimize` do), say "Approve — proceed" or name that actual next step instead. Example for the normal `/flow` case:
   - "Approve — proceed to flow-plan" (recommended)
   - "Request changes — describe what to adjust" (free text via the tool's built-in Other option)
   - "Reject — stop here"
   Do not proceed until "Approve" is selected. This gate is never skipped, regardless of how small the change looks.
```
New:
```
7. For the architectural path, the spec file is on disk but **not yet committed** at this point — the human is reviewing what was just presented/printed, same content as the file. **STOP and ask via `AskUserQuestion`.** Never end the turn on a plain prose question waiting for free-text "ok". Present the approval gate as an explicit choice. The "Approve" option's label must name whatever the caller's actual next step is — do not hardcode "proceed to flow-plan": if the invoking command skips `flow-plan` (e.g. it synthesizes its own plan and hands off straight to `flow-execute`, as `/fix-feature`/`/optimize` do), say "Approve — proceed" or name that actual next step instead. Example for the normal `/flow` case:
   - "Approve — proceed to flow-plan" (recommended)
   - "Request changes — describe what to adjust" (free text via the tool's built-in Other option)
   - "Reject — stop here"
   Do not proceed until "Approve" is selected. This gate is never skipped, regardless of how small the change looks.
   - **"Approve" (architectural path only — Bounded/Spike never wrote a file to begin with):** only now run `git add`/`git commit` for the spec file.
   - **"Request changes" (architectural path):** revise the file content in place (still uncommitted), re-present, ask again.
   - **"Reject" (architectural path):** stop here. Leave the file on disk, uncommitted — do not delete it and do not commit it under any circumstance.
```

- [ ] **Step 3: Update Hard rules**

Old:
```
- Never create a new dated spec file for a topic that already has one — append a new dated section to the existing `docs/flow/specs/<topic>-design.md` instead.
- Never invoke `flow-plan` or `flow-execute` yourself from inside this skill — the `/flow` command orchestrates the handoff after seeing approval.
- Never treat "the requirement looks complete" as a reason to skip asking about ambiguity you actually found — if you found it, ask it.
- If mid-brainstorm you discover the work is bigger than the initial classification (hidden complexity), say so and re-classify — never downgrade, only upgrade.
- Every clarifying question in Step 4 and the approval gate in Step 7 use `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply, so the human always gets an explicit choice to click instead of having to type a full sentence back.
```
New:
```
- Never create a new dated spec file for a topic that already has one — append a new dated section to the existing `docs/flow/specs/<topic>-design.md` instead.
- Never invoke `flow-plan` or `flow-execute` yourself from inside this skill — the `/flow` command orchestrates the handoff after seeing approval.
- Never treat "the requirement looks complete" as a reason to skip asking about ambiguity you actually found — if you found it, ask it.
- If mid-brainstorm you discover the work is bigger than the initial classification (hidden complexity), say so and re-classify — never downgrade, only upgrade.
- Every clarifying question in Step 4 and the approval gate in Step 7 use `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply, so the human always gets an explicit choice to click instead of having to type a full sentence back.
- Never commit the architectural spec file before "Approve" is selected — write it, present it, ask, only then commit. A "Request changes" or "Reject" response must never result in a commit.
- Never write new spec doc content in English — Vietnamese prose with English technical jargon where natural, for any file created from this point forward. Never retroactively translate an existing English spec file when appending a new section to it.
```

- [ ] **Step 4: Verify**

Run the same repo test command. Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add skills/flow-brainstorm/SKILL.md && git commit -m "feat(flow-brainstorm): new spec docs written in Vietnamese, commit only after approval (write-before-commit)"
```

---

### Task 3: Regression-smoke-test both changes on a scratch repo

**Files:** none — live invocation trace, no code changes.

- [ ] **Step 1: Smoke-test flow-plan's write-before-commit + Vietnamese output**

On any scratch repo (reuse an existing one, or a fresh `git init`), invoke `flow-plan` with a trivial approved design. Expected: the plan file is written in Vietnamese prose (jargon in English), `git status` shows it as untracked/unstaged at the point the `AskUserQuestion` gate fires, and only after selecting "Approve" does `git log` show a new commit containing it. Choosing "Reject" on a second trial leaves the file present but `git status` still shows it uncommitted.

- [ ] **Step 2: Smoke-test flow-brainstorm's write-before-commit + Vietnamese output (architectural path)**

Same trace for an architectural-classified requirement — confirm the spec file under `docs/flow/specs/` follows the identical write→present→ask→commit-only-on-Approve sequence, in Vietnamese.

- [ ] **Step 3: Regression-check bounded/spike paths are unaffected**

Confirm a Bounded or Spike classification (which never wrote a file to begin with, per the existing design) is completely unaffected by this change — the design is presented in chat as before, no new file-write/commit behavior introduced where none existed.

---

## Self-Review Notes

- **Spec coverage:** both approved-design points map exactly to Task 1 (flow-plan) and Task 2 (flow-brainstorm), each split into the same two edits (defer commit at write-time, commit-on-Approve-only at the gate) plus matching Hard rules.
- **Scope discipline:** every edit explicitly states the Vietnamese rule is content-only and does not touch `commands/*.md`/`skills/*/SKILL.md` output — this is called out three separate times (Task 1 Step 1, Task 2 Step 1, Global Constraints) to prevent future drift/misreading.
- **This plan document's own language:** written in English deliberately — see the note under Goal. The rule it implements only binds documents created after this plan is executed.
- **Placeholder scan:** literal, complete instructional content; no TBD.
