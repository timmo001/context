---
title: Shell Completions
description: Generate shell completions for context.
sidebar:
  order: 3
---

`context` can print completion scripts for Bash, Fish, and Zsh:

```bash
context completions bash
context completions fish
context completions zsh
```

The dotfiles setup stores generated completion files in its stow source so they are installed with `dot stow`. Package builds can also install the generated scripts directly into the shell-specific completion directories.
