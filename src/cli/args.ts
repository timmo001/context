import { Schema } from "effect";
import {
  getCliCommand,
  type CliArgumentSpec,
  type CliCommandSpec,
  type CliOptionSpec,
} from "./spec.js";

export { parseSince } from "./since.js";

/** A command-line usage error suitable for concise CLI reporting. */
export class UsageError extends Schema.TaggedErrorClass<UsageError>()(
  "UsageError",
  { message: Schema.String },
) {}

/** Strictly parsed command-line arguments, with canonical long option names. */
export interface ParsedCliArgs {
  readonly command: CliCommandSpec | undefined;
  readonly options: ReadonlyMap<string, true | string>;
  readonly positionals: readonly string[];
  readonly help: boolean;
}

function usageError(message: string): UsageError {
  return new UsageError({ message });
}

function commandError(command: CliCommandSpec, message: string): UsageError {
  return usageError(`context ${command.name}: ${message}`);
}

function valueDescription(
  values: readonly { readonly value: string }[],
): string {
  return values.map(({ value }) => value).join(", ");
}

function validateChoice(
  command: CliCommandSpec,
  label: string,
  value: string,
  choices: readonly { readonly value: string }[] | undefined,
): void {
  if (!choices || choices.some((choice) => choice.value === value)) return;
  throw commandError(
    command,
    `invalid value '${value}' for ${label} (expected: ${valueDescription(choices)})`,
  );
}

function parseOptionValue(
  command: CliCommandSpec,
  option: CliOptionSpec,
  value: string,
): string {
  validateChoice(command, option.name, value, option.choices);
  if (!option.parseValue) return value;
  try {
    return option.parseValue(value);
  } catch (error) {
    throw commandError(
      command,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function optionLookup(
  command: CliCommandSpec,
): ReadonlyMap<string, CliOptionSpec> {
  const options = new Map<string, CliOptionSpec>();
  for (const option of command.options ?? []) {
    options.set(option.name, option);
    if (option.short) options.set(option.short, option);
  }
  return options;
}

function positionalSpec(
  specs: readonly CliArgumentSpec[],
  index: number,
): CliArgumentSpec | undefined {
  const direct = specs[index];
  if (direct) return direct;
  const last = specs[specs.length - 1];
  return last?.repeatable ? last : undefined;
}

function parseCommandArgs(
  command: CliCommandSpec,
  args: readonly string[],
): ParsedCliArgs {
  const knownOptions = optionLookup(command);
  const options = new Map<string, true | string>();
  const positionals: string[] = [];
  let parseOptions = true;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (parseOptions && token === "--") {
      parseOptions = false;
      continue;
    }
    if (!parseOptions || !token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const equalsIndex = token.startsWith("--") ? token.indexOf("=") : -1;
    const optionName = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);
    const option = knownOptions.get(optionName);
    if (!option) throw commandError(command, `unknown option '${optionName}'`);
    if (options.has(option.name)) {
      throw commandError(
        command,
        `option '${option.name}' may only be specified once`,
      );
    }

    if (!option.valueName) {
      if (inlineValue !== undefined) {
        throw commandError(
          command,
          `option '${option.name}' does not take a value`,
        );
      }
      options.set(option.name, true);
      continue;
    }

    const followingValue = args[index + 1];
    const value =
      inlineValue !== undefined
        ? inlineValue
        : followingValue && !followingValue.startsWith("-")
          ? followingValue
          : undefined;
    if (!value) {
      throw commandError(command, `option '${option.name}' requires a value`);
    }
    if (inlineValue === undefined) index += 1;
    options.set(option.name, parseOptionValue(command, option, value));
  }

  const argumentSpecs = command.arguments ?? [];
  for (let index = 0; index < positionals.length; index += 1) {
    const value = positionals[index];
    const argument = positionalSpec(argumentSpecs, index);
    if (!argument) {
      throw commandError(command, `unexpected argument '${value}'`);
    }
    validateChoice(command, `<${argument.name}>`, value, argument.choices);
  }

  return {
    command,
    options,
    positionals,
    help: options.has("--help"),
  };
}

function parseRootHelp(args: readonly string[]): ParsedCliArgs {
  let help = false;
  for (const token of args) {
    if (token !== "--help" && token !== "-h") {
      const kind = token.startsWith("-") ? "option" : "argument";
      throw usageError(`context: unexpected ${kind} '${token}'`);
    }
    if (help) {
      throw usageError("context: option '--help' may only be specified once");
    }
    help = true;
  }
  return {
    command: undefined,
    options: help ? new Map([["--help", true]]) : new Map(),
    positionals: [],
    help,
  };
}

/** Parse CLI arguments strictly from the command registry in `spec.ts`. */
export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  const [commandName, ...rest] = args;
  if (commandName === undefined) return parseRootHelp([]);
  if (commandName === "--help" || commandName === "-h") {
    return parseRootHelp(args);
  }
  if (commandName.startsWith("-")) {
    throw usageError(`context: unknown option '${commandName}'`);
  }

  const command = getCliCommand(commandName);
  if (!command) throw usageError(`context: unknown command '${commandName}'`);
  return parseCommandArgs(command, rest);
}

/** Return whether a canonical option is present. */
export function hasOption(args: ParsedCliArgs, name: `--${string}`): boolean {
  return args.options.has(name);
}

/** Return a canonical option's validated value. */
export function optionValue(
  args: ParsedCliArgs,
  name: `--${string}`,
): string | undefined {
  const value = args.options.get(name);
  return typeof value === "string" ? value : undefined;
}
