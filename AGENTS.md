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
- Keep portable Context skills under `.agents/skills/`, with separate `context-cli` and `context-mcp` workflows. Keep harness-specific integrations in their owning repositories.
- Regenerate generated docs with `mise run docs:gen` after changing CLI or MCP metadata.
- Do not hand-edit generated docs pages.
- Keep OpenCode plugin docs out of this repo except for links to `timmo001/opencode-config` or dotfiles integration notes at <https://dotfiles.timmo.dev/opencode/>.

## Skill Ownership And Updates

- This repository owns `.agents/skills/context-cli/SKILL.md` and `.agents/skills/context-mcp/SKILL.md`.
- `timmo001/skills` imports only `context-cli` as an unchanged snapshot. Edit the source here, not the imported or installed copy. `context-mcp` remains available from this repository for explicit MCP use.
- Update order: `context` source -> `skills` import -> dotfiles skills submodule -> `dot stow`.
- After an authorised source commit and push, run `./dist/skill-maintenance import context-cli --apply` in the skills checkout. Review and validate the imported snapshot and its `imports.json` revision before committing and pushing skills.
- Then advance `agents/.agents/skills` in dotfiles to that skills commit, commit the pointer with any companion command changes, and run `dot stow`. Each commit or push still requires user authorisation.

## Docs Dev Server

- Use `mise run docs:dev:serve` to start the Astro docs dev server in background mode.
- Use `mise run docs:dev:status`, `mise run docs:dev:logs`, and `mise run docs:dev:stop` to inspect or stop it.
- Use `mise run docs:dev` only when foreground server output is explicitly needed.

## Validation

Run these after source changes:

```bash
mise run check
mise run build
mise run docs:gen
mise run docs:build
```
