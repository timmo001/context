import { Effect, Layer, Logger } from "effect";
import { NodeStdio } from "@effect/platform-node";
import { McpServer } from "effect/unstable/ai";
import { registerContextResources } from "./resources/context.js";
import { registerContextTools } from "./tools/context.js";

const SERVER_NAME = "context";
const SERVER_VERSION = "0.1.0";

const registerAll = Effect.gen(function* () {
  yield* registerContextTools;
  yield* registerContextResources;
});

/** Fully composed MCP server layer. */
export const McpServerLayer = Layer.effectDiscard(registerAll).pipe(
  Layer.provide(
    McpServer.layerStdio({ name: SERVER_NAME, version: SERVER_VERSION }),
  ),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
);
