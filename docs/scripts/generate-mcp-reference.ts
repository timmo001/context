import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mcpTools } from "../../src/mcp/toolMetadata.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "src/content/docs/mcp/tools.md");
const lines: string[] = [];
const push = (line = "") => lines.push(line);
const code = (text: string) => `\`${text}\``;

push("---");
push("title: MCP Tool Reference");
push("description: Generated reference for the context MCP tools.");
push("sidebar:");
push("  order: 2");
push("---");
push();
push(
  "<!-- Generated from src/mcp/toolMetadata.ts by `mise run docs:gen:mcp`. Do not edit by hand. -->",
);
push();
for (const tool of mcpTools) {
  push(`## ${code(tool.name)}`);
  push();
  push(tool.description);
  push();
  push(`CLI equivalent: ${code(tool.cli)}`);
  push();
  const entries = Object.entries(tool.parameters);
  if (entries.length) {
    push("| Parameter | Type | Default | CLI | Description |");
    push("| --- | --- | --- | --- | --- |");
    for (const [name, parameter] of entries) {
      push(
        `| ${code(name)} | ${parameter.type} | ${parameter.default ?? ""} | ${parameter.cli ? code(parameter.cli) : ""} | ${parameter.description} |`,
      );
    }
    push();
  } else {
    push("No parameters.");
    push();
  }
}

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`,
);
console.log(`Wrote ${path.relative(root, outFile)}`);
