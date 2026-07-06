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

Detection uses `git ls-files --cached --others --exclude-standard --deduplicate`, respects Git ignore rules, and returns a warning instead of a partial guess when the target is not a readable Git worktree. It reads package manifests when dependency or package-manager data is needed, classifies known config and lockfile paths, and takes an extension/filename census. It reports:

- Languages with top general locations.
- Package ecosystems from manifests.
- Tooling from lockfiles, config files, and declared dependencies.
- Frameworks from declared dependencies.

`--json` emits the structured payload consumed by agent integrations. The JSON renderer caps list lengths so large repositories cannot inflate prompts unexpectedly.

The scanner is intentionally bounded. It only considers readable files within the configured scan depth and stops after the configured file cap, marking the result as truncated when the cap is reached.
