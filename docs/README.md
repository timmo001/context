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
- `bun run deploy` and `bun run deploy:preview` (deploy to Cloudflare Workers)

## Deployment

The site deploys to Cloudflare Workers through Workers Builds, as the `context-docs` Worker at `context.timmo.dev`. Workers Builds uses:

- Root directory: `docs`
- Production branch: `main`
- Build command: `bun run build`
- Deploy command: `bun run deploy`
- Non-production deploy command: `bun run deploy:preview`

The repository checkout remains available above the root directory so the generators can read `../src`. Generated docs stay committed.

`wrangler.jsonc` owns the Worker name, compatibility date and custom domain. Blume writes the deployable Worker and its assets to `dist/`, which the deploy commands point Wrangler at.

The hosted MCP server is at `/mcp`, so the MCP server guide lives at `/mcp/server`.
