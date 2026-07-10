---
title: Stack Context
description: Deterministic tech-stack detection for a directory.
sidebar:
  order: 2
---

`context stack` detects a repository's tech stack from Git-listed files with no LLM and no external scanners.

```bash
context stack
context stack --plain
context stack --json
context stack ~/projects/app
```

Detection uses `git ls-files --cached --others --exclude-standard --deduplicate`, respects Git ignore rules, and excludes known generated and vendored directory segments even when they are tracked. It returns a warning instead of a partial guess when the target is not a readable Git worktree. It reads bounded regular-file manifests without following symlinks, classifies known config and lockfile paths, and takes an extension/filename census. It reports:

- Languages with top general locations.
- Package ecosystems from manifests.
- Tooling from lockfiles, config files, and declared dependencies.
- Frameworks from declared dependencies.

`--json` emits the structured payload consumed by agent integrations. The JSON renderer caps list lengths and individual values so large repositories cannot inflate prompts unexpectedly.

The scanner is intentionally bounded. It records structured `truncations` for file-list bytes, depth, file count, manifest reads, collected evidence, and renderer output. Each record identifies the limit and includes observed or omitted counts when they are known.

Dependencies are parsed from their declared sections in `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, requirements files, `Pipfile`, and conservative literal lists in `setup.py`. Comments and unrelated manifest text are not treated as dependency evidence.
