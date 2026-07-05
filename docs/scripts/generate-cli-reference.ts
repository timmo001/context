import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  cliCommands,
  type CliArgumentSpec,
  type CliCommandSpec,
  type CliOptionSpec,
} from "../../src/cli/spec.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "src/content/docs/cli/commands.md");
const lines: string[] = [];
const push = (line = "") => lines.push(line);
const code = (text: string) => `\`${text}\``;

function optionLabel(option: CliOptionSpec): string {
  const parts = [code(option.name)];
  if (option.short) parts.push(code(option.short));
  if (option.valueName) parts.push(code(`<${option.valueName}>`));
  return parts.join(" ");
}

function optionDescription(option: CliOptionSpec): string {
  let desc = option.description;
  if (option.choices?.length) {
    const values = option.choices.map((c) => code(c.value)).join(", ");
    desc += ` (one of: ${values})`;
  }
  return desc;
}

function renderOptions(options: readonly CliOptionSpec[]): void {
  const visible = options.filter((o) => o.name !== "--help");
  if (!visible.length) return;
  push("**Options**");
  push();
  push("| Option | Description |");
  push("| --- | --- |");
  for (const option of visible) {
    push(`| ${optionLabel(option)} | ${optionDescription(option)} |`);
  }
  push();
}

function renderArguments(args: readonly CliArgumentSpec[]): void {
  if (!args.length) return;
  push("**Arguments**");
  push();
  push("| Argument | Description |");
  push("| --- | --- |");
  for (const arg of args) {
    let desc = arg.description ?? "";
    if (arg.repeatable) desc += desc ? " (repeatable)" : "Repeatable.";
    if (arg.choices?.length) {
      const values = arg.choices.map((c) => code(c.value)).join(", ");
      desc += `${desc ? " " : ""}One of: ${values}.`;
    }
    push(`| ${code(`<${arg.name}>`)} | ${desc.trim()} |`);
  }
  push();
}

function renderCommand(
  command: CliCommandSpec,
  prefix: string,
  depth: number,
): void {
  const heading = "#".repeat(depth);
  const fullName = `${prefix}${command.name}`.trim();
  push(`${heading} ${code(`context ${fullName}`)}`);
  push();
  if (command.aliases?.length) {
    const aliases = command.aliases.map((a) => code(`context ${a}`)).join(", ");
    push(`Aliases: ${aliases}`);
    push();
  }
  push(command.summary);
  push();
  push("```text");
  push(`context ${fullName}${command.usage ? ` ${command.usage}` : ""}`);
  push("```");
  push();
  if (command.description?.length) {
    for (const paragraph of command.description) push(paragraph);
    push();
  }
  if (command.modes?.length) {
    push("**Modes**");
    push();
    push("```text");
    for (const mode of command.modes) push(mode);
    push("```");
    push();
  }
  if (command.options?.length) renderOptions(command.options);
  if (command.arguments?.length) renderArguments(command.arguments);
  if (command.examples?.length) {
    push("**Examples**");
    push();
    push("```bash");
    for (const example of command.examples) push(example);
    push("```");
    push();
  }
  if (command.commands?.length) {
    for (const sub of command.commands)
      renderCommand(sub, `${fullName} `, depth + 1);
  }
}

push("---");
push("title: Command Reference");
push(
  "description: Every context command, alias, flag and example, generated from the CLI registry.",
);
push("sidebar:");
push("  order: 2");
push("---");
push();
push(
  "<!-- Generated from src/cli/spec.ts by `mise run docs:gen:cli`. Do not edit by hand. -->",
);
push();
push(
  "This page lists every `context` command, generated from the same registry that powers `context help`.",
);
push();
for (const command of cliCommands) renderCommand(command, "", 2);

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`,
);
console.log(`Wrote ${path.relative(root, outFile)}`);
