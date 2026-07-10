import { parseSince } from "./since.js";

/** Named value completion candidates for a CLI option. */
export interface CliValueChoice {
  /** Value inserted on the command line. */
  readonly value: string;
  /** Human-readable completion/help description. */
  readonly description?: string;
}

/** Positional argument shown in help/completion output. */
export interface CliArgumentSpec {
  /** Argument label, without angle brackets. */
  readonly name: string;
  /** Human-readable description. */
  readonly description?: string;
  /** Completion strategy for this argument. */
  readonly completion?: "file" | "shell" | "none";
  /** Fixed completion candidates for this argument. */
  readonly choices?: readonly CliValueChoice[];
  /** Whether the argument can repeat. */
  readonly repeatable?: boolean;
}

/** CLI option/flag metadata. */
export interface CliOptionSpec {
  /** Long option name, including leading dashes. */
  readonly name: `--${string}`;
  /** Optional short option alias, including leading dash. */
  readonly short?: `-${string}`;
  /** Human-readable description. */
  readonly description: string;
  /** Value label shown in help, when the option takes a value. */
  readonly valueName?: string;
  /** Completion strategy for the value. */
  readonly completion?: "file" | "shell" | "none";
  /** Fixed value candidates. */
  readonly choices?: readonly CliValueChoice[];
  /** Validate and normalise the option value. */
  readonly parseValue?: (value: string) => string;
}

/** Extra help section rendered after options. */
export interface CliHelpSection {
  /** Section title. */
  readonly title: string;
  /** Section lines. */
  readonly lines: readonly string[];
}

/** CLI command/subcommand metadata used for help, docs, and completions. */
export interface CliCommandSpec {
  /** Canonical command name. */
  readonly name: string;
  /** Human-readable summary for command listings. */
  readonly summary: string;
  /** Usage suffix after `context <name>`. */
  readonly usage?: string;
  /** Long description paragraphs. */
  readonly description?: readonly string[];
  /** Mode lines rendered before options. */
  readonly modes?: readonly string[];
  /** Nested subcommands. */
  readonly commands?: readonly CliCommandSpec[];
  /** Command options. */
  readonly options?: readonly CliOptionSpec[];
  /** Positional arguments. */
  readonly arguments?: readonly CliArgumentSpec[];
  /** Additional help sections. */
  readonly sections?: readonly CliHelpSection[];
  /** Example command lines. */
  readonly examples?: readonly string[];
}

const helpOption = {
  name: "--help",
  short: "-h",
  description: "Show this help message",
} satisfies CliOptionSpec;

const jsonOption = {
  name: "--json",
  description: "Emit the structured plugin payload instead of text",
} satisfies CliOptionSpec;

/** Top-level context command descriptors. */
export const cliCommands: readonly CliCommandSpec[] = [
  {
    name: "git",
    summary: "Show branch context for the current repository",
    usage: "[options]",
    description: [
      "Print branch context for the current git repository: repository root, branch/base header, HEAD, ahead/behind state, pull request summary for feature branches, working-tree status, branch work-scope, recent commits, and optional full diffs.",
      "Designed as a single command for agents to get full working-tree and branch context, and as the shared producer for the git_context MCP tool.",
    ],
    modes: [
      "(default)       Context summary: repo, branch, PR, status, branch files, commits",
      "--json          Emit the structured branch-context payload",
      "--diff          Also print full unstaged and staged diffs",
      "--branch-diff   Also print the full diff vs the default branch",
      "--remotes       Also include remote fetch/push URLs",
      "--since <date>  Show recent commits since a date instead of the default window",
    ],
    options: [
      jsonOption,
      {
        name: "--comments",
        description: "Include pull request conversation comments",
      },
      {
        name: "--reviews",
        description: "Include individual pull request reviews",
      },
      { name: "--labels", description: "Include pull request labels" },
      {
        name: "--checks",
        description: "Include CI check runs (makes a second gh call)",
      },
      {
        name: "--no-description",
        description: "Omit the pull request description",
      },
      { name: "--no-pr", description: "Omit the pull request block entirely" },
      {
        name: "--remotes",
        description: "Include remote fetch/push URLs in branch metadata",
      },
      {
        name: "--no-branch-metadata",
        description: "Omit the branch metadata block",
      },
      {
        name: "--no-status",
        description: "Omit the working-tree status block",
      },
      {
        name: "--no-work-scope",
        description: "Omit the branch work-scope block",
      },
      {
        name: "--diff",
        description: "Append full unstaged and staged diffs for changed files",
      },
      {
        name: "--branch-diff",
        description: "Append the merge-base diff vs the default branch",
      },
      {
        name: "--since",
        valueName: "date",
        description: "Show recent commits since this date or relative duration",
        parseValue: parseSince,
      },
      helpOption,
    ],
    examples: [
      "context git",
      "context git --comments --reviews",
      "context git --labels --checks",
      "context git --remotes",
      "context git --diff",
      "context git --branch-diff",
      "context git --json",
      'context git --since "2 days ago"',
    ],
  },
  {
    name: "stack",
    summary: "Detect the tech stack of a directory for agents",
    usage: "[dir] [options]",
    description: [
      "Detect a directory's tech stack deterministically from Git-listed files, with no LLM and no external tools: languages, package ecosystems, tooling, and frameworks.",
      "Designed as a single command for agents to learn a project's stack, and as the shared producer for the stack_context MCP tool.",
    ],
    modes: [
      "(default)       Stack summary: languages, ecosystems, tooling, frameworks",
      "--json          Emit the structured stack-context payload",
      "--plain         Disable ANSI styling in text output",
    ],
    arguments: [
      {
        name: "dir",
        description: "Directory to scan (default: current working directory)",
        completion: "file",
      },
    ],
    options: [
      jsonOption,
      { name: "--plain", description: "Disable ANSI styling in text output" },
      helpOption,
    ],
    examples: [
      "context stack",
      "context stack --plain",
      "context stack --json",
      "context stack ~/projects/app",
    ],
  },
  {
    name: "mcp",
    summary: "Run the context MCP server over stdio",
    usage: "[options]",
    description: [
      "Start a Model Context Protocol server exposing git_context, stack_context, and command_help tools plus read-only context resources.",
    ],
    options: [helpOption],
    examples: ["context mcp"],
  },
  {
    name: "completions",
    summary: "Generate shell completions",
    usage: "[bash|fish|zsh]",
    description: ["Generate shell completions for context."],
    arguments: [
      {
        name: "shell",
        choices: [{ value: "bash" }, { value: "fish" }, { value: "zsh" }],
        completion: "shell",
      },
    ],
    options: [helpOption],
    examples: [
      "context completions zsh",
      "context completions bash",
      "context completions fish",
    ],
  },
  {
    name: "help",
    summary: "Show context help",
    usage: "[command]",
    arguments: [
      {
        name: "command",
        description: "Optional command to show help for",
        choices: [
          { value: "git" },
          { value: "stack" },
          { value: "mcp" },
          { value: "completions" },
        ],
      },
    ],
    options: [helpOption],
    examples: ["context help", "context help git"],
  },
];

/** All native command names. */
export const nativeCommandNames: ReadonlySet<string> = new Set(
  cliCommands.map((command) => command.name),
);

/** Return a command by canonical name. */
export function getCliCommand(name: string): CliCommandSpec | undefined {
  return cliCommands.find((command) => command.name === name);
}
