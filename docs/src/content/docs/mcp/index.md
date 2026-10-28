---
title: MCP Server
description: Run context as a Model Context Protocol server over stdio.
sidebar:
  order: 1
---

`context mcp` starts a Model Context Protocol server over stdio. It speaks JSON-RPC on stdout and sends logging to stderr so the protocol stream stays clean.

```json
{
  "mcp": {
    "context": {
      "type": "local",
      "command": ["context", "mcp"],
      "enabled": true
    }
  }
}
```

The server exposes read-only tools and resources. `git_context` validates `since` with the same parser as the CLI and is marked open-world when its default pull request lookup may access GitHub. See the generated [MCP tool reference](/mcp/tools/) for tool parameters.

## Resources

- `context://git` - default text output from `context git`.
- `context://stack` - default text output from `context stack`.
- `context://command/{name}` - help text for a context command.

## Results and Code Mode

`git_context` and `stack_context` declare an `outputSchema` and return `structuredContent` alongside the usual text. The structured result is the same bounded payload as `context git --json` and `context stack --json`, so the full diffs from `diff` and `branchDiff` stay in the text only. `command_help` returns plain help text and has no output schema.

Clients that type tools from their output schema, such as OpenCode's Code Mode, can chain calls on the fields:

```js
const git = await tools["context"].git_context({ pullRequest: false });
const stack = await tools["context"].stack_context({
  dir: git.branchMetadata?.repositoryRoot,
});

return {
  branch: git.branchMetadata?.currentBranch,
  frameworks: stack.frameworks.map((framework) => framework.name),
};
```
