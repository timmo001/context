---
name: docs-kit
description: Use @timmo001/docs-kit to set up or change a timmo001 documentation site. Apply when creating a Blume docs site, editing its blume.config.ts, components.ts or theme.css, changing the home banner or header GitHub link, or generating share cards, social previews, logo PNGs or Apple touch icons from a site's SVG logo.
compatibility: Requires Bun or Node with @timmo001/docs-kit. The blume entry point requires the Blume version in the package's peerDependencies; brand images use sharp.
---

# Docs Kit

Use `@timmo001/docs-kit` for the parts every docs site shares. Keep content,
sidebars, logos, illustrations and reference generators in the site.

## Read the current contract

Check the site's manifest and lockfile for the installed docs-kit and Blume
versions, then read the installed package README and exports. If they differ
from the [README](https://github.com/timmo001/docs-kit/blob/main/packages/docs-kit/README.md)
on `main`, follow the installed release.

## Set up or change a site

1. Install with `bun add -E @timmo001/docs-kit`, matching the package's Blume
   peer version.
2. Build `blume.config.ts` with `docsConfig` from `@timmo001/docs-kit/blume`,
   passing `title`, `description`, `site`, `github` and the sidebar. Only set
   other options where the site differs from the defaults the README lists.
3. Import the components directly in `components.ts`. Blume reads that file
   without running it, so re-exports or helper functions there won't work.
4. Start `theme.css` with `@import "@timmo001/docs-kit/blume/theme.css";`. Put
   site overrides, such as the `--home-banner-*` properties, after it.
5. Generate brand images with `writeBrandImages` from a site script rather than
   a copied generator. Commit the PNGs it writes. Remind the user that GitHub's
   social preview needs a manual upload.

## Change the package

Make shared changes in the [docs-kit repository](https://github.com/timmo001/docs-kit)
rather than copying files into one site. Check a component, theme or config
change by building a site against a packed tarball: linked installs break
Astro's style compilation.

## Verify

Run the site's own checks and a strict build. When the banner, header or theme
changed, check the built home page has the banner and header link, and that
the theme rules are in the CSS.
