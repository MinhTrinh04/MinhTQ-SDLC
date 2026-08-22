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
   - If found: use that command verbatim.
   - If absent: STOP and ask the user via `AskUserQuestion` for the exact benchmark/measure command. Never guess or infer one from `package.json` scripts or anything else.
3. Run the benchmark command, record the baseline output/number verbatim.
4. Invoke the `flow-brainstorm` skill with the requirement block, with this explicit override in the invocation instructions: "Always produce 2-3 approaches with trade-offs, regardless of classification (spike/bounded/architectural) — do not default to a single approach for a 'bounded' change; performance/structure trade-offs are always a human call, never auto-select one." This overrides `flow-brainstorm`'s own Step 5 default of "Bounded: one concrete approach."
5. Wait for `flow-brainstorm`'s own approval gate (its own `AskUserQuestion`, Approve/Request changes/Reject) confirming the *set of approaches* is sound — this is not yet the "pick one" gate.
6. Once approved, present the 2-3 approaches to the human via a **separate** `AskUserQuestion` call, one option per approach, for them to pick exactly one. Do not proceed until one is explicitly selected.
7. Synthesize a minimal plan file from the chosen approach only (same pattern as `/fix-feature`: no `flow-plan` stage here), write it to `docs/flow/plans/YYYY-MM-DD-optimize-<slug>-plan.md`, stating plainly it was auto-synthesized from the chosen approach, not a `flow-plan` output.
8. **Record the current commit before touching anything**: run `git rev-parse HEAD` in the target repo and keep that SHA as `<pre-execute-sha>` — Step 9's revert depends on this value existing; do not skip it even though nothing else uses it yet.
9. Invoke `flow-execute` with that plan file's path to implement the chosen approach only.
10. Re-run the exact same benchmark command from Step 2/3. Compare to baseline.
    - If NOT better: revert `flow-execute`'s commit(s) using the `<pre-execute-sha>` recorded in Step 8 — `git revert <pre-execute-sha>..HEAD` if the branch has already been pushed/shared, or `git reset --hard <pre-execute-sha>` if it's still local/unshared. Report the optimization was reverted, with the before/after numbers shown plainly.
    - If better: keep it. Report before/after numbers.

## Hard rules

- Never guess the benchmark command — if `## Benchmark` is absent from the target repo's `CLAUDE.md`, always ask via `AskUserQuestion`.
- Never let `flow-brainstorm` collapse to one approach here, even for a "bounded" classification — this command always needs 2-3 with trade-offs.
- Never auto-select an approach — the human must pick via `AskUserQuestion`, every time.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
- Never keep a change that benchmarks worse than baseline — always revert and say so plainly.
