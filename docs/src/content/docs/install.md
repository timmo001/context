---
title: Install
description: Install context from the AUR or build it locally with mise.
---

## Arch Linux

Install the `context-git` AUR package with an AUR helper:

```bash
yay -S context-git
```

`context-git` is a source package. It builds from the GitHub repository and installs the `context` binary plus Bash, Fish, and Zsh completions.

## Build Locally

Use the mise tasks to install dependencies and build the binary. The repo pins Node and Bun through mise.

```bash
mise run install
mise run build
```

The compiled binary is written to `dist/context`. Run it directly or put it somewhere on your `PATH`:

```bash
./dist/context --help
```

## Build an Arch Package

Create a local Arch package from the compiled binary:

```bash
mise run package:arch
```

This task is Arch-specific and needs `makepkg` from `base-devel`. The package is written to `dist/` and includes shell completions.
