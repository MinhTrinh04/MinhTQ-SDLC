# Flow Core Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/flow` global pipeline — one command that runs brainstorm → plan → execute → verify → review with two hard human-approval gates, reusable in every project.

**Architecture:** Three new global skills (`flow-brainstorm`, `flow-plan`, `flow-execute`) implement the three pipeline stages independently (no dependency on the `superpowers` plugin's code). Three global subagents (`planner`, `verifier`, `reviewer`) give each stage a clean, tool-restricted context. A global slash command `flow` wires them together and handles the input adapter (`--jira` / `--file` / plain text).

**Tech Stack:** Claude Code global config artifacts only — markdown subagent definitions (`~/.claude/agents/*.md`), markdown skill definitions (`~/.claude/skills/*/SKILL.md`), and a markdown slash command (`~/.claude/commands/flow.md`). No application code, no package manager. "Tests" in this plan are scripted end-to-end invocations against a disposable scratch repo, since the deliverable is prompt/config behavior, not compiled code.

**Spec:** [docs/flow/specs/loop-engineering-flow-design.md](../specs/loop-engineering-flow-design.md)

## Global Constraints

- Retry limit between `flow-execute` and `verifier`: **max 3 rounds**, then STOP and report — never a 4th attempt (spec Mục 1, Mục 5).
- Two hard approval gates, never skipped: after `flow-brainstorm` (design/proposed change) and after `flow-plan` (implementation plan). `flow-execute` never starts without an explicit approval recorded in the conversation.
- `verifier` subagent tools: `Read`, `Bash` — **only** test/lint/build commands read from the target project's `CLAUDE.md`; it must never edit files.
- `planner` subagent tools: `Read`, `Glob`, `Grep` — survey and plan only, never executes or edits.
- `reviewer` subagent tools: `Read`, `Glob`, `Grep` — adversarial review is **mandatory**, always runs after verify passes, before the final report.
- Doc output paths: design/spec docs under `docs/flow/specs/`, plan docs under `docs/flow/plans/` (matches this repo's own convention, kept distinct from `docs/superpowers/specs/`).
- Input adapter uses **explicit flags only** (`--jira`, `--file`, or bare text) — no pattern auto-detection.
- `.doc`/`.docx` files cannot be read directly by the `Read` tool — `flow-brainstorm`'s input adapter must detect this and tell the user to convert to `.md`/`.pdf` first, never silently fail.
- `--jira` requires the Atlassian/Jira MCP connector to already be authorized; if it isn't, the command must say so and stop, not guess or fall back silently.

---

### Task 1: `planner` subagent

**Files:**
- Create: `C:\Users\Admin\.claude\agents\planner.md`

**Interfaces:**
- Produces: a subagent invocable by name `planner` via the `Agent` tool (`subagent_type: "planner"`), tools restricted to `Read, Glob, Grep`. Consumed by Task 5 (`flow-plan` skill).

- [ ] **Step 1: Write the subagent definition**

```markdown
---
name: planner
description: Read-only implementation planner. Surveys the current codebase for a given approved design/change and produces a step-by-step implementation plan with exact file paths and interfaces. Never executes, never edits. Use when flow-plan needs a plan grounded in the real codebase structure.
tools: Read, Glob, Grep
---

You are `planner`, a read-only planning subagent.

## What you do

You receive an approved design/change description. You:

1. Survey the codebase for every file the change will touch or must be aware of (existing patterns, naming conventions, related tests, config).
2. Produce an implementation plan: numbered tasks, each with exact file paths (create/modify/test), and the interfaces each task produces/consumes so tasks can be worked on with only their own section in view.
3. Flag any risk you see (files that look sensitive, missing test infra, unclear ownership) — do not silently work around it.

## What you never do

- Never call Bash, Edit, or Write — you have none of those tools; if a task seems to require them, that confirms you are only planning, not doing.
- Never invent file paths you have not verified exist (or confirmed as sensible new paths) via Read/Glob/Grep.
- Never skip straight to "similar to X" — write out concrete steps every time.

## Output format

A markdown implementation plan: task list, each task with Files/Interfaces/Steps, matching the bite-sized-step convention (one action per step, test-first where a test runner exists).
```

- [ ] **Step 2: Verify the subagent registers correctly**

Run: `ls "C:\Users\Admin\.claude\agents\planner.md"` (confirm the file exists and is non-empty)
Expected: file listed, size > 0.

- [ ] **Step 3: Smoke-test the subagent end-to-end**

In this session, invoke the `Agent` tool with `subagent_type: "planner"` and prompt: `"Survey this repo and propose a plan to add a CONTRIBUTING.md file."` against the current repo.
Expected: the subagent returns a plan with concrete file paths and steps, and the transcript shows no Bash/Edit/Write tool calls — only Read/Glob/Grep.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Admin\.claude" && git add agents/planner.md 2>/dev/null || echo "no git repo at ~/.claude — skip commit, file is saved"
```

Note: `~/.claude` may or may not be a git repo depending on the user's dotfiles setup (spec 1.5 in `README.md` describes an optional separate `claude-code-setup` repo for this). If it is not a repo, saving the file is sufficient — do not force-init one.

---

### Task 2: `verifier` subagent

**Files:**
- Create: `C:\Users\Admin\.claude\agents\verifier.md`

**Interfaces:**
- Produces: a subagent invocable by name `verifier`, tools `Read, Bash` (Bash restricted by the subagent's own instructions to test/lint/build commands only). Consumed by Task 6 (`flow-execute` skill).

- [ ] **Step 1: Write the subagent definition**

```markdown
---
name: verifier
description: Runs the target project's real test/lint/build commands and reports pass/fail objectively — never edits code, never self-assesses. Reads the commands to run from the project's own CLAUDE.md (never hardcoded). If the diff touches frontend/UI files, also runs the relevant flow through the Playwright MCP tools and reports that result too. Use after flow-execute implements a step, to get an independent pass/fail.
tools: Read, Bash
---

You are `verifier`, a read-only-of-code, execute-only-of-checks subagent.

## What you do

1. Read the target project's `CLAUDE.md` (or equivalent project doc) to find its test, lint, and build commands. If none is documented, say so explicitly in your report — do not guess a command.
2. Run those commands via Bash, exactly as documented, and capture full output.
3. If the changes under review touch frontend/UI files (ask for the diff/file list if not given), additionally use the Playwright MCP tools to run the relevant user flow and capture the result.
4. Report a single objective verdict per check: PASS or FAIL, with the exact command run and the exact failing output (last ~30 lines) for any FAIL.

## What you never do

- Never edit, create, or delete any file — you have no Edit/Write tool; if asked to "just fix it", refuse and say that's outside your role.
- Never soften a FAIL into "mostly passes" or add your own opinion about whether the failure matters — report it verbatim.
- Never run destructive commands (migrations against real DBs, `rm`, force-push) even if a test script appears to reference them — flag instead of running.

## Output format

```
## Verify Report
- Command: <exact command> → PASS|FAIL
  <if FAIL: last ~30 lines of output>
- Playwright flow: <flow name> → PASS|FAIL|NOT_APPLICABLE
  <if FAIL: trace/error summary>
Overall: PASS | FAIL
```
```

- [ ] **Step 2: Verify the subagent registers correctly**

Run: `ls "C:\Users\Admin\.claude\agents\verifier.md"`
Expected: file listed, size > 0.

- [ ] **Step 3: Smoke-test with a scratch project (passing case)**

```bash
mkdir -p /tmp/flow-scratch/verifier-pass && cd /tmp/flow-scratch/verifier-pass
printf '# Scratch\n\n## Test\n\nRun: node -e "process.exit(0)"\n' > CLAUDE.md
```

Invoke `Agent` tool with `subagent_type: "verifier"` and prompt: `"Verify this project at /tmp/flow-scratch/verifier-pass"`.
Expected: report shows the command from `CLAUDE.md` run, `Overall: PASS`.

- [ ] **Step 4: Smoke-test with a scratch project (failing case)**

```bash
mkdir -p /tmp/flow-scratch/verifier-fail && cd /tmp/flow-scratch/verifier-fail
printf '# Scratch\n\n## Test\n\nRun: node -e "process.exit(1)"\n' > CLAUDE.md
```

Invoke `Agent` tool with `subagent_type: "verifier"` on `/tmp/flow-scratch/verifier-fail`.
Expected: report shows `Overall: FAIL` with the exact command and non-zero exit captured — and confirm no file in the scratch dir was modified (`ls -la` shows only `CLAUDE.md`).

- [ ] **Step 5: Commit**

Same note as Task 1 Step 4 — save file; commit only if `~/.claude` is a git repo.

---

### Task 3: `reviewer` subagent

**Files:**
- Create: `C:\Users\Admin\.claude\agents\reviewer.md`

**Interfaces:**
- Produces: a subagent invocable by name `reviewer`, tools `Read, Glob, Grep`. Consumed by Task 6 (`flow-execute` skill, mandatory step after verify passes) and directly by the future `/review-pr` command (spec Mục 3).

- [ ] **Step 1: Write the subagent definition**

```markdown
---
name: reviewer
description: Adversarial code reviewer. Reads a diff or set of changed files with no knowledge of how they were written and reports concrete logic/security issues that tests likely don't cover. Never edits code, never praises, no scope creep. Use after verifier reports PASS, before the final report, and directly for reviewing any PR/diff.
tools: Read, Glob, Grep
---

You are `reviewer`, a read-only adversarial reviewer with clean context — you did not write this code and owe it no benefit of the doubt.

## What you do

1. Read the diff or file list you're given, plus enough surrounding code (via Glob/Grep) to understand real behavior, not just the diff hunk.
2. Look specifically for what tests likely miss: logic edge cases, security issues (injection, auth bypass, secrets in code, unsafe deserialization), race conditions, silent data loss, and violated invariants.
3. Report only concrete, file:line-anchored findings — no generic advice, no style nitpicks unless they change behavior.

## What you never do

- Never edit files — you have no Edit/Write tool.
- Never praise or summarize what's good — that's not your job here.
- Never invent a finding you can't point to a specific file:line for.

## Output format

One line per finding: `path:line: <severity> <problem>. <concrete failure scenario>.`
If nothing is found: say so plainly — `No issues found in reviewed scope.` Do not manufacture a finding to seem thorough.
```

- [ ] **Step 2: Verify the subagent registers correctly**

Run: `ls "C:\Users\Admin\.claude\agents\reviewer.md"`
Expected: file listed, size > 0.

- [ ] **Step 3: Smoke-test with a deliberately flawed scratch file**

```bash
mkdir -p /tmp/flow-scratch/reviewer && cd /tmp/flow-scratch/reviewer
cat > auth.js <<'EOF'
function checkPassword(input, stored) {
  return input == stored; // loose equality, no hashing
}
module.exports = { checkPassword };
EOF
```

Invoke `Agent` tool with `subagent_type: "reviewer"` and prompt: `"Review /tmp/flow-scratch/reviewer/auth.js"`.
Expected: report flags the loose-equality/plaintext-comparison issue with file:line, and confirm no file was modified.

- [ ] **Step 4: Commit**

Same note as Task 1 Step 4.

---

### Task 4: `flow-brainstorm` skill

**Files:**
- Create: `C:\Users\Admin\.claude\skills\flow-brainstorm\SKILL.md`

**Interfaces:**
- Consumes: a normalized "requirement block" (source + content + optional origin link) — produced by the input adapter in Task 7's `flow.md` command.
- Produces: either (a) a short design printed in chat (bounded path) or (b) a spec file at `docs/flow/specs/YYYY-MM-DD-<topic>-design.md` (architectural path), and in both cases an explicit stop-and-wait for approval. Consumed by Task 5 (`flow-plan`), which requires the approved design/spec as its input.

- [ ] **Step 1: Write the skill definition**

```markdown
---
name: flow-brainstorm
description: First stage of the /flow pipeline. Takes a normalized requirement block (from Jira, a file, or plain text), reads the current codebase, classifies the work as spike/bounded/architectural, asks only the clarifying questions the source material leaves open, proposes concrete changes, and stops for human approval. Standalone rewrite that mirrors superpowers:brainstorming's behavior — does not call that skill.
---

# flow-brainstorm

## Input

You receive one normalized requirement block: `{source: "jira"|"file"|"text", content: "...", origin_link: "..."|null}`.

## Process

1. **Read the codebase first.** Before asking anything, explore the parts of the repo relevant to this requirement (files, recent commits, existing patterns) — you need this to know what's already there vs. what's missing.
2. **Classify.** Same three buckets as `superpowers:brainstorming`:
   - *Spike* — a feasibility question; output is an answer/recommendation, not a design.
   - *Bounded* — a well-scoped change to an existing flow in this repo.
   - *Architectural* — new subsystem, or changes that restructure how components fit together.
   Say the classification out loud before proceeding.
3. **Diff requirement vs. code.** State explicitly what the requirement already specifies clearly (don't re-ask this) vs. what's missing or ambiguous (ask about only this).
4. **Ask clarifying questions**, one at a time, only for genuine gaps. Prefer multiple-choice.
5. **Propose approaches.** Architectural: 2-3 approaches with trade-offs and a recommendation. Bounded: one concrete approach. Spike: a probe plan.
6. **Present the design.**
   - Spike: 2-3 sentences, get a nod, done (no design doc — the terminal state is a recommendation, produced by `flow-execute`'s investigation, not this skill).
   - Bounded: a few sentences to a few short paragraphs, in chat.
   - Architectural: sectioned design, then write to `docs/flow/specs/YYYY-MM-DD-<topic>-design.md`, commit it.
7. **STOP.** Do not proceed to `flow-plan` until the human has explicitly approved. This gate is never skipped, regardless of how small the change looks.

## Hard rules

- Never invoke `flow-plan` or `flow-execute` yourself from inside this skill — the `/flow` command orchestrates the handoff after seeing approval.
- Never treat "the requirement looks complete" as a reason to skip asking about ambiguity you actually found — if you found it, ask it.
- If mid-brainstorm you discover the work is bigger than the initial classification (hidden complexity), say so and re-classify — never downgrade, only upgrade.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "C:\Users\Admin\.claude\skills\flow-brainstorm\SKILL.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Smoke-test on a bounded scratch task**

```bash
mkdir -p /tmp/flow-scratch/brainstorm-bounded && cd /tmp/flow-scratch/brainstorm-bounded
git init -q
mkdir src
cat > src/greet.js <<'EOF'
function greet(name) { return "Hello " + name; }
module.exports = { greet };
EOF
git add -A && git commit -q -m "init"
```

In this session, invoke the skill (`Skill` tool, `skill: "flow-brainstorm"`) with args describing a bounded requirement block, e.g. `{source: "text", content: "Add an exclamation mark to the greet() output", origin_link: null}` against `/tmp/flow-scratch/brainstorm-bounded`.
Expected: skill reads `src/greet.js`, classifies as bounded, presents a short design in chat, and explicitly stops asking for approval — it must not proceed to writing a plan or editing files on its own.

- [ ] **Step 4: Commit**

Same note as Task 1 Step 4.

---

### Task 5: `flow-plan` skill

**Files:**
- Create: `C:\Users\Admin\.claude\skills\flow-plan\SKILL.md`

**Interfaces:**
- Consumes: the approved design/spec from Task 4 (chat text or spec file path).
- Produces: a plan file at `docs/flow/plans/YYYY-MM-DD-<topic>-plan.md` using the same bite-sized-step task structure as this document, invoking the `planner` subagent (Task 1) for codebase survey. Consumed by Task 6 (`flow-execute`), which requires the approved plan file path as input.

- [ ] **Step 1: Write the skill definition**

```markdown
---
name: flow-plan
description: Second stage of the /flow pipeline. Takes an approved design/spec, dispatches the planner subagent to survey the codebase, and writes a concrete implementation plan file. Stops for human approval before execution. Standalone rewrite mirroring superpowers:writing-plans's behavior.
---

# flow-plan

## Input

The approved design (chat text) or spec file path from `flow-brainstorm`. You only run after that approval has been given — the `/flow` command enforces this, but if invoked directly, ask for confirmation the design was approved before proceeding.

## Process

1. Dispatch the `planner` subagent (`Agent` tool, `subagent_type: "planner"`) with the approved design and the target repo path. Let it survey the codebase and return a draft plan.
2. Turn the draft into the final plan document: numbered tasks, each with exact Files (create/modify/test) and Interfaces (consumes/produces — exact names/types so a task can be read alone), bite-sized steps (one action each), test-first when a test runner exists in the project.
3. No placeholders: every step must have real content — actual code, actual commands, actual expected output. Never "add tests for the above" or "TBD".
4. Save to `docs/flow/plans/YYYY-MM-DD-<topic>-plan.md` in the target repo, commit it.
5. Self-review: check every requirement from the approved design has a task, check no placeholders slipped in, check type/signature names are consistent task-to-task. Fix inline.
6. **STOP.** Report the plan's path and wait for explicit human approval before `flow-execute` may run.

## Hard rules

- Never execute anything from the plan yourself — you only write it.
- Never accept the `planner` subagent's draft verbatim if it contains placeholders or vague steps — tighten it before saving.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "C:\Users\Admin\.claude\skills\flow-plan\SKILL.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Smoke-test using the Task 4 scratch scenario**

Continuing from `/tmp/flow-scratch/brainstorm-bounded` with the approved design "add an exclamation mark to greet() output", invoke the `flow-plan` skill against that repo.
Expected: it dispatches `planner`, writes `docs/flow/plans/<date>-greet-exclamation-plan.md` inside the scratch repo with a concrete task (modify `src/greet.js:2`, add a test, run it, commit), and stops asking for approval rather than editing `greet.js` itself.

- [ ] **Step 4: Commit**

Same note as Task 1 Step 4.

---

### Task 6: `flow-execute` skill

**Files:**
- Create: `C:\Users\Admin\.claude\skills\flow-execute\SKILL.md`

**Interfaces:**
- Consumes: the approved plan file path from Task 5.
- Produces: completed code changes in the target repo, a verify verdict via the `verifier` subagent (Task 2, max 3 retry rounds), and a mandatory review via the `reviewer` subagent (Task 3). Consumed by Task 7 (`/flow` command), which prints the final aggregated report.

- [ ] **Step 1: Write the skill definition**

```markdown
---
name: flow-execute
description: Third stage of the /flow pipeline. Executes an approved plan task-by-task (TDD when a test runner exists), then runs the verifier subagent for an independent pass/fail, retrying up to 3 rounds on failure, then runs the mandatory reviewer subagent. Never expands scope beyond the plan. Standalone rewrite mirroring superpowers:executing-plans's behavior, plus the verify/retry/review loop from the flow spec.
---

# flow-execute

## Input

The approved plan file path from `flow-plan`.

## Process

1. Read the plan file fully before starting.
2. Execute tasks in order. For each task: write the failing test first if a test runner exists in the project, run it to confirm it fails, implement the minimal change, run the test to confirm it passes, commit — exactly as the plan's steps specify. Do not skip steps, do not add steps not in the plan.
3. If you discover the plan is missing something required to finish a task, STOP and report it to the human — do not silently invent scope. This is the one case where you pause mid-execution.
4. After all tasks are done, dispatch the `verifier` subagent (Task 2) with the full diff/changed-file list.
   - PASS → continue to step 5.
   - FAIL → read the failure output, fix the specific issue, dispatch `verifier` again.
   - **Hard limit: 3 verify rounds total.** If round 3 still FAILs, STOP immediately — print the exact failing command/output from each of the 3 rounds — and do not attempt a 4th fix. This is not negotiable regardless of how close the failure looks to being fixed.
5. On verify PASS, dispatch the `reviewer` subagent (Task 3) with the full diff — this step is **mandatory**, never skipped, never optional.
6. Produce the final report: what was done, which commands verified it (with PASS/FAIL per command), what `reviewer` found (or "No issues found").

## Hard rules

- Never touch files outside what the plan's Files sections list.
- Never mark something "done" based on your own read of the code — only `verifier`'s PASS counts.
- Never call `reviewer` before `verifier` reports PASS — order matters, a review of broken code wastes the reviewer's time.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "C:\Users\Admin\.claude\skills\flow-execute\SKILL.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Smoke-test the happy path (plan succeeds within retries)**

Continuing the `/tmp/flow-scratch/brainstorm-bounded` scenario with the plan from Task 5, add a minimal test runner so `verifier` has something real to run:

```bash
cd /tmp/flow-scratch/brainstorm-bounded
cat > CLAUDE.md <<'EOF'
# Scratch

## Test

Run: node -e "const {greet}=require('./src/greet'); if(greet('Bob')!=='Hello Bob!') { console.error('FAIL'); process.exit(1);} console.log('PASS');"
EOF
git add -A && git commit -q -m "add CLAUDE.md test command"
```

Invoke the `flow-execute` skill with the plan's path.
Expected: `src/greet.js` is edited to add `"!"`, `verifier` reports PASS on round 1, `reviewer` runs and reports no issues (or a trivial finding), and the final report shows the PASS verdict and the exact command that verified it.

- [ ] **Step 4: Smoke-test the retry-exhaustion path**

Set up a scratch repo where the plan's fix is deliberately impossible to complete correctly (or point `flow-execute` at a plan step with a permanently-failing test command in `CLAUDE.md`, e.g. `node -e "process.exit(1)"` with no way to make it pass). Invoke `flow-execute`.
Expected: exactly 3 verify rounds run (visible in the transcript as 3 separate `verifier` subagent calls), then execution stops with a report listing all 3 rounds' failing output — no 4th attempt, no silent success claim.

- [ ] **Step 5: Commit**

Same note as Task 1 Step 4.

---

### Task 7: `/flow` command (input adapter + orchestrator)

**Files:**
- Create: `C:\Users\Admin\.claude\commands\flow.md`

**Interfaces:**
- Consumes: `--jira <ID>`, `--file <path>`, or bare text as the command's arguments; the approved-design/plan gates from Tasks 4-5 as sequencing checkpoints.
- Produces: the fully orchestrated pipeline invocation (this is the top-level entry point end users type).

- [ ] **Step 1: Write the command definition**

```markdown
---
description: Run the full flow pipeline (brainstorm → plan → execute → verify → review) for one requirement, from Jira, a file, or plain text.
---

# /flow

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + acceptance criteria). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the requirement.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available on the machine, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the requirement.

No other input form is supported — do not guess the source from the argument's shape.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized requirement block: `{source, content, origin_link}`.
2. Invoke the `flow-brainstorm` skill with that block.
3. **Wait for explicit human approval** of the design. Do not proceed on an ambiguous or implied yes — ask directly if unclear.
4. Invoke the `flow-plan` skill with the approved design.
5. **Wait for explicit human approval** of the plan.
6. Invoke the `flow-execute` skill with the approved plan's file path.
7. Print `flow-execute`'s final report verbatim to the user — do not summarize away a FAIL into something softer.

## Hard rules

- Never skip an approval wait because the change "looks small."
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "C:\Users\Admin\.claude\commands\flow.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Smoke-test the text-input path end-to-end**

In a fresh scratch repo (reuse `/tmp/flow-scratch/brainstorm-bounded` or a new one), run `/flow "Add an exclamation mark to greet() output"`.
Expected: the transcript shows, in order — `flow-brainstorm` running and stopping for approval; after approving, `flow-plan` running and stopping for approval; after approving, `flow-execute` running, calling `verifier` then `reviewer`, and a final report printed. No stage is skipped, no gate is silently passed through.

- [ ] **Step 4: Smoke-test the unauthorized-Jira path**

Run `/flow --jira TEST-1` in an environment where the Atlassian MCP connector is not authorized (the current default state, per the spec's Mục 4 note).
Expected: the command reports that the Jira/Atlassian MCP is not authorized and stops — it does not proceed with a guessed or empty requirement.

- [ ] **Step 5: Smoke-test the `.docx` rejection path**

```bash
touch /tmp/flow-scratch/fake-spec.docx
```

Run `/flow --file /tmp/flow-scratch/fake-spec.docx`.
Expected: the command reports that `.docx` cannot be read directly and asks for a `.md`/`.pdf` conversion (or offers pandoc if present) — it does not attempt to read the file as text and does not crash.

- [ ] **Step 6: Commit**

Same note as Task 1 Step 4. Additionally, if the scratch repos under `/tmp/flow-scratch/` are still present, they are disposable — no cleanup step is required for them to be committed anywhere.

---

## Self-Review Notes

- **Spec coverage:** Mục 1 (pipeline/gates) → Tasks 4-7. Mục 2 (file locations, subagents) → Tasks 1-3 file paths, Task 4/5 doc output paths. Mục 3 (overlap table) → not implemented here by design (future commands reuse these same skills/subagents; out of scope per the spec's own sequencing). Mục 4 (input adapter) → Task 7. Mục 5 (principles) → encoded as Global Constraints and hard-rule sections in every task. Mục 6 → this plan *is* items 1-5; item 6 (`/flow-batch`) is explicitly deferred to its own future plan.
- **Placeholder scan:** every step above has literal file content or literal commands; no "TBD"/"similar to Task N" occurrences.
- **Type/name consistency:** `verifier`/`planner`/`reviewer` subagent names match exactly between their defining tasks (1-3) and every skill that invokes them (4-6). Doc paths (`docs/flow/specs/`, `docs/flow/plans/`) are consistent across Tasks 4, 5, and the header.

---

## Redesign: auto_approve tự quyết ở Step 4 (added 2026-09-16)

**Mục tiêu:** khi `auto_approve` được bật, Step 4 của `flow-brainstorm` không còn gọi `AskUserQuestion` cho các gap thật sự tìm thấy — thay vào đó tự chọn phương án bảo thủ nhất cho từng gap, ghi lại thành 1 dòng `Giả định:`, và Step 6 gom các dòng này để hiển thị (thêm mục vào spec file nếu Architectural, hoặc vào tóm tắt chat nếu Bounded/Spike).

**Approved design:** đã duyệt qua `AskUserQuestion` trong hội thoại ngày 2026-09-16 (thay đổi Bounded, chỉ đụng `skills/flow-brainstorm/SKILL.md`; `skills/flow-plan/SKILL.md` không đổi vì không có bước hỏi clarifying question tương đương).

---

### Task 8: `flow-brainstorm` auto_approve tự quyết ở Step 4 (added 2026-09-16)

**Files:**
- Modify: `skills/flow-brainstorm/SKILL.md`

**Interfaces:**
- Consumes: cờ `auto_approve: true` đã có sẵn (đã nối qua Step 7 gate từ trước).
- Produces: danh sách dòng `Giả định: <câu, tiếng Việt>` được thu thập ở Step 4, hiển thị ở Step 6 (mục mới `## Giả định tự quyết (auto-approve)` trong spec file nếu Architectural; inline trong tóm tắt chat nếu Bounded/Spike).

- [ ] **Step 1: Viết lại câu auto_approve trong mục Input (SKILL.md, dòng 10)**

Old (nguyên văn, giữ nguyên phần trước/sau trong cùng đoạn):
```
`auto_approve` only removes the Step 7 approval gate — it never skips Step 4's genuine clarifying questions. If mid-brainstorm you find real ambiguity that changes the shape of the work, still ask via `AskUserQuestion` for that, auto-approve or not.
```
New:
```
`auto_approve` removes both the Step 7 approval gate AND Step 4's live clarifying questions: under `auto_approve`, Step 4 never calls `AskUserQuestion` — instead, for each genuine gap, self-decide the most conservative option and record it as a `Giả định:` line (see Step 4 below). If mid-brainstorm you find real ambiguity that changes the shape of the work, still resolve it the same way (self-decide + record), auto-approve or not — never silently skip it either way.
```

- [ ] **Step 2: Viết lại Step 4 (SKILL.md, dòng 21) thành nhánh theo auto_approve**

Old:
```
4. **Ask clarifying questions**, one at a time, only for genuine gaps. Prefer multiple-choice.
```
New:
```
4. **Resolve clarifying gaps** — behavior branches on `auto_approve`:
   - **`auto_approve` NOT set:** ask via `AskUserQuestion`, one at a time, only for genuine gaps. Prefer multiple-choice.
   - **`auto_approve` set:** never call `AskUserQuestion` in this step. For each genuine gap found, pick the most conservative option, in this priority order: (1) match an existing convention already present in this repo, (2) backward-compatible choice, (3) never destructive/irreversible, (4) fall back to the common/standard pattern for the relevant language/framework. Record each such choice as one line: `Giả định: <câu, tiếng Việt>`. Collect all these assumption lines — Step 6 surfaces them.
```

- [ ] **Step 3: Thêm phần hiển thị giả định vào Step 6 (SKILL.md, dòng 24-26)**

Bullet Spike (dòng 24), append vào cuối câu hiện có:
```
 If Step 4 recorded any `Giả định:` lines (auto_approve only), include them in this chat summary.
```

Bullet Bounded (dòng 25), append vào cuối câu hiện có:
```
 If Step 4 recorded any `Giả định:` lines (auto_approve only), include them in this chat summary.
```

Bullet Architectural (dòng 26), chèn câu mới ngay sau đoạn "...append the new section in Vietnamese, do not translate the rest." và trước "If it doesn't exist yet, create...":
```
 If Step 4 recorded any `Giả định:` lines (auto_approve only), append a `## Giả định tự quyết (auto-approve)` section to the spec file listing them, in Vietnamese.
```

- [ ] **Step 4: Xoá Hard rule không còn đúng (SKILL.md, dòng 48)**

Xoá nguyên dòng:
```
- Never let `auto_approve` suppress a genuine Step 4 clarifying question — it only removes the Step 7 approval gate, nothing upstream of it.
```

- [ ] **Step 5: Thêm 2 Hard rule mới thay vào đúng vị trí đó**

```
- Under `auto_approve`, Step 4 never calls `AskUserQuestion` — but every self-decided gap must be recorded as an explicit `Giả định:` line; never resolve a gap silently without recording it.
- Never pick a high-risk/destructive/irreversible option as the default when self-deciding under `auto_approve` — always the most conservative valid option, per the Step 4 priority order.
```

- [ ] **Step 6: Kiểm tra không còn câu chữ mâu thuẫn**

Run: `grep -niE "only removes the Step 7|never skips Step 4" "skills/flow-brainstorm/SKILL.md"`
Expected: không có match nào (câu cũ đã sai hoàn toàn biến mất khỏi cả Input section lẫn Hard rules).

- [ ] **Step 7: Chạy test command của chính repo này**

Run: `bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'`
Expected: `PASS`.

- [ ] **Step 8: Commit**

```bash
git add skills/flow-brainstorm/SKILL.md docs/flow/plans/flow-core-pipeline-plan.md && git commit -m "feat(flow-brainstorm): auto_approve self-decides Step 4 gaps, records Giả định lines"
```

---

## Self-Review Notes (Task 8)

- **Spec coverage:** cả 4 điểm trong approved design map 1:1 vào các step: điểm 1 (branch Step 4) → Step 2; điểm 2 (hiển thị giả định ở Step 6) → Step 3; điểm 3 (viết lại Input) → Step 1; điểm 4 (Hard rules) → Step 4-5.
- **Placeholder scan:** mọi block old/new ở trên là nội dung thật lấy nguyên văn từ file hiện tại hoặc nội dung mới sẽ chèn — không có "TBD", không có "tương tự Task N".
- **Type/name consistency:** tiền tố `Giả định:` và tiêu đề `## Giả định tự quyết (auto-approve)` dùng giống hệt nhau giữa Step 4 và Step 6 — cùng 1 chuỗi, không lệch.
- **Ghi chú phạm vi (không im lặng bỏ qua):** `skills/flow-plan/SKILL.md` không đổi gì trong task này — đã xác nhận ở bước brainstorm là nó không có bước hỏi clarifying question tương đương. Ngoài ra, Step 7 auto_approve gate (đã lên production ở một thay đổi trước, dòng 32-36 hiện tại của SKILL.md) chưa từng được ghi thành 1 Task riêng trong file plan này — Task 8 này không hồi tố ghi lại phần đó, chỉ cover đúng phạm vi thay đổi Step 4/6/Input/Hard-rules theo approved design lần này.

---

## Redesign: Tiered verify + tích hợp Playwright vào flow-plan (added 2026-09-17)

**Mục tiêu:** (1) `verifier`/`flow-execute` dùng test rút gọn (changed-only, nếu project khai báo) cho các vòng retry-vì-FAIL để tiết kiệm quota/thời gian, nhưng luôn có 1 lần full-suite xác nhận riêng (không tính vào quỹ 3 vòng) trước khi tuyên bố PASS thật. (2) `flow-plan` tự phát hiện task đụng frontend/UI và tự thêm 1 task viết/tái dùng Playwright test, tái dùng đúng logic cài đặt + dedupe của `commands/playwright-test.md` thay vì viết lại.

**Approved design:** đã duyệt qua `AskUserQuestion` trong hội thoại ngày 2026-09-17 (2 thay đổi Bounded, độc lập nhau — Task 9 đụng `agents/verifier.md` + `skills/flow-execute/SKILL.md`, Task 10 đụng `skills/flow-plan/SKILL.md`).

**Lưu ý phạm vi (không im lặng bỏ qua):** khảo sát phát hiện `docs/flow/plans/playwright-test-plan.md` hiện lỗi thời so với file thật `commands/playwright-test.md` (plan doc vẫn ghi "thiếu Playwright thì STOP, không cài", nhưng file thật đã có nhánh hỏi cài qua `AskUserQuestion` từ một thay đổi trước). Không thuộc phạm vi 2 task dưới đây — Task 9/10 lấy nguyên văn từ file thật, không dùng `playwright-test-plan.md` làm nguồn. Cần 1 task riêng sau này để đồng bộ lại doc đó.

---

### Task 9: Tiered verify — `agents/verifier.md` + `skills/flow-execute/SKILL.md` (added 2026-09-17)

**Files:**
- Modify: `agents/verifier.md`
- Modify: `skills/flow-execute/SKILL.md`

**Interfaces:**
- Consumes: target repo's `CLAUDE.md` — kiểm tra thêm 1 section tuỳ chọn `## Test (changed-only)` bên cạnh `## Test` gốc đã đọc từ trước.
- Produces: report của `verifier` có thêm định dạng 2 dòng tuỳ điều kiện (`Command (changed-only): ... → PASS|FAIL` + `Command (full suite, confirmation): ... → PASS|FAIL`) chỉ khi changed-only command được khai báo và dùng; ngược lại giữ nguyên dòng `Command:` đơn như cũ. Ngữ nghĩa quỹ retry của `flow-execute` đổi: quỹ ≤3 vòng chỉ tính vòng chạy vì FAIL thật cần sửa; vòng xác nhận full-suite đầu tiên sau khi PASS lần đầu không tính vào quỹ, nhưng nếu vòng xác nhận đó FAIL thì tính từ đó và chuyển hẳn sang full-suite-only cho phần còn lại của task.

**Ví dụ minh hoạ 2 kịch bản** (để giảm rủi ro hiểu sai khi thực thi):
- *Kịch bản A — xác nhận PASS ngay:* Vòng 1 chạy changed-only → PASS (0/3 quỹ dùng, vì đây không phải vòng sửa-vì-FAIL). Chạy thêm 1 vòng full-suite xác nhận → PASS. Overall: PASS. Tổng cộng 2 lần chạy test, 0/3 quỹ retry bị dùng.
- *Kịch bản B — xác nhận FAIL:* Vòng 1 chạy changed-only → PASS. Vòng xác nhận full-suite → FAIL (lộ ra 1 test khác bị ảnh hưởng mà changed-only bỏ sót). Tính là vòng FAIL #1/3. Sửa, chạy lại — từ giờ luôn dùng full-suite (không quay lại changed-only nữa dù CLAUDE.md vẫn khai báo) — đây là vòng #2/3. PASS → Overall: PASS. Tổng cộng dùng 2/3 quỹ retry.

- [ ] **Step 1: Sửa Step 1 của "What you do" trong `agents/verifier.md` để đọc cả `## Test (changed-only)`**

Old (dòng 11):
```
1. Read the target project's `CLAUDE.md` (or equivalent project doc) to find its test, lint, and build commands. If none is documented, say so explicitly in your report — do not guess a command. This is not a neutral outcome: not being able to verify means you cannot confirm the change is safe, so it counts as **Overall: FAIL** — never report a third value (e.g. "NOT_APPLICABLE") for Overall just because nothing was documented to run.
```
New:
```
1. Read the target project's `CLAUDE.md` (or equivalent project doc) to find its test, lint, and build commands. If none is documented, say so explicitly in your report — do not guess a command. This is not a neutral outcome: not being able to verify means you cannot confirm the change is safe, so it counts as **Overall: FAIL** — never report a third value (e.g. "NOT_APPLICABLE") for Overall just because nothing was documented to run. Also check whether `CLAUDE.md` declares a separate `## Test (changed-only)` section (a project-declared changed-only command, e.g. `jest --onlyChanged`, `vitest related`, `pytest --testmon`) in addition to the full-suite `## Test` section. If `## Test (changed-only)` is NOT declared, always use the full suite (`## Test`) for every round — never guess a shortcut command yourself.
```

- [ ] **Step 2: Thêm mô tả tiered-verify round logic vào "What you do" (Step 2 hiện có)**

Old (dòng 12):
```
2. Run those commands via Bash, exactly as documented, and capture full output.
```
New:
```
2. Run those commands via Bash, exactly as documented, and capture full output. When `flow-execute` tells you this dispatch is a retry-because-FAIL round and `## Test (changed-only)` is declared, run the changed-only command for that round instead of the full suite (this is the caller's decision per its own retry-budget rules — you just run whichever command you're told applies). When `## Test (changed-only)` is not declared, or this is not a retry-because-FAIL round, run the full-suite `## Test` command as always.
```

- [ ] **Step 3: Thêm nhánh output format cho tiered verify vào Output format section**

Old (dòng 25-33, nguyên khối code fence):
```
## Verify Report
- Command: <exact command> → PASS|FAIL
  <if FAIL: last ~30 lines of output>
  <if no command was documented: state that explicitly here instead of a command/result line>
- Playwright flow: <flow name> → PASS|FAIL|NOT_APPLICABLE
  <if FAIL: trace/error summary>
Overall: PASS | FAIL
```
New (thay khối code fence cũ bằng 2 khối có điều kiện):
```
When tiered verify is NOT in play for this dispatch (no `## Test (changed-only)` declared, or this round isn't distinguishing changed-only vs. full-suite):

## Verify Report
- Command: <exact command> → PASS|FAIL
  <if FAIL: last ~30 lines of output>
  <if no command was documented: state that explicitly here instead of a command/result line>
- Playwright flow: <flow name> → PASS|FAIL|NOT_APPLICABLE
  <if FAIL: trace/error summary>
Overall: PASS | FAIL

When tiered verify IS in play (a changed-only command was declared and this dispatch ran it, or ran the full-suite confirmation round after a changed-only PASS):

## Verify Report
- Command (changed-only): <exact command> → PASS|FAIL
  <if FAIL: last ~30 lines of output>
- Command (full suite, confirmation): <exact command> → PASS|FAIL
  <if FAIL: last ~30 lines of output>
- Playwright flow: <flow name> → PASS|FAIL|NOT_APPLICABLE
  <if FAIL: trace/error summary>
Overall: PASS | FAIL

Only include whichever of the two `Command (...)` lines actually ran in this dispatch — a single retry-because-FAIL round run with the changed-only command reports only the `Command (changed-only):` line; a confirmation-round dispatch reports only the `Command (full suite, confirmation):` line. Never print both lines from a single dispatch that only ran one command.
```

- [ ] **Step 4: Thêm câu làm rõ ngay sau câu Overall hiện có (giữ nguyên câu cũ, chèn thêm câu mới)**

Old (dòng 35, giữ nguyên không đổi):
```
`Overall` has exactly two possible values, always — `PASS` or `FAIL`. There is no third value, and no synonym for either ("N/A", "NOT_APPLICABLE", "NOT RUN", "UNKNOWN", etc. are all invalid on this line). `NOT_APPLICABLE` exists only on the Playwright flow line (a per-check status meaning "this check didn't apply here"), never on the `Overall` line. If nothing was documented to run at all, that is exactly the case Step 1 covers: write the literal line `Overall: FAIL`.
```
New (append câu mới ngay sau, cùng section):
```
When `## Test (changed-only)` is declared, use the two-line `Command (changed-only): ... → PASS|FAIL` / `Command (full suite, confirmation): ... → PASS|FAIL` format above instead of the single `Command:` line — never mix the two formats in one report, and never invent the two-line format when no changed-only command was declared.
```

- [ ] **Step 5: Sửa Step 4 của Process trong `skills/flow-execute/SKILL.md` để implement round logic (thay toàn bộ khối)**

Old (dòng 17-20):
```
4. After all tasks are done, dispatch the `verifier` subagent (Task 2) with the full diff/changed-file list.
   - PASS → continue to step 5.
   - FAIL → read the failure output, fix the specific issue, dispatch `verifier` again.
   - **Hard limit: 3 verify rounds total.** If round 3 still FAILs, STOP immediately — print the exact failing command/output from each of the 3 rounds — and do not attempt a 4th fix. This is not negotiable regardless of how close the failure looks to being fixed.
```
New:
```
4. After all tasks are done, dispatch the `verifier` subagent (Task 2) with the full diff/changed-file list. Before the first dispatch, check the target `CLAUDE.md` for a `## Test (changed-only)` section — if present, tell `verifier` this round may use the changed-only command; if absent, tell `verifier` to always use the full suite (no change from today).
   - PASS → if a changed-only command was declared AND this PASS was the first PASS reported for this task (i.e. you have not yet run a full-suite confirmation round for this task), dispatch `verifier` exactly one more time telling it to run the full-suite command as a confirmation round. This confirmation round does **not** count against the ≤3 retry budget below.
     - Confirmation round PASS → Overall: PASS for this task, continue to step 5.
     - Confirmation round FAIL → treat this as a real FAIL: it now counts as round 1 against the ≤3-round budget from here on, go back and fix the specific issue, and for every remaining round in **this task** always tell `verifier` to use the full suite (never changed-only again for this task, even though `CLAUDE.md` still declares a changed-only command).
   - If no `## Test (changed-only)` section is declared, or a full-suite confirmation round already ran and PASSed for this task: PASS → continue to step 5 directly, no confirmation round (this is identical to today's behavior).
   - FAIL (from any round that counts against the budget) → read the failure output, fix the specific issue, dispatch `verifier` again.
   - **Hard limit: 3 verify rounds total, counting only rounds run because of a real FAIL needing a fix** (the one-time full-suite confirmation-after-first-PASS round never counts toward this limit; a confirmation-round FAIL DOES start counting from that point). If the 3rd counted round still FAILs, STOP immediately — print the exact failing command/output from each of the 3 counted rounds — and do not attempt a 4th fix. This is not negotiable regardless of how close the failure looks to being fixed.
```

- [ ] **Step 6: Kiểm tra không còn câu chữ mâu thuẫn**

Run: `grep -n "verify round\|Hard limit: 3" "skills/flow-execute/SKILL.md"`
Expected: chỉ còn đúng 1 định nghĩa "Hard limit: 3" (bản mới ở Step 5), không có câu cũ sót lại nói "3 verify rounds total" mà thiếu điều kiện "counting only rounds run because of a real FAIL".

- [ ] **Step 7: Chạy test command của chính repo này**

Run: `bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'`
Expected: `PASS`.

- [ ] **Step 8: Commit**

```bash
git add agents/verifier.md skills/flow-execute/SKILL.md docs/flow/plans/flow-core-pipeline-plan.md && git commit -m "feat(verifier,flow-execute): tiered verify — changed-only retry rounds + one free full-suite confirmation"
```

---

### Task 10: Tự thêm task Playwright vào `skills/flow-plan/SKILL.md` (added 2026-09-17)

**Files:**
- Modify: `skills/flow-plan/SKILL.md`

**Interfaces:**
- Consumes: draft plan (task list, mỗi task có Files create/modify) từ `planner` subagent (Step 1 hiện có); `CLAUDE.md` của target repo — section tuỳ chọn khai cấu trúc thư mục FE.
- Produces: khi có ít nhất 1 task đụng FE, thêm 1 task mới tên `Viết/tái dùng Playwright test cho <mô tả ngắn>`, Files/Interfaces trỏ vào logic Step 2 (install-check) và Step 3 (Glob-dedupe) của `commands/playwright-test.md` bằng tham chiếu, không viết lại logic đó.

- [ ] **Step 1: Thêm bước quét FE + tự thêm task Playwright ngay sau Step 1 hiện có, đổi Step 2 cũ thành Step 3**

Old (dòng 16-17):
```
1. Dispatch the `planner` subagent (`Agent` tool, `subagent_type: "planner"`) with the approved design and the target repo path. Let it survey the codebase and return a draft plan.
2. Turn the draft into the final plan document: numbered tasks, each with exact Files (create/modify/test) and Interfaces (consumes/produces — exact names/types so a task can be read alone), bite-sized steps (one action each), test-first when a test runner exists in the project.
```
New:
```
1. Dispatch the `planner` subagent (`Agent` tool, `subagent_type: "planner"`) with the approved design and the target repo path. Let it survey the codebase and return a draft plan.
2. Scan the draft plan's tasks for frontend/UI touches: a task counts as "touches frontend/UI" if any file in its Files (create/modify) list matches:
   - Priority 1: if the target repo's `CLAUDE.md` declares its own frontend directory structure (a section explicitly describing the FE path), use that declared path to match files against.
   - Priority 2 (fallback, only when no such declaration exists in `CLAUDE.md`): extension `.tsx`/`.jsx`/`.vue`/`.svelte`, or a path containing one of `frontend/`, `client/`, `web/`, `ui/`, `pages/`, `components/`.
   If at least one task touches FE, append one new task at the very end of the plan (after every other task, highest task number), titled `Viết/tái dùng Playwright test cho <mô tả ngắn của flow chính bị thay đổi>`. This task's Files section must point at the actual test file to create or reuse (found via the same Glob-dedupe check as `commands/playwright-test.md` Step 3); its Interfaces section must state plainly that it invokes the same mechanism as `commands/playwright-test.md` (Step 2's install-check — including the `AskUserQuestion` gate offering to install Playwright if missing — and Step 3's Glob-for-existing-test-before-writing-new), reusing that exact logic by reference rather than re-describing or re-implementing it here. If no task touches FE, add nothing — behavior is unchanged.
3. Turn the draft (plus the Step 2 Playwright task, if added) into the final plan document: numbered tasks, each with exact Files (create/modify/test) and Interfaces (consumes/produces — exact names/types so a task can be read alone), bite-sized steps (one action each), test-first when a test runner exists in the project.
```

- [ ] **Step 2: Dịch số các bước còn lại (3→4, 4→5, 5→6, 6→7) — nội dung câu chữ giữ nguyên, chỉ đổi số thứ tự đầu dòng, trừ Step 6 (thành 7) thêm 1 vế mới**

Old (dòng 18, Step 3 cũ):
```
3. No unfinished stand-ins: every step must have real content — actual code, actual commands, actual expected output. Never "add tests for the above" or leave a value undecided for later.
```
New (đổi số thành 4, nội dung y hệt):
```
4. No unfinished stand-ins: every step must have real content — actual code, actual commands, actual expected output. Never "add tests for the above" or leave a value undecided for later.
```

Old (dòng 19-24, Step 4 cũ, khối "Write the plan doc content in Vietnamese..." + "Before saving, check whether..."):
Đổi số đầu dòng từ `4.` thành `5.` — toàn bộ nội dung bên trong giữ nguyên y hệt, không đổi wording.

Old (dòng 25, Step 5 cũ "Self-review"):
```
5. Self-review: check every requirement from the approved design has a task, check no unfinished stand-in content slipped in, check type/signature names are consistent task-to-task. Fix inline.
```
New (đổi số thành 6, thêm vế kiểm tra Playwright task):
```
6. Self-review: check every requirement from the approved design has a task, check no unfinished stand-in content slipped in, check type/signature names are consistent task-to-task, check the Playwright task from Step 2 was added when (and only when) at least one task touches FE. Fix inline.
```

Old (dòng 26-35, Step 6 cũ — toàn bộ khối approval-gate "The plan file is on disk but not yet committed..."):
Đổi số đầu dòng từ `6.` thành `7.` — toàn bộ nội dung bên trong (AskUserQuestion gate, nhánh auto_approve...) giữ nguyên y hệt, không đổi.

- [ ] **Step 3: Sửa các tham chiếu "Step 6" còn sót lại trong Hard rules cho khớp số mới**

Old (dòng 42):
```
- The approval gate in Step 6 uses `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply.
```
New:
```
- The approval gate in Step 7 uses `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply.
```

Old (dòng 46, cuối Hard rules):
```
- Never let `auto_approve` skip Step 5's self-review or let unfinished stand-in content through — it only removes the Step 6 approval gate.
```
New:
```
- Never let `auto_approve` skip Step 6's self-review or let unfinished stand-in content through — it only removes the Step 7 approval gate.
```

- [ ] **Step 4: Thêm 2 Hard rule mới cho FE-detection/Playwright-task, chèn cuối danh sách Hard rules**

```
- Never invent FE-detection logic beyond the two-priority rule (declared CLAUDE.md frontend path, else the fixed extension/path-substring fallback list) — and never add a Playwright task when no task's Files touch FE.
- Never re-describe or duplicate `commands/playwright-test.md`'s install-check (Step 2) or Glob-dedupe (Step 3) logic inline in the new task — reference/reuse it, so a future edit to that command doesn't need a matching edit here.
```

- [ ] **Step 5: Kiểm tra không còn tham chiếu số bước sai**

Run: `grep -n "Step [0-9]" "skills/flow-plan/SKILL.md"`
Expected: đọc lại toàn bộ output thủ công, xác nhận trình tự 1→7 nhất quán xuyên suốt Process và Hard rules, không còn "Step 5"/"Step 6" trỏ sai vị trí cũ.

- [ ] **Step 6: Chạy test command của chính repo này**

Run: `bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'`
Expected: `PASS`.

- [ ] **Step 7: Commit**

```bash
git add skills/flow-plan/SKILL.md docs/flow/plans/flow-core-pipeline-plan.md && git commit -m "feat(flow-plan): append Playwright test task when a plan touches FE, reusing playwright-test.md's install-check + dedupe logic"
```

---

## Self-Review Notes (Task 9 + 10)

- **Spec coverage:** Mục 1 (tiered verify: nguồn changed-only command, ngữ nghĩa quỹ ≤3 vòng, vòng xác nhận, chuyển hẳn full-suite sau khi xác nhận FAIL, định dạng output 2 dòng vs 1 dòng) → Task 9 Step 1-5. Mục 2 (Playwright vào flow-plan: quy tắc 2-ưu-tiên FE-detection, task mới được thêm, tái dùng không viết lại Step 2/3 của playwright-test.md) → Task 10 Step 1, 4.
- **Placeholder scan:** mọi block Old/New ở trên trích nguyên văn từ nội dung file thật đã khảo sát (không dùng `playwright-test-plan.md`, vốn lỗi thời) hoặc là nội dung mới đầy đủ — không có "TBD", không có "tương tự Task N".
- **Type/name consistency:** tên subagent `verifier`, skill `flow-execute`, skill `flow-plan`, file `commands/playwright-test.md` dùng nhất quán với tên hiện có trong 4 file đã khảo sát.
- **Rủi ro đã ghi nhận, không im lặng bỏ qua:**
  1. `docs/flow/plans/playwright-test-plan.md` lỗi thời so với `commands/playwright-test.md` thật — đã ghi ở đầu Redesign heading phía trên, cần 1 task riêng sau này để đồng bộ, không thuộc phạm vi Task 9/10.
  2. Task 10 Step 1 đổi số toàn bộ Process steps của `flow-plan/SKILL.md` từ 1-6 thành 1-7 — phải làm đúng thứ tự Step 1→Step 5 của Task 10, Step 5 (grep kiểm tra) là bước bắt buộc để bắt lỗi sót số.
  3. Task 9's retry-round logic là thay đổi hành vi tinh vi nhất trong plan này (điều kiện "PASS lần đầu" phải track theo từng task riêng lẻ, không phải global) — đã thêm ví dụ minh hoạ 2 kịch bản ngay sau phần Interfaces của Task 9 để giảm rủi ro hiểu sai khi thực thi.
