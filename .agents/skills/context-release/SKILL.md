---
name: context-release
description: Version and release the context CLI and its library, @timmo001/effect-context. Use when bumping versions, preparing or publishing a GitHub release, or debugging the Package stable release workflow.
license: Apache-2.0
compatibility: Requires mise, Bun and the GitHub CLI from the context repository root.
---

# Releasing context

One semver version covers the CLI and `@timmo001/effect-context`. Publishing a non-prerelease GitHub release runs `.github/workflows/release.yml`. It builds the Linux archives, deb and RPM packages, publishes `@timmo001/effect-context` to npm and JSR through OIDC with no tokens, builds `context-bin` for the `timmo` pacman repository, attaches it to the release and updates it in the AUR. Prereleases publish nothing. `context-git` follows `main` on its own.

## Bump the version

The npm and JSR jobs fail unless the release tag matches every manifest exactly, with no `v` prefix. The release validation also rejects anything that isn't `X.Y.Z`. Set the same version in:

- `package.json`
- `packages/effect-context/package.json` and `packages/effect-context/jsr.json`
- `pkgver` in `.scripts/linux/PKGBUILD.bin` and the placeholder in `.scripts/linux/PKGBUILD` (the release rewrites the first, `pkgver()` the second, but keep them current)

Run `bun install` to refresh `bun.lock`, then run the checks from `AGENTS.md` before committing.

Keep `epoch=1` in `PKGBUILD.bin`. Releases used `YYYYMMDD.N` tags before 1.0.0, and without the epoch pacman sees semver as a downgrade.

Releasing is a public publish you can't undo. Commit, push and create the release only when the user asks, and use their chosen version. Create the release with `gh release create <version> --generate-notes`; a failed run can be retried with the workflow's `release-version` dispatch input.

## Registries

Both registries are already set up: the npm package trusts `release.yml` and the JSR package is linked to this repository. A new package under `packages/` needs the same before its first release, which is the `npm-jsr-first-publish` skill's job.
