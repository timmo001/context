---
title: OpenCode
description: How OpenCode integrations relate to context.
sidebar:
  order: 1
---

`context` owns the generic CLI and MCP server. OpenCode plugins are maintained outside this repo because they are part of the agent configuration layer.

The portable OpenCode config lives in [`timmo001/opencode-config`](https://github.com/timmo001/opencode-config). Dotfiles-specific integration notes live in the [dotfiles docs](https://dotfiles.timmo.dev/opencode/).

Those plugins should call:

```bash
context git --json
context stack --json
```

The `context` repo should not duplicate plugin internals. It documents only the CLI/MCP contracts those plugins consume.
