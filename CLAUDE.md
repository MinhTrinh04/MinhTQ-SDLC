# CLAUDE.md

This repo has no application source code — it's a Claude Code global config repo (spec docs, `agents/`, `commands/`, `skills/` for the `/flow` family, junction-linked into `~/.claude/` on the main worktree). "Test" here means: no placeholder text slipped into any shipped prompt file. This check applies the same way on any branch/worktree — a feature branch legitimately adding new files is not a failure.

## Test

Run:
```
bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'
```

Expected on a healthy repo: `PASS`, exit code 0.
- The `grep` finds any leftover placeholder wording in the three shipped-prompt directories (docs/plans are excluded on purpose — those may legitimately discuss what a placeholder looks like, as this very file does).

## Note (not part of the Test command — informational only, main worktree only)

`~/.claude/agents`, `~/.claude/commands`, `~/.claude/skills` are Windows directory junctions (`mklink /J`) pointing at this repo's `agents/`, `commands/`, `skills/` folders (per README Mục 1.5) — that's how edits here show up in Claude Code without copying. This is a main-worktree setup detail, not a per-branch pass/fail condition: a feature branch/worktree is a separate git checkout and is expected to differ from the main worktree's junctioned content until merged. If you ever suspect the junctions themselves are broken (edits in the repo not showing up in Claude Code), check manually with:
```
diff -rq agents "$HOME/.claude/agents" && diff -rq commands "$HOME/.claude/commands" && diff -rq skills "$HOME/.claude/skills"
```
run from the main worktree only.
