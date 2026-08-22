# CLAUDE.md

This repo has no application source code — it's a Claude Code global config repo (spec docs, `agents/`, `commands/`, `skills/` for the `/flow` family, junction-linked into `~/.claude/`). "Test" here means: no placeholder text slipped into any shipped prompt file, and the junctions into `~/.claude/` are actually in sync with this repo (not broken/stale).

## Test

Run:
```
bash -c 'fail=0; grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && fail=1; for d in agents commands skills; do diff -rq "$d" "$HOME/.claude/$d" || fail=1; done; if [ "$fail" = 1 ]; then echo FAIL; exit 1; else echo PASS; fi'
```

Expected on a healthy repo: `PASS`, exit code 0.
- The `grep` finds any leftover placeholder wording in the three shipped-prompt directories (docs/plans are excluded on purpose — those may legitimately discuss what a placeholder looks like, as this very file does).
- The `diff -rq` loop confirms `~/.claude/agents`, `~/.claude/commands`, `~/.claude/skills` are junctions actually pointing at this repo's `agents/`, `commands/`, `skills/` and staying in sync — if they diverge (junction broken, stale copy, manual edit only on one side), this fails.
