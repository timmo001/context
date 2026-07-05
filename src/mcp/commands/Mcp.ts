import { Cause, Exit, Layer, Runtime } from "effect";
import { McpServerLayer } from "../server.js";

/** Treat client disconnect/interruption as a clean MCP server exit. */
export const mcpTeardown: Runtime.Teardown = (exit, onExit) =>
  Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
    ? Runtime.defaultTeardown(exit, onExit)
    : onExit(0);

/** The stdio MCP server effect. */
export const mcpServer = Layer.launch(McpServerLayer);
