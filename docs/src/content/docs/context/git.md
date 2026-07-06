---
title: Git Context
description: Branch, pull request, working-tree, and commit context for agents.
sidebar:
  order: 1
---

`context git` prints a compact snapshot of the current Git repository. It replaces separate calls to `git status`, `git diff --stat`, `git diff --cached --stat`, `git log --oneline --stat`, `git log @{upstream}..HEAD`, and selected `gh pr` commands.

```bash
context git
context git --comments --reviews
context git --labels --checks
context git --remotes
context git --diff
context git --branch-diff
context git --json
context git --since "2 days ago"
```

The text output includes repository identity, branch/base refs, ahead/behind state, working-tree file lists with line counts, branch changed files, recent commits with pushed/local markers, and an optional pull request block. The default remote is chosen from `upstream`, then `origin`, then the first configured remote. HTTP remote credentials are stripped before remote URLs are printed.

`--json` emits the structured payload consumed by OpenCode context plugins. Full diffs from `--diff` and `--branch-diff` are text-only and are intentionally ignored for JSON output.

## Recent Commits

On a feature branch, `context git` lists commits unique to the branch. On the default branch, it lists today's commits, capped at 20, but still shows at least the last 10 commits when there are fewer commits today.

Use `--since <date>` on the default branch to replace that default recent-commit window with a date or relative duration. Feature branches keep the branch-only commit range so the snapshot stays scoped to the branch.

## Sections

Use `--no-pr`, `--no-description`, `--no-branch-metadata`, `--no-status`, and `--no-work-scope` to omit sections when a smaller snapshot is needed.

## Pull Requests

On a feature branch, `context git` attempts to read the pull request with `gh pr view`. The PR lookup is resilient: missing `gh`, a missing PR, or network errors do not fail the command. Extra PR sections are opt-in with `--comments`, `--reviews`, `--labels`, and `--checks`.

## Full Diffs

Use `--diff` for unstaged and staged diffs. Use `--branch-diff` for the merge-base diff against the default branch. `--branch-diff` errors on the default branch because there is no feature branch range to show.
