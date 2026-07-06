---
title: Command Reference
description: Every context command, flag and example, generated from the CLI registry.
sidebar:
  order: 2
---

<!-- Generated from src/cli/spec.ts by `mise run docs:gen:cli`. Do not edit by hand. -->

This page lists every `context` command, generated from the same registry that powers `context help`.

## `context git`

Show branch context for the current repository

```text
context git [options]
```

Print branch context for the current git repository: repository root, branch/base header, HEAD, ahead/behind state, pull request summary for feature branches, working-tree status, branch work-scope, recent commits, and optional full diffs.
Designed as a single command for agents to get full working-tree and branch context, and as the shared producer for the git_context MCP tool.

**Modes**

```text
(default)       Context summary: repo, branch, PR, status, branch files, commits
--json          Emit the structured branch-context payload
--diff          Also print full unstaged and staged diffs
--branch-diff   Also print the full diff vs the default branch
--remotes       Also include remote fetch/push URLs
--since <date>  Show recent commits since a date instead of the default window
```

**Options**

| Option                 | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `--json`               | Emit the structured plugin payload instead of text       |
| `--comments`           | Include pull request conversation comments               |
| `--reviews`            | Include individual pull request reviews                  |
| `--labels`             | Include pull request labels                              |
| `--checks`             | Include CI check runs (makes a second gh call)           |
| `--no-description`     | Omit the pull request description                        |
| `--no-pr`              | Omit the pull request block entirely                     |
| `--remotes`            | Include remote fetch/push URLs in branch metadata        |
| `--no-branch-metadata` | Omit the branch metadata block                           |
| `--no-status`          | Omit the working-tree status block                       |
| `--no-work-scope`      | Omit the branch work-scope block                         |
| `--diff`               | Append full unstaged and staged diffs for changed files  |
| `--branch-diff`        | Append the merge-base diff vs the default branch         |
| `--since` `<date>`     | Show recent commits since this date or relative duration |

**Examples**

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

## `context stack`

Detect the tech stack of a directory for agents

```text
context stack [dir] [options]
```

Detect a directory's tech stack deterministically from Git-listed files, with no LLM and no external tools: languages, package ecosystems, tooling, and frameworks.
Designed as a single command for agents to learn a project's stack, and as the shared producer for the stack_context MCP tool.

**Modes**

```text
(default)       Stack summary: languages, ecosystems, tooling, frameworks
--json          Emit the structured stack-context payload
--plain         Disable ANSI styling in text output
```

**Options**

| Option    | Description                                        |
| --------- | -------------------------------------------------- |
| `--json`  | Emit the structured plugin payload instead of text |
| `--plain` | Disable ANSI styling in text output                |

**Arguments**

| Argument | Description                                            |
| -------- | ------------------------------------------------------ |
| `<dir>`  | Directory to scan (default: current working directory) |

**Examples**

```bash
context stack
context stack --plain
context stack --json
context stack ~/projects/app
```

## `context opencode-debug`

Run OpenCode debug commands

```text
context opencode-debug [options]
```

Run OpenCode debug paths, config, skill, and info, returning one combined report. Optionally inspect a named agent.

**Options**

| Option             | Description                          |
| ------------------ | ------------------------------------ |
| `--agent` `<name>` | Also run opencode debug agent <name> |

**Examples**

```bash
context opencode-debug
context opencode-debug --agent reviewer
```

## `context mcp`

Run the context MCP server over stdio

```text
context mcp [options]
```

Start a Model Context Protocol server exposing git_context, stack_context, command_help, and opencode_debug tools plus read-only context resources.

**Examples**

```bash
context mcp
```

## `context completions`

Generate shell completions

```text
context completions [bash|fish|zsh]
```

Generate shell completions for context.

**Arguments**

| Argument  | Description                    |
| --------- | ------------------------------ |
| `<shell>` | One of: `bash`, `fish`, `zsh`. |

**Examples**

```bash
context completions zsh
context completions bash
context completions fish
```

## `context help`

Show context help

```text
context help [command]
```

**Arguments**

| Argument    | Description                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `<command>` | Optional command to show help for One of: `git`, `stack`, `opencode-debug`, `mcp`, `completions`. |

**Examples**

```bash
context help
context help git
```
