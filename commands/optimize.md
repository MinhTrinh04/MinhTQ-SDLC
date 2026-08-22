---
description: Benchmark a target, brainstorm 2-3 optimization approaches (never auto-picking one), let the human choose, execute the chosen approach, then re-benchmark and keep or revert based on the result.
---

# /optimize

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description + acceptance criteria). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the requirement.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available on the machine, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the description of what to optimize.

No other input form is supported — do not guess the source from the argument's shape.

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized requirement block: `{source, content, origin_link}`.
2. Read the target repo's `CLAUDE.md` for a `## Benchmark` section documenting the exact measurement command.
   - If found: use that command verbatim, then follow the **quantitative path** — proceed exactly as Steps 3-10 below.
   - If absent: ask the user via `AskUserQuestion` — "Vấn đề này có đo được bằng số không?" — with options:
     - "Có — tôi sẽ nhập lệnh đo": capture the exact benchmark/measure command via the tool's built-in free-text "Other" option. Never guess or infer one from `package.json` scripts or anything else. Then follow the **quantitative path** from Step 3 onward, using the captured command wherever "the benchmark command" is referenced below.
     - "Không — đây là vấn đề định tính (kiến trúc/code quality/maintainability)": follow the **qualitative path** — skip Step 3 entirely and continue at Step 4, using the qualitative wording given there.
3. *(Quantitative path only — skipped entirely on the qualitative path.)* Run the benchmark command, record the baseline output/number verbatim.
4. Invoke the `flow-brainstorm` skill with the requirement block, with this explicit override in the invocation instructions:
   - **Quantitative path:** "Always produce 2-3 approaches with trade-offs, regardless of classification (spike/bounded/architectural) — do not default to a single approach for a 'bounded' change; performance/structure trade-offs are always a human call, never auto-select one."
   - **Qualitative path:** "Always produce 2-3 approaches with trade-offs, regardless of classification (spike/bounded/architectural) — do not default to a single approach for a 'bounded' change; frame every trade-off qualitatively — complexity, maintainability, extensibility/future flexibility, migration risk/cost — never in benchmark numbers; this is always a human call, never auto-select one."

   Either wording overrides `flow-brainstorm`'s own Step 5 default of "Bounded: one concrete approach."
5. Wait for `flow-brainstorm`'s own approval gate (its own `AskUserQuestion`, Approve/Request changes/Reject) confirming the *set of approaches* is sound — this is not yet the "pick one" gate.
6. Once approved, present the 2-3 approaches to the human via a **separate** `AskUserQuestion` call, one option per approach, for them to pick exactly one. Do not proceed until one is explicitly selected.
7. Synthesize a minimal plan file from the chosen approach only (same pattern as `/fix-feature`: no `flow-plan` stage here), write it to `docs/flow/plans/YYYY-MM-DD-optimize-<slug>-plan.md`, stating plainly it was auto-synthesized from the chosen approach, not a `flow-plan` output.
8. **Record the current commit before touching anything**: run `git rev-parse HEAD` in the target repo and keep that SHA as `<pre-execute-sha>` — Step 10's revert depends on this value on both paths; do not skip it even on the qualitative path, where there is no benchmark to fall back on if the human decides to revert.
9. Invoke `flow-execute` with that plan file's path to implement the chosen approach only. `flow-execute` internally dispatches `verifier` (retry ≤3) and, on PASS, the mandatory `reviewer` subagent — both unchanged, on either path.
10. Branch on which path is active:
    - **Quantitative path:** re-run the exact same benchmark command from Step 2/3. Compare to baseline.
      - If NOT better: revert `flow-execute`'s commit(s) using the `<pre-execute-sha>` recorded in Step 8 — `git revert <pre-execute-sha>..HEAD` if the branch has already been pushed/shared, or `git reset --hard <pre-execute-sha>` if it's still local/unshared. Report the optimization was reverted, with the before/after numbers shown plainly.
      - If better: keep it. Report before/after numbers.
    - **Qualitative path:** there is no re-measure step. `flow-execute`'s final report already includes `reviewer`'s findings (per `skills/flow-execute/SKILL.md` Steps 5-6) — reuse those, never dispatch `reviewer` a second time against the same diff. Present those findings to the human via a **new, separate** `AskUserQuestion` — "Giữ thay đổi này hay revert?" — with options "Giữ — approve" / "Revert".
      - If "Revert": use the same `<pre-execute-sha>` revert mechanism as the quantitative branch — `git revert <pre-execute-sha>..HEAD` if pushed/shared, `git reset --hard <pre-execute-sha>` if local/unshared.
      - If "Giữ — approve": report `reviewer`'s findings (already produced by `flow-execute`) verbatim and state plainly that the change is kept.

## Hard rules

- Never guess the benchmark command on the quantitative path — if `## Benchmark` is absent from the target repo's `CLAUDE.md` and the human confirms the problem is measurable, always ask via `AskUserQuestion` for the exact command; never infer one from `package.json` scripts or anything else.
- Never let `flow-brainstorm` collapse to one approach here, even for a "bounded" classification — this command always needs 2-3 with trade-offs, on either path.
- Never auto-select an approach — the human must pick via `AskUserQuestion`, every time, on either path.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never keep a change that benchmarks worse than baseline on the quantitative path — always revert and say so plainly.
- On the qualitative path, never dispatch `reviewer` a second time — reuse the findings `flow-execute` already produced (it mandates `reviewer` after `verifier` PASS); with no number to fall back on, that review is the only check before the keep/revert decision.
- On the qualitative path, never auto-keep or auto-revert — always present `reviewer`'s findings and let the human choose via the "Giữ — approve" / "Revert" `AskUserQuestion`, since there's no number to decide by.
