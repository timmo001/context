import { Cause, Context, Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer, Tool } from "effect/unstable/ai";
import { formatCommandError } from "../../lib/rows.js";

/** MCP tool annotations for a read-only, closed-world, idempotent tool. */
export const READONLY_HINTS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Read-only tool hints for operations that may access a remote service. */
export const READONLY_OPEN_WORLD_HINTS = {
  ...READONLY_HINTS,
  openWorldHint: true,
} as const;

type ReadonlyHints = typeof READONLY_HINTS | typeof READONLY_OPEN_WORLD_HINTS;

/** Options describing a single raw-text MCP tool registration. */
export interface ToolRegistration<
  S extends Schema.Codec<unknown, unknown, never, never>,
  E,
> {
  /** Tool name as exposed to MCP clients. */
  readonly name: string;
  /** Human-readable tool description. */
  readonly description: string;
  /** Effect schema for the tool's input parameters. */
  readonly parameters: S;
  /** Behavioural hints. */
  readonly annotations: ReadonlyHints;
  /** Handler returning raw text; failures render via Cause.pretty. */
  readonly handle: (params: S["Type"]) => Effect.Effect<string, E>;
}

/** Service for registering raw-text tools on the current MCP server. */
export interface ToolRegistrarService {
  readonly register: <
    S extends Schema.Codec<unknown, unknown, never, never>,
    E,
  >(
    options: ToolRegistration<S, E>,
  ) => Effect.Effect<void>;
}

/** Effect service bound to the current MCP server. */
export class ToolRegistrar extends Context.Service<
  ToolRegistrar,
  ToolRegistrarService
>()("ToolRegistrar") {
  static readonly layer = Layer.effect(
    ToolRegistrar,
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const register: ToolRegistrarService["register"] = (options) => {
        const decode = Schema.decodeEffect(options.parameters);
        return server.addTool({
          tool: new McpSchema.Tool({
            name: options.name,
            description: options.description,
            inputSchema: Tool.getJsonSchemaFromSchema(options.parameters),
            annotations: options.annotations,
          }),
          annotations: Context.empty(),
          handle: (payload) =>
            decode(payload).pipe(
              Effect.flatMap(options.handle),
              Effect.matchCause({
                onFailure: (cause) =>
                  new McpSchema.CallToolResult({
                    isError: true,
                    content: [
                      {
                        type: "text",
                        text: formatCommandError(Cause.squash(cause)),
                      },
                    ],
                  }),
                onSuccess: (text) =>
                  new McpSchema.CallToolResult({
                    isError: false,
                    content: [{ type: "text", text }],
                  }),
              }),
            ),
        });
      };
      return { register };
    }),
  );
}
