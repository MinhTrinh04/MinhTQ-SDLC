---
description: Write a schema migration (up + down), run it against a shadow/staging DB (never production), verify data integrity, roll it back, and confirm the schema returns to its exact prior state — with no auto-retry on any failure.
---

# /migration-safe

Arguments: `$ARGUMENTS` — one of:
- `--jira <ID>` — fetch the ticket via the Jira/Atlassian MCP connector (title + description of the schema change). If that MCP is not authorized, say so plainly and STOP — do not fall back to guessing the change.
- `--file <path>` — read the file via the Read tool.
  - `.md` / `.txt` / `.pdf`: read directly.
  - `.doc` / `.docx`: these cannot be read directly. Tell the user to convert to `.md` or `.pdf` first (or, if `pandoc` is available on the machine, offer to convert it), then STOP — do not attempt to parse it as text.
- Bare text: use it verbatim as the description of the schema change.

No other input form is supported — do not guess the source from the argument's shape.

This is a **high-risk, DB-touching command**. Every rule in this file is absolute, not a suggestion. There is deliberately **no retry loop** — unlike every other flow-* command, a failure here means STOP, not "try again."

## Orchestration

1. Parse `$ARGUMENTS` for exactly one of the three forms above. Build the normalized change block: `{source, content, origin_link}`.
2. **Step 1 — Locate the shadow DB (mandatory before anything else).** Read the target repo's `CLAUDE.md` for a `## Shadow Database` section documenting the shadow/staging DB connection info.
   - If found: use that connection info verbatim, and only that.
   - If absent: STOP and ask the user via `AskUserQuestion` directly for the shadow/staging DB connection info. Never guess. Never use the first connection string found anywhere in the codebase, env files, or config. Never assume any DB is "probably safe" because of its name (e.g. a DB named `staging` or `dev` is not automatically safe — only the one the human documents or confirms is).
   - Do not write the raw connection string/credentials into any record-keeping file produced by this command — hold it only in-session for the steps below.
   - Do not proceed past this step without an explicit, human-confirmed-or-documented shadow DB source.
3. **Step 2 — Determine the target repo's migration tooling.** Check the target repo's `CLAUDE.md`/config for a documented migration framework/tool and its exact commands (e.g. how to write a migration file, how to run up/down, how to dump/introspect the current schema). This command is tool-agnostic — do not assume Prisma, Knex, Rails, Django, or raw SQL.
   - If the tooling and its schema-dump command are documented: use them verbatim.
   - If undocumented: STOP and ask the user via `AskUserQuestion` for (a) the migration tool/commands and (b) the exact command to dump/introspect the current schema in a diffable text form. Never infer a tool from file extensions or folder names alone.
4. **Capture the pre-migration schema.** Run the schema-dump command from Step 2 against the shadow DB from Step 1, and save its output verbatim (in-session) as `<schema-before>`. This is the baseline Step 6 compares against.
5. Synthesize a minimal plan file (skipping both the requirement-discovery stage and the design-approval stage of the full pipeline — same inline-synthesis pattern as `/fix-feature`) describing only: the up migration file to create, the down migration file to create, using the target repo's documented migration tool conventions from Step 2. Write it to `docs/flow/plans/YYYY-MM-DD-migration-safe-<slug>-plan.md`, where `<slug>` is derived from the first few words of the change description, lowercased, with every character other than `a-z`, `0-9`, and `-` stripped or replaced with `-` (collapse repeats) — never pass raw input text into a file path unsanitized. State plainly in the file that it was auto-synthesized by `/migration-safe`, not put through the full pipeline's human design-approval gate, and that it covers file-writing only (no execution).
6. Invoke the `flow-execute` skill with that plan file's path, with this explicit override instruction: "Write ONLY the up and down migration files described in the plan. Do NOT run any migration. Do NOT dispatch the automated pass/fail-check subagent or the adversarial code-review subagent. Do NOT run the normal execute-loop check/review steps — this invocation ends once the files are written and committed." This is a deliberate deviation from `flow-execute`'s normal process; `/migration-safe` supplies its own check logic in the steps below.
7. **Step 3 — Run the UP migration.** Run the up migration written in Step 6 against the shadow DB from Step 1 only. Never run it against any other DB, and never against production under any circumstance.
8. **Step 4 — Verify data integrity.** After the up migration: (a) record row counts for every affected table and compare against expectations from the change description; (b) run the target repo's FK constraint checks (via its migration tool's own check command if documented, otherwise a direct query listing FK violations). If either check shows a discrepancy, treat it as a failure and go straight to Step 7 below — do not continue to Step 5.
9. **Step 5 — Run the DOWN migration.** Run the down migration from Step 6 against that SAME shadow DB (never a different one).
10. **Step 6 — Compare schemas.** Run the same schema-dump command from Step 2/4 against the shadow DB again, producing `<schema-after-rollback>`. Compare it against `<schema-before>` from Step 4 **structurally** (i.e., using the migration tool's own schema-diff/introspection output, not a raw file byte-diff, since dump ordering/whitespace/timestamps can differ without the schema itself differing) — the structural diff must show zero differences. If the target repo's tooling has no structural diff and only supports a raw text dump, then the comparison is byte-for-byte on that raw dump text. State plainly in the final report which comparison mode was used.
11. **Step 7 — Any failure in Steps 3-6 stops everything immediately.** If the up migration errors, if data integrity checks fail, if the down migration errors, or if the schema comparison in Step 6 shows any difference: STOP IMMEDIATELY, print the exact failing step and its raw output, state plainly that the change is BLOCKED from merge. Do **not** auto-retry. Do **not** auto-fix the migration files and try again. Do **not** loop back to Step 6/7/8/9/10 a second time. Report to the human and end the command here.
12. If Steps 3-6 all succeed: report PASS with the up/down migration file paths, the row-count/FK check results, and confirmation the post-rollback schema matched the pre-migration schema exactly (with which comparison mode was used, per Step 10).

## Hard rules

- Never proceed past Step 1 (locating the shadow DB) without an explicit, human-confirmed-or-documented source — no guessing, no "first connection string found," no assuming a DB is safe by name.
- Never write raw DB credentials/connection strings into the record-keeping plan file or any other committed file.
- Never run any step of this command against production, under any framing.
- Never auto-drop anything on a real/production DB.
- Never assume a specific migration tool/framework — always read it from the target repo's own `CLAUDE.md`/config, and ask via `AskUserQuestion` if undocumented.
- Never let `flow-execute` run its own check/review loop for this command — it is invoked for file-writing only; the automated pass/fail-check subagent and the adversarial code-review subagent are never dispatched by `/migration-safe`.
- Never retry automatically after a Step 3-6 failure — this is the one flow-* command with deliberately no retry loop. STOP, warn plainly, block merge, and end.
- Never invent a Jira ID or file content if the fetch/read fails — stop and report the actual error.
