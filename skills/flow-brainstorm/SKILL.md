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
   - Architectural: sectioned design, written in **Vietnamese** (technical jargon — SOLID, API, REST, class/function names, code snippets, exact commands, file paths — stays in English/as-is; this is code-switching, not translation). This rule applies only to spec doc *content* — never to any `commands/*.md`/`skills/*/SKILL.md` file the design describes creating elsewhere. Check whether `docs/flow/specs/<topic>-design.md` already exists for this topic (glob by topic/feature name, not date). If it exists, append this design as a new dated section at the end of that SAME file instead of creating a new one — even if the existing file is in English (predates this rule), append the new section in Vietnamese, do not translate the rest. If it doesn't exist yet, create `docs/flow/specs/<topic>-design.md` (no date in the filename). **Do not commit yet** — that only happens after Step 7's approval, below.
7. For the architectural path, the spec file is on disk but **not yet committed** at this point — the human is reviewing what was just presented/printed, same content as the file. **STOP and ask via `AskUserQuestion`.** Never end the turn on a plain prose question waiting for free-text "ok". Present the approval gate as an explicit choice. The "Approve" option's label must name whatever the caller's actual next step is — do not hardcode "proceed to flow-plan": if the invoking command skips `flow-plan` (e.g. it synthesizes its own plan and hands off straight to `flow-execute`, as `/fix-feature`/`/optimize` do), say "Approve — proceed" or name that actual next step instead. Example for the normal `/flow` case:
   - "Approve — proceed to flow-plan" (recommended)
   - "Request changes — describe what to adjust" (free text via the tool's built-in Other option)
   - "Reject — stop here"
   Do not proceed until "Approve" is selected. This gate is never skipped, regardless of how small the change looks.
   - **"Approve" (architectural path only — Bounded/Spike never wrote a file to begin with):** only now run `git add`/`git commit` for the spec file.
   - **"Request changes" (architectural path):** revise the file content in place (still uncommitted), re-present, ask again.
   - **"Reject" (architectural path):** stop here. Leave the file on disk, uncommitted — do not delete it and do not commit it under any circumstance.

## Hard rules

- Never create a new dated spec file for a topic that already has one — append a new dated section to the existing `docs/flow/specs/<topic>-design.md` instead.
- Never invoke `flow-plan` or `flow-execute` yourself from inside this skill — the `/flow` command orchestrates the handoff after seeing approval.
- Never treat "the requirement looks complete" as a reason to skip asking about ambiguity you actually found — if you found it, ask it.
- If mid-brainstorm you discover the work is bigger than the initial classification (hidden complexity), say so and re-classify — never downgrade, only upgrade.
- Every clarifying question in Step 4 and the approval gate in Step 7 use `AskUserQuestion` with concrete options — never a bare prose question expecting free-text reply, so the human always gets an explicit choice to click instead of having to type a full sentence back.
- Never commit the architectural spec file before "Approve" is selected — write it, present it, ask, only then commit. A "Request changes" or "Reject" response must never result in a commit.
- Never write new spec doc content in English — Vietnamese prose with English technical jargon where natural, for any file created from this point forward. Never retroactively translate an existing English spec file when appending a new section to it.
