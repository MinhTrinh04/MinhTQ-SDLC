# Flow Batch Implementation Plan

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

### Task 1: `/flow-batch` command (added 2026-08-21)

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

## Self-Review Notes (Task 1)

- **Spec coverage:** 7.1 (input) → command's Arguments section. 7.2 (Pha 1 sequential+gated) → command's Pha 1 section + Step 3 smoke test. 7.3 (Pha 2 parallel+isolated+no cap) → command's Pha 2 script + Step 4 smoke test. 7.4 (output/manual merge) → command's post-Workflow reporting instructions. 7.5 (Workflow opt-in, worktree cost) → Global Constraints.
- **Placeholder scan:** the embedded Workflow script and command markdown contain literal, runnable content — no TBD, no "similar to Task N" (there is only one task).
- **Type/name consistency:** `flow-brainstorm`/`flow-plan` referenced by the exact names defined in the flow-core plan; `REPORT_SCHEMA` field names (`status`, `verifyRounds`, `reviewFindings`, `summary`) are self-contained to this one script, used consistently between the schema definition and the prompt's final-report instruction.

---

## Redesign: Immediate Per-Feature Dispatch (added 2026-08-21)

**Goal:** replace `/flow-batch`'s Pha 2 barrier model (`Workflow.parallel()`, wait for all plans approved) with an immediate per-feature dispatch model using the `Agent` tool directly (`isolation: "worktree"`, background by default), so execution starts on each feature the moment its plan is approved — no waiting for the rest of the batch.

**Approved design:** drop the `Workflow` tool entirely from `/flow-batch`; dispatch one `Agent` call per feature right after that feature's plan gate passes; main thread continues Pha 1 for the next feature without waiting; report each feature's result as its background notification arrives, not batched at the end.

**Spec:** [docs/flow/specs/2026-08-21-loop-engineering-flow-design.md](../specs/2026-08-21-loop-engineering-flow-design.md), Mục 7 (this plan updates 7.3 and 7.5).

---

### Task 2: Rewrite `commands/flow-batch.md` Pha 2 (added 2026-08-21)

**Files:**
- Modify: `commands/flow-batch.md`

**Interfaces:**
- Consumes: `flow-brainstorm`, `flow-plan` skills — unchanged, Pha 1 untouched except step 5's wording.
- Produces: per-feature `Agent` tool dispatch (`isolation: "worktree"`), replacing the old `Workflow` tool call.

- [ ] **Step 1: Replace the frontmatter description**

Old:
```
description: Run flow-brainstorm+flow-plan sequentially (gated) for a batch of features, then fan flow-execute out in parallel, one isolated worktree per feature, via the Workflow tool.
```
New:
```
description: Run flow-brainstorm+flow-plan sequentially (gated) for a batch of features; as soon as each feature's plan is approved, immediately dispatch it to execute+verify+review in the background, one isolated worktree per feature, via the Agent tool.
```

- [ ] **Step 2: Rewrite Pha 1 step 5 and the paragraph after it**

Old:
```
5. Record `{name, planPath, repoPath}` for this feature once its plan is approved, then move to the next feature in the list.

Only once every feature in the list has an approved plan does Pha 2 begin. If a feature's brainstorm reveals it should be dropped or split, say so and adjust the list — do not silently carry a bad feature into Pha 2.
```
New:
```
5. The moment this feature's plan is approved, immediately dispatch it into Pha 2 (below) — do not wait for any other feature in the list. Then move on to the next feature's brainstorm.

If a feature's brainstorm reveals it should be dropped or split, say so and adjust the list before dispatching it — never dispatch a bad feature into Pha 2 just to keep the loop moving.
```

- [ ] **Step 3: Replace the entire Pha 2 section (heading through the closing paragraph)**

Replace everything from `## Pha 2 — Execute (parallel, isolated, autonomous)` through the old `After the Workflow tool returns...` paragraph with:

