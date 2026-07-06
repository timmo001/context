---
title: Shell Completions
description: Generate shell completions for context.
sidebar:
  order: 3
---

`context` can print completion scripts for Bash, Fish, and Zsh:

```bash
context completions
context completions bash
context completions fish
context completions zsh
```

With no shell argument, `context completions` prints Zsh completions. The Arch packages install Bash, Fish, and Zsh completions automatically. For a local binary, write the generated script into the shell-specific completion directory for your environment.
