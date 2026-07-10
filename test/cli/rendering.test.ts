import { describe, expect, test } from "bun:test";
import {
  renderBashCompletions,
  renderFishCompletions,
  renderZshCompletions,
} from "../../src/cli/completions.js";
import { renderHelp } from "../../src/cli/help.js";
import { cliCommands } from "../../src/cli/spec.js";

describe("CLI registry rendering", () => {
  test("renders every command and option in help", () => {
    const rootHelp = renderHelp();

    for (const command of cliCommands) {
      expect(rootHelp).toContain(command.name);

      const commandHelp = renderHelp(command.name);
      expect(commandHelp).toStartWith(`Usage: context ${command.name}`);
      for (const option of command.options ?? []) {
        expect(commandHelp).toContain(option.name);
        if (option.short) expect(commandHelp).toContain(option.short);
      }
    }
  });

  test("renders every command and option in all shell completions", () => {
    const completions = [
      renderBashCompletions(),
      renderFishCompletions(),
      renderZshCompletions(),
    ];

    for (const output of completions) {
      for (const command of cliCommands) {
        expect(output).toContain(command.name);
        for (const option of command.options ?? []) {
          expect(output).toContain(option.name.slice(2));
        }
      }
    }
  });

  test("renders positional choices in all shell completions", () => {
    for (const output of [
      renderBashCompletions(),
      renderFishCompletions(),
      renderZshCompletions(),
    ]) {
      expect(output).toContain("bash fish zsh");
      expect(output).toContain("git stack mcp completions");
    }
  });
});
