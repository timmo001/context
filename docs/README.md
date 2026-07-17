# Context Docs

The [context](https://github.com/timmo001/context) documentation site, built with Astro and Starlight.

## Commands

Run these commands from this `docs/` directory:

- `bun install`
- `bun run dev`
- `bun run build`
- `bun run deploy` (deploy the built site to Cloudflare Workers)
- `bun run deploy:preview` (upload a preview version without promoting it)
- `bun run preview`
- `bun run gen` (regenerate the CLI and MCP reference pages from the repository source)

## Deployment

The site deploys to Cloudflare Workers as static assets. Workers Builds uses:

- Root directory: `docs`
- Production branch: `main`
- Build command: `bun run build`
- Deploy command: `bun run deploy`
- Non-production deploy command: `bun run deploy:preview`

The repository checkout remains available above the root directory so the generators can read `../src`. Generated docs stay committed, and the site metadata continues to use `https://context.timmo.dev`.

`wrangler.jsonc` owns the Worker name, compatibility date, custom domain, asset directory, and 404 behaviour. The site is fully static, so it does not use an Astro adapter or Worker code for page requests.
