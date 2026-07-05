/** JSON-schema-ish property metadata for docs and MCP parameter schemas. */
export interface McpParameterMetadata {
  /** Parameter type label. */
  readonly type: "boolean" | "string";
  /** Human-readable parameter description. */
  readonly description: string;
  /** Whether the parameter is required. */
  readonly required?: boolean;
  /** CLI equivalent, when there is one. */
  readonly cli?: string;
  /** Default value description. */
  readonly default?: string;
}

/** MCP tool metadata used by docs generation. */
export interface McpToolMetadata {
  /** Tool name as exposed over MCP. */
  readonly name: string;
  /** Human-readable tool description. */
  readonly description: string;
  /** Equivalent CLI invocation. */
  readonly cli: string;
  /** Parameter metadata keyed by input property name. */
  readonly parameters: Readonly<Record<string, McpParameterMetadata>>;
}

/** Context MCP tool metadata, kept in sync with the registered schemas. */
export const mcpTools: readonly McpToolMetadata[] = [
  {
    name: "git_context",
    cli: "context git",
    description:
      "Concise branch context for the current repository, with optional PR detail, remote URLs, working-tree diffs, and merge-base branch diff.",
    parameters: {
      diff: {
        type: "boolean",
        description:
          "Append the full unstaged and staged diffs beneath each working-tree section.",
        cli: "--diff",
        default: "false",
      },
      branchDiff: {
        type: "boolean",
        description:
          "Append the full merge-base diff of the current branch against the default branch.",
        cli: "--branch-diff",
        default: "false",
      },
      comments: {
        type: "boolean",
        description: "Include pull request conversation comments.",
        cli: "--comments",
        default: "false",
      },
      reviews: {
        type: "boolean",
        description: "Include individual pull request reviews.",
        cli: "--reviews",
        default: "false",
      },
      labels: {
        type: "boolean",
        description: "Include pull request labels.",
        cli: "--labels",
        default: "false",
      },
      checks: {
        type: "boolean",
        description: "Include CI check runs.",
        cli: "--checks",
        default: "false",
      },
      description: {
        type: "boolean",
        description: "Include the pull request description.",
        cli: "omit --no-description",
        default: "true",
      },
      pullRequest: {
        type: "boolean",
        description: "Include the pull request block at all.",
        cli: "omit --no-pr",
        default: "true",
      },
      remotes: {
        type: "boolean",
        description: "Include remote fetch/push URLs in branch metadata.",
        cli: "--remotes",
        default: "false",
      },
      since: {
        type: "string",
        description: "Only include recent commits after this date.",
        cli: "--since <date>",
      },
    },
  },
  {
    name: "stack_context",
    cli: "context stack",
    description:
      "Deterministic tech-stack summary for a directory: languages, ecosystems, tooling, and frameworks.",
    parameters: {
      dir: {
        type: "string",
        description:
          "Directory to scan. Omit to scan the server's current working directory.",
        cli: "[dir]",
      },
    },
  },
  {
    name: "command_help",
    cli: "context help [name]",
    description:
      "Show context CLI help. Omit name for the full command overview, or pass a command name to scope help.",
    parameters: {
      name: {
        type: "string",
        description: "Optional command to scope help to.",
        cli: "[name]",
      },
    },
  },
  {
    name: "opencode_debug",
    cli: "context opencode-debug",
    description:
      "Run OpenCode debug commands and return their combined output. Optionally inspect a configured agent by name.",
    parameters: {
      agent: {
        type: "string",
        description: "Optional agent name to inspect.",
        cli: "--agent <name>",
      },
    },
  },
];
