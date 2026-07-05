---
title: MCP Tool Reference
description: Generated reference for the context MCP tools.
sidebar:
  order: 2
---

<!-- Generated from src/mcp/toolMetadata.ts by `mise run docs:gen:mcp`. Do not edit by hand. -->

## `git_context`

Concise branch context for the current repository, with optional PR detail, remote URLs, working-tree diffs, and merge-base branch diff.

CLI equivalent: `context git`

| Parameter     | Type    | Default | CLI                     | Description                                                                       |
| ------------- | ------- | ------- | ----------------------- | --------------------------------------------------------------------------------- |
| `diff`        | boolean | false   | `--diff`                | Append the full unstaged and staged diffs beneath each working-tree section.      |
| `branchDiff`  | boolean | false   | `--branch-diff`         | Append the full merge-base diff of the current branch against the default branch. |
| `comments`    | boolean | false   | `--comments`            | Include pull request conversation comments.                                       |
| `reviews`     | boolean | false   | `--reviews`             | Include individual pull request reviews.                                          |
| `labels`      | boolean | false   | `--labels`              | Include pull request labels.                                                      |
| `checks`      | boolean | false   | `--checks`              | Include CI check runs.                                                            |
| `description` | boolean | true    | `omit --no-description` | Include the pull request description.                                             |
| `pullRequest` | boolean | true    | `omit --no-pr`          | Include the pull request block at all.                                            |
| `remotes`     | boolean | false   | `--remotes`             | Include remote fetch/push URLs in branch metadata.                                |
| `since`       | string  |         | `--since <date>`        | Only include recent commits after this date.                                      |

## `stack_context`

Deterministic tech-stack summary for a directory: languages, ecosystems, tooling, and frameworks.

CLI equivalent: `context stack`

| Parameter | Type   | Default | CLI     | Description                                                             |
| --------- | ------ | ------- | ------- | ----------------------------------------------------------------------- |
| `dir`     | string |         | `[dir]` | Directory to scan. Omit to scan the server's current working directory. |

## `command_help`

Show context CLI help. Omit name for the full command overview, or pass a command name to scope help.

CLI equivalent: `context help [name]`

| Parameter | Type   | Default | CLI      | Description                        |
| --------- | ------ | ------- | -------- | ---------------------------------- |
| `name`    | string |         | `[name]` | Optional command to scope help to. |

## `opencode_debug`

Run OpenCode debug commands and return their combined output. Optionally inspect a configured agent by name.

CLI equivalent: `context opencode-debug`

| Parameter | Type   | Default | CLI              | Description                     |
| --------- | ------ | ------- | ---------------- | ------------------------------- |
| `agent`   | string |         | `--agent <name>` | Optional agent name to inspect. |
