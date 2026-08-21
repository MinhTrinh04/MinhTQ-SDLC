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
2. **Wait for explicit human approval** of the design before moving on — `flow-brainstorm` asks this via `AskUserQuestion` with concrete options (Approve/Request changes/Reject), never a bare prose question. Never batch multiple features' approvals into one prompt — one feature's design, one approval, then proceed.
3. Invoke the `flow-plan` skill with the approved design.
4. **Wait for explicit human approval** of the plan — `flow-plan` asks this via `AskUserQuestion` the same way.
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