```markdown
## Pha 2 — Execute (immediate dispatch, isolated, autonomous, background)

As soon as a feature's plan is approved in Pha 1 (step 5 above), call the `Agent` tool for that single feature — do not batch this call, do not wait for other features. Pass `isolation: "worktree"`. Do not pass `run_in_background: false` — the `Agent` tool runs subagents in the background by default, so this call returns immediately and the main thread proceeds straight to the next feature's Pha 1 loop.

The Agent's prompt (fill in `name`, `planPath`, `repoPath` for this one feature):

    You are executing an approved implementation plan for feature "{name}", in repo {repoPath}.

    Read the plan file at {planPath} fully before starting.

    Execute its tasks in order exactly as written: test-first when a test runner exists, minimal implementation, run the test, commit — do not skip steps, do not add steps not in the plan. Never touch files outside what the plan's Files sections list. If the plan is missing something required to finish a task, stop and report it instead of inventing scope.

    After all tasks are done: read this project's CLAUDE.md to find its test/lint/build commands (never guess a command; if none is documented, say so). Run those commands via Bash and capture full output.

    If a command FAILs: read the failure output, fix the specific issue, re-run. Hard limit: 3 verify rounds total. If round 3 still FAILs, STOP — do not attempt a 4th fix — and report status FAIL with all 3 rounds' exact command and output.

    Once verify PASSes (status PASS), review your own diff adversarially, as if you did not write it: look specifically for logic edge cases, security issues (injection, auth bypass, secrets, unsafe deserialization), race conditions, and silent data loss that the tests likely do not cover. Report findings one per line as `path:line: <severity> <problem>. <concrete failure scenario>.` If you find nothing, say exactly "No issues found in reviewed scope." — do not manufacture a finding.

    Return your final report as plain text in exactly this shape, in this order, with no extra commentary before or after it:

    STATUS: PASS or FAIL

    VERIFY ROUNDS:
    Round 1: command=<exact command> result=PASS/FAIL
    output: <full output>
    Round 2: (same shape, only if round 1 failed)
    Round 3: (same shape, only if round 2 failed)

    REVIEW FINDINGS:
    <one finding per line as specified above, or "No issues found in reviewed scope.">

    SUMMARY:
    <one paragraph describing what was done>

    Also state which git worktree path and branch name hold your changes.

Each dispatched Agent's completion arrives later as a background task-notification, independently of the others and independently of how far Pha 1 has progressed for remaining features. The moment a notification arrives for a feature, report it to the user right away — name, status, verify round count, review findings summary, worktree/branch — do not hold it back or batch it together with other features' results, and do not soften a FAIL into something gentler. Tell the user to review and merge with `superpowers:finishing-a-development-branch` one branch at a time — never auto-merge.
```

- [ ] **Step 4: Rewrite the "Hard rules" section**

Old:
```
## Hard rules

- Never start Pha 2 while any feature in the batch still lacks an approved plan.
- Never let Pha 2 wait for human input mid-run — if an agent reports it's blocked, that surfaces in its report, not as a live prompt.
- Never merge branches yourself after Pha 2 — only report and hand off to the user.
```
New:
```
## Hard rules

- Never dispatch a feature's Pha 2 Agent call before that specific feature's plan is approved — other features in the batch may still be earlier in Pha 1 at that moment, and that's fine.
- Never wait for a dispatched Agent to finish before continuing Pha 1 for the next feature — the dispatch call must not block the main thread.
- Never let a dispatched Agent wait for human input mid-run — if it reports it's blocked, that surfaces in its final report, not as a live prompt.
- Never batch multiple features' completion reports together — report each one to the user as soon as its background notification arrives.
- Never merge branches yourself after a feature's Pha 2 completes — only report and hand off to the user.
```

- [ ] **Step 5: Verify no leftover references**

Run: `grep -niE "Workflow|parallel\(|REPORT_SCHEMA|schema:" "d:/Github/MinhTQ-SDLC/commands/flow-batch.md"`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add commands/flow-batch.md
```
(commit happens together with Task 3 in Step 3 below, one commit for the whole redesign)

---

### Task 3: Update spec Mục 7.3 and 7.5 (added 2026-08-21)

**Files:**
- Modify: `docs/flow/specs/2026-08-21-loop-engineering-flow-design.md`

**Interfaces:** prose-only; must stay consistent with Task 1's new command behavior.

- [ ] **Step 1: Replace section 7.3**

Old:
```
### 7.3 Pha 2 — Execute (song song, tự động, cách ly)

- Mỗi feature được cấp 1 git worktree + branch riêng (tránh N feature đụng file nhau khi
  sửa chung 1 working tree).
- Dùng Workflow tool: `parallel()` N lời gọi `agent()`, mỗi agent chạy trọn
  `flow-execute` + retry loop với `verifier` (tối đa 3 vòng, đúng Mục 1) + `reviewer` bắt buộc,
  trên đúng plan đã duyệt của feature đó, `isolation: 'worktree'`.
- Không giới hạn concurrency cứng — để Workflow tool tự cap theo `min(16, CPU-2)`, feature thừa
  tự xếp hàng chờ slot trống. Phù hợp quy mô 3-5 feature nêu ra ban đầu; nếu batch lớn hơn nhiều,
  Workflow tự nhiên giãn thời gian chứ không tràn tài nguyên.
- Không dừng chờ duyệt giữa chừng trong pha này (đã duyệt xong ở Pha 1, đúng nguyên tắc chỉ
  duyệt ở 2 điểm design/plan).
```
New:
```
### 7.3 Pha 2 — Execute (dispatch ngay khi duyệt xong, tự động, cách ly, chạy nền)

- Không chờ hết cả batch duyệt xong rồi mới bắt đầu. Ngay khi 1 feature duyệt xong plan (kết
  thúc vòng Pha 1 của riêng feature đó), dispatch feature đó ngay lập tức bằng `Agent` tool —
  main thread không chờ agent này chạy xong mà tiếp tục Pha 1 cho feature kế tiếp trong danh
  sách batch.
- Mỗi feature được cấp 1 git worktree + branch riêng qua `isolation: "worktree"` (tham số
  `Agent` tool hỗ trợ trực tiếp) — tránh N feature đụng file nhau khi sửa chung 1 working tree.
- Agent chạy nền theo mặc định của `Agent` tool (không cần truyền cờ bật nền — chỉ cần không
  truyền cờ tắt nền) — main thread rảnh tay ngay sau lời gọi dispatch.
