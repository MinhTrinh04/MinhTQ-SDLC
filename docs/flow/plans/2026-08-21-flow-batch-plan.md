# Flow Batch Implementation Plan

> **Superseded (2026-08-21):** this plan's Pha 2 design (Workflow.parallel() barrier) was
> replaced by an immediate per-feature Agent-tool dispatch model. See
> [2026-08-21-flow-batch-pipeline-redesign-plan.md](2026-08-21-flow-batch-pipeline-redesign-plan.md)
> and spec Mục 7.3/7.5 for the current design. This file stays as the historical record of what
> was originally built (commit `13885b2`) — do not edit its body to match the new design.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/flow-batch` — one command that runs N features through `flow-brainstorm`+`flow-plan` sequentially (human-gated), then fans `flow-execute`+verify+review out in parallel, one isolated git worktree per feature, via the Workflow tool.

**Architecture:** A single new global command, `commands/flow-batch.md`, reuses the already-built `flow-brainstorm` and `flow-plan` skills unchanged for Pha 1 (sequential, gated). Pha 2 is a literal Workflow script the command instructs the caller to run via the `Workflow` tool: one `agent()` call per approved feature, `isolation: 'worktree'`, each agent performing execute+verify(retry≤3)+adversarial-review inline (a deliberate simplification — see Task 1 Interfaces note on why nested Agent-tool subagents are avoided inside a Workflow agent).

**Tech Stack:** Claude Code global command (markdown, `~/.claude/commands/`, junction-linked from this repo per `README.md` Mục 1.5) + the `Workflow` tool's inline-JS scripting for Pha 2 parallel fan-out.

**Spec:** [docs/flow/specs/2026-08-21-loop-engineering-flow-design.md](../specs/2026-08-21-loop-engineering-flow-design.md), Mục 7.

## Global Constraints

- Approval gates (design + plan) happen only in Pha 1, sequentially, one feature at a time — never parallelized (spec 7.2, README Mục 0.4: người giữ quyền quyết định cuối).
- Pha 2 never stops for human approval mid-run — it only starts once every feature's plan is already approved (spec 7.3).
- Each feature gets its own git worktree + branch in Pha 2 — never share a working tree between features (spec 7.3).
- Retry limit inside each feature's execute+verify loop: **max 3 rounds**, then stop and report that feature as FAILED with the 3 rounds' output — never a 4th attempt (spec 7.3, inherited from Mục 1/5 of the core design).
- No hard concurrency cap — let the Workflow tool's own `min(16, CPU-2)` scheduling govern it (spec 7.3, user-confirmed).
- Input uses explicit flags only: `--jira "ID1,ID2,..."`, `--file "path1,path2,..."`, or one feature description per line of plain text — no auto-detection (spec Mục 4, extended to lists per spec 7.1).
- Calling the `Workflow` tool from inside this command's own instructions is the opt-in the `Workflow` tool itself requires ("the user invoked a skill or slash command whose instructions tell you to call Workflow") — no separate runtime confirmation needed.
- After Pha 2, merging is manual, one branch at a time, via `superpowers:finishing-a-development-branch` — never auto-merge multiple branches (spec 7.4).

---

### Task 1: `/flow-batch` command

**Files:**
- Create: `commands/flow-batch.md`

**Interfaces:**
- Consumes: `flow-brainstorm` and `flow-plan` skills exactly as built in the flow-core plan (no changes to those files) — invoked via the `Skill` tool by name, once per feature, in Pha 1.
- Produces: for Pha 2, a `Workflow` tool invocation whose script is written out in full inside this command's instructions (below) — the command's job is to fill in `args.features` (name, planPath, repoPath per approved feature) and call `Workflow` with that literal script.
- **Design note (why execute+verify+review are inlined, not nested subagent calls):** the `flow-execute` skill's designed process (Task 6 of the flow-core plan) calls the `verifier` and `reviewer` subagents via the `Agent` tool. Whether a `Workflow` `agent()` can itself call the `Agent` tool to spawn a further subagent is not documented and would add cost/complexity for no real benefit here. Instead, each Pha-2 `agent()` call is given the *combined* instructions of `flow-execute` + `verifier` + `reviewer` directly in its prompt, and performs all three roles itself (execute → self-run verify commands via Bash → self-run adversarial review via Read/Grep) inside its own isolated worktree. This keeps Pha 2 to one agent per feature, matching the Workflow tool's documented capabilities exactly.

- [ ] **Step 1: Write the command file**

```markdown
---
description: Run flow-brainstorm+flow-plan sequentially (gated) for a batch of features, then fan flow-execute out in parallel, one isolated worktree per feature, via the Workflow tool.
---

