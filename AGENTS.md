# context agents

This repo contains the standalone `context` CLI and MCP server.

## Stack

- Runtime and package manager: Bun.
- Language: TypeScript.
- Effects and services: Effect v4.
- Docs: Astro + Starlight under `docs/`.
- Task runner: mise.

## Rules

- Keep code at the repo root under `src/`.
- Keep CLI metadata in `src/cli/spec.ts`; help and generated docs consume it.
- Regenerate generated docs with `mise run docs:gen` after changing CLI or MCP metadata.
- Do not hand-edit generated docs pages.
- Keep OpenCode plugin docs out of this repo except for links to `timmo001/opencode-config` or dotfiles docs.

## Validation

Run these after source changes:

```bash
mise run check
mise run build
mise run docs:gen
mise run docs:build
```
