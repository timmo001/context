/**
 * The Code Mode surface. `context agent tools --json` describes each tool,
 * and `context agent call <tool>` runs one with its input as JSON on stdin,
 * in the current directory, so the OpenCode plugin in `opencode-plugin/` only
 * needs the binary, and its tools always match it.
 */
import {
  ContextLayer,
  gitContext,
  stackContext,
} from "@timmo001/effect-context";
import { Duration, Effect, Schema } from "effect";
import { resolve } from "node:path";

/** Why a Code Mode call failed. */
export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  message: Schema.String,
}) {}

const JsonObject = Schema.Record(Schema.String, Schema.Json);

const isJsonObject = Schema.is(JsonObject);

const decodeJson = Schema.decodeUnknownSync(Schema.Json);

const timeout = Duration.minutes(2);

const jsonSchemaOf = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });

  return decodeJson(
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions },
  );
};

const optionalBoolean = (description: string) =>
  Schema.optionalKey(Schema.Boolean).annotate({ description });

const GitInput = Schema.Struct({
  comments: optionalBoolean("Include pull request conversation comments"),
  reviews: optionalBoolean("Include individual pull request reviews"),
  labels: optionalBoolean("Include pull request labels"),
  checks: optionalBoolean("Include CI check runs (makes a second gh call)"),
  noDescription: optionalBoolean("Omit the pull request description"),
  noPr: optionalBoolean("Omit the pull request block entirely"),
  remotes: optionalBoolean(
    "Include remote fetch and push URLs in branch metadata",
  ),
  noBranchMetadata: optionalBoolean("Omit the branch metadata block"),
  noStatus: optionalBoolean("Omit the working-tree status block"),
  noWorkScope: optionalBoolean("Omit the branch work-scope block"),
  since: Schema.optionalKey(Schema.String).annotate({
    description:
      "Show recent commits since this date or relative duration, such as 2 days ago",
  }),
});

const StackInput = Schema.Struct({
  dir: Schema.optionalKey(Schema.String).annotate({
    description:
      "Directory to inspect, relative to the current directory (default: the current directory)",
  }),
});

interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly pinned: boolean;
  readonly input: Schema.Json;
  readonly call: (text: string) => Effect.Effect<string, AgentError>;
}

const tool = <I, IE, A>(definition: {
  readonly name: string;
  readonly description: string;
  readonly pinned?: boolean;
  readonly input: Schema.Codec<I, IE>;
  readonly run: (input: I, cwd: string) => Effect.Effect<A, Error>;
}): AgentTool => {
  const decode = Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.toCodecJson(definition.input)),
  );

  return {
    name: definition.name,
    description: definition.description,
    pinned: definition.pinned ?? false,
    input: jsonSchemaOf(definition.input),
    call: (text) =>
      Effect.gen(function* () {
        const input = yield* decode(text.trim() === "" ? "{}" : text, {
          onExcessProperty: "error",
          errors: "all",
        }).pipe(
          Effect.mapError(
            (error) =>
              new AgentError({ message: `Invalid input: ${error.message}` }),
          ),
        );

        const result = yield* definition.run(input, process.cwd()).pipe(
          Effect.mapError(
            (error) => new AgentError({ message: error.message }),
          ),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(
                new AgentError({ message: `${definition.name} timed out` }),
              ),
          }),
        );

        return JSON.stringify(result, null, 2);
      }),
  };
};

/** Every Code Mode tool, in the order the catalogue lists them. */
export const agentTools: ReadonlyArray<AgentTool> = [
  tool({
    name: "git",
    description:
      "Branch context for the current repository: branch and base, HEAD, ahead/behind, pull request, working-tree status, branch work scope and recent commits.",
    pinned: true,
    input: GitInput,
    run: (input, cwd) =>
      gitContext({
        cwd,
        comments: input.comments ?? false,
        reviews: input.reviews ?? false,
        labels: input.labels ?? false,
        checks: input.checks ?? false,
        description: !(input.noDescription ?? false),
        pullRequest: !(input.noPr ?? false),
        remoteDetails: input.remotes ?? false,
        branchMetadata: !(input.noBranchMetadata ?? false),
        status: !(input.noStatus ?? false),
        workScope: !(input.noWorkScope ?? false),
        since: input.since,
      }).pipe(Effect.provide(ContextLayer.make({ cwd }))),
  }),
  tool({
    name: "stack",
    description:
      "Deterministic tech-stack summary for a directory: languages, ecosystems, tooling and frameworks.",
    input: StackInput,
    run: (input, cwd) =>
      stackContext({ root: resolve(cwd, input.dir ?? ".") }).pipe(
        Effect.provide(ContextLayer.make({ cwd })),
      ),
  }),
];

/** The tool names `agent call` accepts. */
export const toolNames = agentTools.map(({ name }) => name);

/** The Code Mode manifest. The tools need only git, so they're always available. */
export const manifest = () => ({
  available: true,
  tools: agentTools.map((entry) => ({
    name: entry.name,
    argv: ["agent", "call", entry.name],
    description: entry.description,
    access: "read",
    alwaysAsk: false,
    pinned: entry.pinned,
    timeoutMillis: Duration.toMillis(timeout),
    json: true,
    stdin: true,
    input: isJsonObject(entry.input) ? entry.input : {},
  })),
});

/** Run one tool with its JSON input and return its JSON result. */
export const call = Effect.fn("agentCall")(function* (
  name: string,
  text: string,
) {
  const entry = agentTools.find((candidate) => candidate.name === name);

  if (entry === undefined) {
    return yield* new AgentError({ message: `No tool ${name}` });
  }

  return yield* entry.call(text);
});
