/**
 * @file Git branch and tech-stack context as an Effect library.
 *
 * {@link gitContext} and {@link stackContext} return the same bounded JSON
 * payloads as `context git --json` and `context stack --json`.
 * {@link ContextLayer.make} provides the services they need for one working
 * directory, so a host can run them in-process.
 */
export * from "./context.js";

export * from "./git/context/build.js";

export * from "./git/context/model.js";

export * from "./git/context/pullRequest.js";

export * from "./git/context/renderJson.js";

export * from "./git/context/renderText.js";

export * from "./git/services/GitHub.js";

export * from "./lib/ansi.js";

export * from "./lib/env.js";

export * from "./services/CommandExecutor.js";

export * from "./stack/context/detect.js";

export * from "./stack/context/manifestParsers.js";

export * from "./stack/context/model.js";

export * from "./stack/context/renderJson.js";

export * from "./stack/context/renderText.js";
