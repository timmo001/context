---
name: context-cli
description: Use the context CLI to inspect repository branches, working-tree changes, recent commits, pull requests, and tech stacks. Use for context git, context stack, and shell-based repository snapshots. For Context MCP tool calls, use context-mcp instead.
license: Apache-2.0
compatibility: Requires the context CLI and shell access. Git snapshots require a Git repository; optional GitHub details require authenticated GitHub CLI access.
---

# Context CLI

Use `context` for deterministic repository snapshots. Run it from the target repository. Reuse current injected context when it already answers the task; do not repeat discovery solely to change transport.

## Repository Context

1. Run `context git` for branch identity, working-tree state, recent commits, and pull request context.
2. Add only the detail the task needs:
   - `--diff` for unstaged and staged contents.
   - `--branch-diff` for the merge-base diff against the default branch.
   - `--since "<date or duration>"` for a different recent-commit window.
   - `--remotes` for remote URLs.
   - `--comments`, `--reviews`, `--labels`, or `--checks` for specific pull request details.
   - `--no-pr` when pull request context is irrelevant.
3. Use `--json` when a consumer needs structured output. Check `context git --help` for the current options instead of guessing flags.
4. Report warnings, truncation, or missing GitHub data as limitations. A partial snapshot is not evidence that the missing information does not exist.

## Tech Stack

Use `context stack [directory]` for detected languages, ecosystems, tooling, and frameworks. Add `--json` for structured output or `--plain` for text without ANSI styling. The directory defaults to the working directory.

Keep full diffs out of routine discovery. These commands read context; they do not authorise repository changes or replace an injection required by the calling workflow.
