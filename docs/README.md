# Context Docs

The [context](https://github.com/timmo001/context) documentation site, built with [Blume](https://github.com/haydenbleasel/blume) and [`@timmo001/docs-kit`](https://github.com/timmo001/groundwork/tree/main/packages/docs-kit).

## Commands

Run these commands from this `docs/` directory:

- `bun install`
- `bun run dev`
- `bun run build`
- `bun run check` (pages, links and types; `mise run docs:check` also regenerates the references and avoids a running dev server)
- `bun run brand` (regenerate the logo PNGs and the social preview)
- `bun run gen` (regenerate the CLI and MCP reference pages from the repository source)
- `bun run plan` (show what deploying the `prod` stage would change)
- `bun run deploy` (deploy the `prod` stage; build first, or use `mise run docs:deploy`)

## Deployment

The site's infrastructure is an [Alchemy](https://alchemy.run) stack in `alchemy.run.ts`: the `context-docs` Worker at `context.timmo.dev`, serving what `blume build` writes to `dist/`. The Deploy docs workflow deploys it on pushes to `main` that touch `docs/`, through the shared `deploy-alchemy.yml` workflow.

CI's Cloudflare token and the repository's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets come from `stacks/github.ts`. Deploy it once from a machine with `mise run docs:deploy:github`, and again to rotate the token.

Generated docs stay committed.

The hosted MCP server is at `/mcp`, so the MCP server guide lives at `/mcp/server`.
