---
title: OpenCode
description: How OpenCode integrations relate to context.
sidebar:
  order: 1
---

`context` owns the generic CLI and MCP server. OpenCode plugins are maintained outside this repo because they are part of the agent configuration layer.

The OpenCode plugins live in [`timmo001/dotfiles`](https://github.com/timmo001/dotfiles), with integration notes in the [dotfiles docs](https://dotfiles.timmo.dev/opencode/).

Those plugins should call:

```bash
context git --json
context stack --json
```

The `context` repo should not duplicate plugin internals. It documents only the CLI/MCP contracts those plugins consume.