# /flow-batch

Arguments: `$ARGUMENTS` — exactly one of:
- `--jira "ID1,ID2,ID3"` — comma-separated Jira ticket IDs. Requires the Jira/Atlassian MCP connector already authorized; if not, say so plainly and STOP (do not process any feature via a guessed requirement).
- `--file "path1.md,path2.md"` — comma-separated file paths, each read via the Read tool. `.md`/`.txt`/`.pdf` only — `.doc`/`.docx` cannot be read directly; report which file(s) need converting and STOP for those, but continue with the others if at least one is valid.
- Plain text, one feature description per line — each non-empty line is one feature.

Build a list of normalized requirement blocks: `[{name, source, content, origin_link}]`. `name` is a short slug derived from the ticket ID / file basename / first few words of the text line — used later for the worktree branch name and the report.

## Pha 1 — Brainstorm + Plan (sequential, gated)

For each feature in the list, **in order, one at a time**:

1. Invoke the `flow-brainstorm` skill with that feature's requirement block.
2. **Wait for explicit human approval** of the design before moving on. Never batch multiple approvals into one prompt — one feature's design, one approval, then proceed.
3. Invoke the `flow-plan` skill with the approved design.
4. **Wait for explicit human approval** of the plan.
5. Record `{name, planPath, repoPath}` for this feature once its plan is approved, then move to the next feature in the list.

Only once every feature in the list has an approved plan does Pha 2 begin. If a feature's brainstorm reveals it should be dropped or split, say so and adjust the list — do not silently carry a bad feature into Pha 2.

## Pha 2 — Execute (parallel, isolated, autonomous)

Once all plans are approved, call the `Workflow` tool with `args: { features: [{name, planPath, repoPath}, ...] }` (from Pha 1) and this exact script:

    export const meta = {
      name: 'flow-batch-execute',
      description: 'Execute approved flow plans for multiple features in parallel, one isolated worktree per feature',
      phases: [{ title: 'Execute' }],
    }

    const REPORT_SCHEMA = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PASS', 'FAIL'] },
        verifyRounds: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              round: { type: 'number' },
              command: { type: 'string' },
              result: { type: 'string', enum: ['PASS', 'FAIL'] },
              output: { type: 'string' },
            },
            required: ['round', 'command', 'result'],
          },
        },
        reviewFindings: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['status', 'verifyRounds', 'reviewFindings', 'summary'],
    }

    phase('Execute')

    function buildPrompt(f) {
      return `You are executing an approved implementation plan for feature "${f.name}", in repo ${f.repoPath}.

    Read the plan file at ${f.planPath} fully before starting.

    Execute its tasks in order exactly as written: test-first when a test runner exists, minimal implementation, run the test, commit — do not skip steps, do not add steps not in the plan. Never touch files outside what the plan's Files sections list. If the plan is missing something required to finish a task, stop and report it instead of inventing scope.

    After all tasks are done: read this project's CLAUDE.md to find its test/lint/build commands (never guess a command; if none is documented, say so). Run those commands via Bash and capture full output.

    If a command FAILs: read the failure output, fix the specific issue, re-run. Hard limit: 3 verify rounds total. If round 3 still FAILs, STOP — do not attempt a 4th fix — and report status FAIL with all 3 rounds' exact command and output.

    Once verify PASSes (status PASS), review your own diff adversarially, as if you did not write it: look specifically for logic edge cases, security issues (injection, auth bypass, secrets, unsafe deserialization), race conditions, and silent data loss that the tests likely do not cover. Report findings one per line as \`path:line: <severity> <problem>. <concrete failure scenario>.\` If you find nothing, say exactly "No issues found in reviewed scope." — do not manufacture a finding.

    Return your final report via the required structured output: status, every verify round with its command/result/output, your review findings text, and a one-paragraph summary of what was done.`
    }

    const results = await parallel(
      args.features.map(f => () =>
        agent(buildPrompt(f), { label: f.name, schema: REPORT_SCHEMA, isolation: 'worktree' })
          .then(r => ({ feature: f.name, ...r }))
      )
    )

    return { results: results.filter(Boolean) }

