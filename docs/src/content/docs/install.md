---
title: Install
description: Install context from the AUR or build it locally with mise.
---

## Arch Linux

Install the stable binary package with an AUR helper:

```bash
yay -S context-bin
```

Install `context-git` instead to track relevant changes on `main`:

```bash
yay -S context-git
```

Both packages install the `context` binary plus Bash, Fish, and Zsh completions.

Stable releases use a manually chosen `YYYYMMDD.N` version. Create a blank
GitHub draft, optionally generate its release notes, then publish it to build
Linux archives, deb and RPM packages and update `context-bin`.

## Runtime Requirements

Release binaries are standalone and do not require Bun, Node.js, or npm
packages at runtime. `context` uses these external commands:

- `git` is required for Git and stack context.
- `gh` is optional. It adds GitHub pull request context when available; missing
  `gh`, a missing pull request, or a network error does not fail the command.

## Release Assets

Download stable archives, deb packages, and RPM packages from the
[GitHub releases page](https://github.com/timmo001/context/releases). Archives
contain the standalone `context` executable. Deb, RPM, and AUR packages also
install Bash, Fish, and Zsh completions.

Install a downloaded deb or RPM package with your system package manager:

```bash
sudo apt install ./context_VERSION_ARCH.deb
sudo dnf install ./context-VERSION-1.ARCH.rpm
```

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
