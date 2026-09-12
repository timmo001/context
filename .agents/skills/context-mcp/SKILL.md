---
name: context-mcp
description: Use Context MCP tools for repository branches, working-tree changes, recent commits, pull requests, and tech stacks. Use for git_context, stack_context, command_help, and context resources, including client-prefixed names. For shell-based Context commands, use context-cli instead.
license: Apache-2.0
compatibility: Requires an enabled Context MCP server rooted in the target repository. Optional GitHub details require authenticated GitHub CLI access on the server.
---

# Context MCP

Use the Context MCP server when the workflow selects MCP tooling. Clients may prefix tool names with the server key, such as `context_git_context`.

1. Reuse current injected context when it already answers the task. Otherwise confirm that the MCP server's working directory is the intended repository: `git_context` does not accept a directory argument.
2. Choose the narrowest tool:
   - `git_context` returns branch metadata, working-tree state, recent commits, and pull request context. Request `diff`, `branchDiff`, `since`, `remotes`, or individual pull request fields only when needed. Set `pullRequest: false` to omit PR context.
   - `stack_context` detects languages, ecosystems, tooling, and frameworks. Set `dir` for a specific directory; otherwise it uses the server's working directory.
   - `command_help` returns CLI help. Set `name` to `git` or `stack` for command-specific help; use the advertised tool schema for MCP parameter names.
3. Use `context://git`, `context://stack`, or `context://command/{name}` when the client supports resources and the default snapshot or help is sufficient.
4. Report warnings, truncation, and missing data. Do not treat a partial response as a complete repository snapshot.

## Recent Commit Windows

Pass `since` as a string to `git_context`. It accepts ISO/RFC dates, epoch timestamps, and single Effect durations, including fractions and optional `ago`:

```json
{ "since": "1.5h", "pullRequest": false }
```

Other examples include `10m`, `2 days ago`, `500ms`, `500000 micros`, `500000000 nanos` and `2026-09-01T10:00:00Z`. Units include seconds, minutes, hours, days, weeks, millis, micros and nanos, with shorthand aliases `s`, `m`, `h`, `d`, `w`, `ms`, `us` and `ns`. Use one duration, such as `1.5h`, rather than `1h 30m`.

When a branch commit range is available, it takes precedence over `since`.

These tools are read-only. They do not authorise repository changes or replace an injection required by the calling workflow. If the MCP server is unavailable, report that and use `context-cli` only when CLI access is allowed.
