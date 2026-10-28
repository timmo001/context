import { Cause, Context, Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer, Tool } from "effect/ai";
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

type Codec = Schema.Codec<unknown, unknown>;

interface BaseToolRegistration<S extends Codec> {
  /** Tool name as exposed to MCP clients. */
  readonly name: string;
  /** Human-readable tool description. */
  readonly description: string;
  /** Effect schema for the tool's input parameters. */
  readonly parameters: S;
  /** Behavioural hints. */
  readonly annotations: ReadonlyHints;
}

/** A tool that returns raw text only. */
export interface TextToolRegistration<
  S extends Codec,
  E,
> extends BaseToolRegistration<S> {
  readonly success?: undefined;
  /** Handler returning raw text; failures render via Cause.pretty. */
  readonly handle: (params: S["Type"]) => Effect.Effect<string, E>;
}

/** A tool that returns raw text plus structured content typed by `success`. */
export interface TypedToolRegistration<
  S extends Codec,
  O extends Codec,
  E,
> extends BaseToolRegistration<S> {
  /** Effect schema for the structured result; it becomes the `outputSchema`. */
  readonly success: O;
  /** Handler returning the text and the structured value it was rendered from. */
  readonly handle: (
    params: S["Type"],
  ) => Effect.Effect<
    { readonly text: string; readonly structured: O["Type"] },
    E
  >;
}

/** Options describing a single MCP tool registration. */
export type ToolRegistration<S extends Codec, E, O extends Codec = never> =
  TextToolRegistration<S, E> | TypedToolRegistration<S, O, E>;

/** Service for registering tools on the current MCP server. */
export interface ToolRegistrarService {
  readonly register: <S extends Codec, E, O extends Codec = never>(
    options: ToolRegistration<S, E, O>,
  ) => Effect.Effect<void>;
}

interface ToolOutput {
  readonly text: string;
  readonly structured?: Schema.Json;
}

function isTyped<S extends Codec, E, O extends Codec>(
  options: ToolRegistration<S, E, O>,
): options is TypedToolRegistration<S, O, E> {
  return options.success !== undefined;
}

function toolOutput<S extends Codec, E, O extends Codec>(
  options: ToolRegistration<S, E, O>,
): (params: S["Type"]) => Effect.Effect<ToolOutput, unknown> {
  if (!isTyped(options)) {
    const { handle } = options;

    return (params) => handle(params).pipe(Effect.map((text) => ({ text })));
  }

  const { handle } = options;
  const encode = Schema.encodeEffect(Schema.toCodecJson(options.success));

  return (params) =>
    handle(params).pipe(
      Effect.flatMap(({ text, structured }) =>
        encode(structured).pipe(
          Effect.map((json) => ({ text, structured: json })),
        ),
      ),
    );
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
        const output = toolOutput(options);

        return server.addTool({
          tool: new McpSchema.Tool({
            name: options.name,
            description: options.description,
            inputSchema: Tool.getJsonSchemaFromSchema(options.parameters),
            outputSchema:
              options.success === undefined
                ? undefined
                : Tool.getJsonSchemaFromSchema(options.success),
            annotations: options.annotations,
          }),
          annotations: Context.empty(),
          handle: (payload) =>
            decode(payload).pipe(
              Effect.flatMap(output),
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
                onSuccess: ({ text, structured }) =>
                  new McpSchema.CallToolResult({
                    isError: false,
                    content: [{ type: "text", text }],
                    structuredContent: structured,
                  }),
              }),
            ),
        });
      };

      return { register };
    }),
  );
}
