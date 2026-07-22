# 🧭 Context

Standalone CLI and MCP server for deterministic repository context.

`context` gives humans and agents one command for branch, stack, and tool
context. It provides a CLI for direct use and an MCP server for harnesses that
prefer tools and resources.

Full setup, CLI reference, MCP usage, and integration docs are published at <https://context.timmo.dev>.

Stable releases use a manually chosen `YYYYMMDD.N` version. Create a blank
GitHub draft, optionally generate its release notes, then publish it to build
Linux archives, deb and RPM packages, and update `context-bin` in the AUR.
`context-git` continues to track relevant changes on `main`.
Download stable assets from the [GitHub releases page](https://github.com/timmo001/context/releases).

For local development, run `mise run install` and `mise run build`, then use
`dist/context`.