After the `Workflow` tool returns, print one line per feature: name, status, verify round count, review findings summary — do not soften a FAIL into something gentler. Tell the user which git worktree/branch holds each feature's result (the Workflow tool result includes this) so they can review and merge with `superpowers:finishing-a-development-branch` one branch at a time — never auto-merge.

## Hard rules

- Never start Pha 2 while any feature in the batch still lacks an approved plan.
- Never let Pha 2 wait for human input mid-run — if an agent reports it's blocked, that surfaces in its report, not as a live prompt.
- Never merge branches yourself after Pha 2 — only report and hand off to the user.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `ls "d:/Github/MinhTQ-SDLC/commands/flow-batch.md"`
Expected: file exists, size > 0.

- [ ] **Step 3: Smoke-test Pha 1 gating with a 2-feature text batch**

```bash
mkdir -p /tmp/flow-scratch/batch-repo && cd /tmp/flow-scratch/batch-repo
git init -q
mkdir -p src
cat > src/greet.js <<'EOF'
function greet(name) { return "Hello " + name; }
module.exports = { greet };
EOF
cat > CLAUDE.md <<'EOF'
# Scratch batch repo

## Test

Run: node -e "const {greet}=require('./src/greet'); if(typeof greet('x')!=='string'){process.exit(1)}; console.log('PASS');"
EOF
git add -A && git commit -q -m "init"
```

In this session, invoke `/flow-batch` with plain-text input, two lines:
```
Add an exclamation mark to greet() output
Add a farewell() function that returns "Bye " + name
```
against `/tmp/flow-scratch/batch-repo`.
Expected: the transcript shows feature 1's `flow-brainstorm` running and stopping for approval, **before** feature 2's `flow-brainstorm` starts at all (strict sequential order, not interleaved). After approving feature 1's design and plan, feature 2's `flow-brainstorm` begins. Pha 2 (the `Workflow` call) must not start until both features have an approved plan recorded.

- [ ] **Step 4: Smoke-test Pha 2 fan-out and the per-feature retry cap**

Continuing from Step 3 with both plans approved, let `/flow-batch` proceed to Pha 2.
Expected: the `Workflow` tool result contains one entry per feature with a `status` of `PASS` or `FAIL`, each with its own `verifyRounds` array (length ≤ 3), and each feature's changes exist in its own git worktree/branch (confirm via `git worktree list` in `/tmp/flow-scratch/batch-repo` showing 2 separate worktrees, one per feature). Confirm no single worktree contains both features' file changes.

- [ ] **Step 5: Commit**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add commands/flow-batch.md && git commit -m "feat: add /flow-batch command for parallel multi-feature execution"
```

---

## Self-Review Notes

- **Spec coverage:** 7.1 (input) → command's Arguments section. 7.2 (Pha 1 sequential+gated) → command's Pha 1 section + Step 3 smoke test. 7.3 (Pha 2 parallel+isolated+no cap) → command's Pha 2 script + Step 4 smoke test. 7.4 (output/manual merge) → command's post-Workflow reporting instructions. 7.5 (Workflow opt-in, worktree cost) → Global Constraints.
- **Placeholder scan:** the embedded Workflow script and command markdown contain literal, runnable content — no TBD, no "similar to Task N" (there is only one task).
- **Type/name consistency:** `flow-brainstorm`/`flow-plan` referenced by the exact names defined in the flow-core plan; `REPORT_SCHEMA` field names (`status`, `verifyRounds`, `reviewFindings`, `summary`) are self-contained to this one script, used consistently between the schema definition and the prompt's final-report instruction.
