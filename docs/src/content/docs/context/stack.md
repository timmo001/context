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

Detection uses `git ls-files --cached --others --exclude-standard`, reads manifests and config files, and takes an extension/filename census. It reports:

- Languages with top general locations.
- Package ecosystems from manifests.
- Tooling from lockfiles, config files, and declared dependencies.
- Frameworks from declared dependencies.

`--json` emits the structured payload consumed by agent integrations. The JSON renderer caps list lengths so large repositories cannot inflate prompts unexpectedly.
