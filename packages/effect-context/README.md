# @timmo001/effect-context

Git branch and tech-stack context as an [Effect](https://effect.website) library, from [context](https://github.com/timmo001/context). It returns the same bounded JSON as `context git --json` and `context stack --json`, without running the CLI. Early development: the API will change before 1.0.

## Install

```bash
bun add @timmo001/effect-context effect @effect/platform-node
npm install @timmo001/effect-context effect @effect/platform-node
npx jsr add @timmo001/effect-context
```

`effect` and `@effect/platform-node` are peer dependencies, so install the versions your app uses. Git context needs `git` and the GitHub CLI (`gh`) on the `PATH`.

## Usage

```ts
import {
  ContextLayer,
  gitContext,
  stackContext,
} from "@timmo001/effect-context";
import { Effect } from "effect";

const cwd = "/path/to/repository";

const context = await Effect.all({
  git: gitContext({ cwd, checks: true }),
  stack: stackContext({ root: cwd }),
}).pipe(Effect.provide(ContextLayer.make({ cwd })), Effect.runPromise);
```

`ContextLayer.make` runs every `git` and `gh` command in `cwd`, so provide one layer per directory.

## Licence

Apache 2.0. See [LICENSE](https://github.com/timmo001/context/blob/main/LICENSE).
