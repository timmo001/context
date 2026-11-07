---
title: OpenCode
description: How OpenCode integrations relate to context.
sidebar:
  order: 1
---

`context` owns the generic CLI, MCP server and OpenCode plugin.

## Plugin

The OpenCode plugin in `opencode-plugin/` adds a `context` Code Mode namespace, so an agent can read the session repository's branch context and tech stack in one script. Load it from the repository:

```json
{
  "plugins": ["github:timmo001/context#main::path:opencode-plugin"]
}
```

It reads its tools from `context agent tools --json` and runs each with `context agent call` in the session's directory, so they always match the `context` on your `PATH`. Both tools only read.

## CLI

Other integrations can call the CLI directly:

```bash
context git --json
context stack --json
```
