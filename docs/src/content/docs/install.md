---
title: Install
description: Install context from the AUR or build it locally with mise.
---

## Arch Linux

Install the `context-git` AUR package:

```bash
yay -S context-git
```

## Build Locally

Use the mise tasks to install dependencies and build the binary:

```bash
mise run install
mise run build
```

The compiled binary is written to `dist/context`.

## Build an Arch Package

Create a local Arch package from the compiled binary:

```bash
mise run package:arch
```

The package is written to `dist/`.
