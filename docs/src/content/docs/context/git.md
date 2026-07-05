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

The text output includes repository identity, branch/base refs, ahead/behind state, working-tree file lists with line counts, branch changed files, recent commits with pushed/local markers, and an optional pull request block.

`--json` emits the structured payload consumed by OpenCode context plugins. Full diffs from `--diff` and `--branch-diff` are text-only and are intentionally omitted from JSON.

## Pull Requests

On a feature branch, `context git` attempts to read the pull request with `gh pr view`. The PR lookup is resilient: missing `gh`, a missing PR, or network errors do not fail the command. Extra PR sections are opt-in with `--comments`, `--reviews`, `--labels`, and `--checks`.

## Full Diffs

Use `--diff` for unstaged and staged diffs. Use `--branch-diff` for the merge-base diff against the default branch. `--branch-diff` errors on the default branch because there is no feature branch range to show.
