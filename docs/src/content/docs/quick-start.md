---
title: Quick Start
description: Run the core context CLI commands and MCP server.
---

Use `context git` to inspect the current repository state:

```bash
context git
context git --json
```

Use `context stack` to detect the repository stack:

```bash
context stack
context stack --json
```

Start the MCP server over stdio:

```bash
context mcp
```

The MCP server exposes the same producers through `git_context`, `stack_context`, `command_help`, and `opencode_debug` tools.

## Next Steps

- Read the [CLI overview](/cli/) for terminal usage.
- Read the [Git Context](/context/git/) and [Stack Context](/context/stack/) pages for producer details.
- Read the [MCP Server](/mcp/) page for agent integration.
