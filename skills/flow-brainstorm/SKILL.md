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
7. **STOP and ask via `AskUserQuestion`.** Never end the turn on a plain prose question waiting for free-text "ok". Present the approval gate as an explicit choice, e.g.:
   - "Approve — proceed to flow-plan" (recommended)
   - "Request changes — describe what to adjust" (free text via the tool's built-in Other option)
   - "Reject — stop here"
   Do not proceed to `flow-plan` until "Approve" is selected. This gate is never skipped, regardless of how small the change looks.

## Hard rules

- Never invoke `flow-plan` or `flow-execute` yourself from inside this skill — the `/flow` command orchestrates the handoff after seeing approval.
- Never treat "the requirement looks complete" as a reason to skip asking about ambiguity you actually found — if you found it, ask it.
- If mid-brainstorm you discover the work is bigger than the initial classification (hidden complexity), say so and re-classify — never downgrade, only upgrade.
- Every clarifying question in Step 4 and the approval gate in Step 7 use `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply, so the human always gets an explicit choice to click instead of having to type a full sentence back.