- Prompt của mỗi agent là bản gộp hướng dẫn của `flow-execute` + retry loop với `verifier`
  (tối đa 3 vòng, đúng Mục 1) + `reviewer` bắt buộc, trên đúng plan đã duyệt của feature đó.
  Agent tự thực hiện cả 3 vai trò trong 1 lời gọi (không có `schema` output — báo cáo cuối là
  plain text theo đúng khuôn: status PASS/FAIL, từng vòng verify với command/result/output,
  review findings, summary).
- Không giới hạn concurrency cứng — mỗi feature dispatch độc lập ngay khi sẵn sàng, không có
  điểm chờ hàng loạt (đây khác biệt cốt lõi so với mô hình `parallel()`/barrier cũ).
- Không dừng chờ duyệt giữa chừng trong pha này (đã duyệt xong ở Pha 1, đúng nguyên tắc chỉ
  duyệt ở 2 điểm design/plan).
- Kết quả mỗi feature về sau dưới dạng background task-notification, đến lúc nào báo lúc đó cho
  người dùng — không gom lại chờ hết cả batch xong mới báo cáo tổng hợp một lần.
```

- [ ] **Step 2: Replace section 7.5**

Old:
```
### 7.5 Ràng buộc cần biết

- Gọi Workflow tool thật sự (không chỉ thiết kế) cần người dùng opt-in rõ bằng lời ở lượt gọi đó
  (từ khoá "ultracode", hoặc yêu cầu trực tiếp "dùng workflow/multi-agent") — đây là hành vi
  runtime của harness, không phải giới hạn thiết kế, nhưng cần nhớ khi thực thi `/flow-batch`.
- `isolation: 'worktree'` tốn thời gian setup + disk mỗi agent — hợp lý cho batch vài feature,
  không nên dùng cho batch hàng chục feature nhỏ lẻ.
```
New:
```
### 7.5 Ràng buộc cần biết

- Pha 2 dùng thẳng `Agent` tool (không dùng `Workflow` tool nữa kể từ bản thiết kế lại này) —
  ràng buộc opt-in bằng lời trước đây cho `Workflow` tool (từ khoá "ultracode" hoặc yêu cầu
  trực tiếp "dùng workflow/multi-agent") **không còn áp dụng** cho `/flow-batch`, vì command
  không còn gọi `Workflow` ở bất kỳ đâu.
- `isolation: 'worktree'` tốn thời gian setup + disk mỗi agent — hợp lý cho batch vài feature,
  không nên dùng cho batch hàng chục feature nhỏ lẻ.
- Vì mỗi feature dispatch độc lập ngay khi duyệt xong (không có điểm barrier chờ cả batch), báo
  cáo hoàn thành của các feature có thể đến không theo thứ tự — người dùng cần đọc từng thông
  báo nền riêng lẻ thay vì đợi một báo cáo tổng hợp cuối cùng duy nhất.
```

- [ ] **Step 3: Commit both files together**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add commands/flow-batch.md docs/flow/specs/2026-08-21-loop-engineering-flow-design.md && git commit -m "refactor: /flow-batch Pha 2 dispatches per-feature via Agent tool immediately, no more Workflow barrier"
```

---

### Task 4: Mark the superseded historical plan (traceability only) (added 2026-08-21)

**Files:**
- Modify: `docs/flow/plans/flow-batch-plan.md` (historically the standalone file `2026-08-21-flow-batch-plan.md`; now merged into this file as Task 1 above)

**Interfaces:** none — this is a documentation-only addition, does not change any behavior.

- [ ] **Step 1: Add a superseded note at the very top of the file**

Insert immediately after the `# Flow Batch Implementation Plan` heading:

```markdown
> **Superseded (2026-08-21):** this plan's Pha 2 design (Workflow.parallel() barrier) was
> replaced by an immediate per-feature Agent-tool dispatch model. See
> [flow-batch-plan.md](flow-batch-plan.md) (this same file's Redesign section, formerly `2026-08-21-flow-batch-pipeline-redesign-plan.md`)
> and spec Mục 7.3/7.5 for the current design. This file stays as the historical record of what
> was originally built (commit `13885b2`) — do not edit its body to match the new design.
```

- [ ] **Step 2: Commit**

```bash
cd "d:/Github/MinhTQ-SDLC" && git add docs/flow/plans/flow-batch-plan.md && git commit -m "docs: mark original flow-batch plan as superseded by pipeline redesign"
```

---

## Self-Review Notes (Tasks 2-4)

- **Spec coverage:** approved design's every clause maps to Task 1 (command rewrite) + Task 2 (spec rewrite). The historical-drift flag from the planner survey is resolved by Task 3 rather than left silent.
- **Placeholder scan:** all replacement text is literal, copy-pasteable; no TBD.
- **Type/name consistency:** `Agent` tool name, `isolation: "worktree"` parameter name, and the plain-text report shape (`STATUS`/`VERIFY ROUNDS`/`REVIEW FINDINGS`/`SUMMARY`) are used identically across Task 1's command text and Task 2's spec prose.
