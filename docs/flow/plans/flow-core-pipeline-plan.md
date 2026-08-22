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
