import { cliCommands, getCliCommand, type CliCommandSpec } from "./spec.js";

const rootExamples = [
  "context git                    Branch context for agents",
  "context git --json             Branch context JSON payload",
  "context git --diff             Include working-tree diffs",
  "context stack                  Tech stack context for agents",
  "context stack --json           Stack context JSON payload",
  "context mcp                    MCP server over stdio",
];

function usageFor(command: CliCommandSpec): string {
  return `Usage: context ${command.name}${command.usage ? ` ${command.usage}` : ""}`;
}

function optionLabel(
  option: NonNullable<CliCommandSpec["options"]>[number],
): string {
  const names = option.short ? `${option.name}, ${option.short}` : option.name;
  return option.valueName ? `${names} <${option.valueName}>` : names;
}

function renderAligned(
  title: string,
  rows: readonly [string, string][],
): string[] {
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map(([label]) => label.length));
  return [
    `${title}:`,
    ...rows.map(
      ([label, description]) => `  ${label.padEnd(width)}  ${description}`,
    ),
  ];
}

function commandLine(command: CliCommandSpec): string {
  const args =
    command.arguments?.map((arg) =>
      arg.repeatable ? `[${arg.name}...]` : `<${arg.name}>`,
    ) ?? [];
  const options = command.options?.length ? " [options]" : "";
  return `${command.name}${options}${args.length ? ` ${args.join(" ")}` : ""}`;
}

function parseRows(lines: readonly string[]): readonly [string, string][] {
  return lines.map((line) => {
    const match = /^(\S+(?:\s+\S+)*)\s{2,}(.+)$/.exec(line.trimEnd());
    return match ? [match[1], match[2]] : [line, ""];
  });
}

function trimBlankTail(lines: string[]): string[] {
  while (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function renderCommand(command: CliCommandSpec): string {
  const lines: string[] = [usageFor(command), ""];
  if (command.description) lines.push(...command.description, "");
  if (command.modes)
    lines.push(...renderAligned("Modes", parseRows(command.modes)), "");
  if (command.commands) {
    lines.push(
      ...renderAligned(
        "Commands",
        command.commands.map((subcommand) => [
          commandLine(subcommand),
          subcommand.summary,
        ]),
      ),
      "",
    );
  }
  if (command.options) {
    lines.push(
      ...renderAligned(
        "Options",
        command.options.map((option) => [
          optionLabel(option),
          option.description,
        ]),
      ),
      "",
    );
  }
  if (command.sections) {
    for (const section of command.sections) {
      lines.push(
        `${section.title}:`,
        ...section.lines.map((line) => `  ${line}`),
        "",
      );
    }
  }
  if (command.examples)
    lines.push(
      "Examples:",
      ...command.examples.map((example) => `  ${example}`),
    );
  return trimBlankTail(lines).join("\n");
}

function renderRootHelp(): string {
  return [
    "Usage: context <command> [options]",
    "",
    "Standalone CLI and MCP server for deterministic repository context.",
    "",
    ...renderAligned(
      "Commands",
      cliCommands.map((command) => [command.name, command.summary]),
    ),
    "",
    "Options:",
    "  --help, -h  Show this help message",
    "",
    "Examples:",
    ...rootExamples.map((example) => `  ${example}`),
    "",
    "Run 'context <command> --help' for command-specific options.",
  ].join("\n");
}

/** Render root or command-specific CLI help from the command registry. */
export function renderHelp(commandName?: string): string {
  if (!commandName) return renderRootHelp();
  return renderCommand(getCliCommand(commandName) ?? getCliCommand("help")!);
}
