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
- Update order: `context` source -> `skills` import -> skills `main` -> `dot update`.
- After an authorised source commit and push, run `./dist/skill-maintenance import context-cli --apply` in the skills checkout. Review and validate the imported snapshot and its `imports.json` revision before committing and pushing skills.
- Then run `dot update`, which fetches the latest skills `main` and installs the new snapshot. Each commit or push still requires user authorisation.

## Background Dev Servers

- Start the docs dev server with `mise run serve:docs`, which runs it through Pitchfork in the background and restarts it if it exits or stops responding. Do not run `mise run docs:dev` or `astro dev` in the foreground from an agent.
- Use `mise run serve:docs:status`, `mise run serve:docs:logs`, `mise run serve:docs:restart` and `mise run serve:docs:stop` to manage it.
- The daemon is configured in `pitchfork.toml`. It serves `http://127.0.0.1:7890/`, or the next free port, and is always at `https://docs.context.localhost` through the Pitchfork proxy.
- Test through that HTTPS address, in the browser, with curl and anywhere else. Never add the proxy's own port, such as `:8443`, even if Pitchfork prints one: that means the 443 redirect is missing (it's lost on reboot), so run `pitchfork proxy doctor`, then `pitchfork proxy setup -y` to restore it. Use the `127.0.0.1` port only when the proxy isn't running.

## Validation

Run these after source changes. Regenerate first, because the generators rewrite docs that `format:check` and the docs build read:

```bash
mise run docs:gen
mise run check ::: test ::: build ::: docs:build
```
