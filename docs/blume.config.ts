import { docsConfig } from "@timmo001/docs-kit/blume";
import { defineConfig } from "blume";

export default defineConfig(
  docsConfig({
    title: "Context",
    description:
      "Standalone CLI and MCP server for deterministic repository context.",
    site: "context.timmo.dev",
    github: { owner: "timmo001", repo: "context" },
    navigation: {
      sidebar: [
        "/",
        "/install",
        "/quick-start",
        {
          label: "CLI",
          root: "/cli",
          items: ["/cli/commands", "/cli/completions"],
        },
        {
          label: "Producers",
          items: ["/context/git", "/context/stack"],
        },
        {
          label: "MCP",
          items: ["/mcp/server", "/mcp/tools"],
        },
        {
          label: "Integrations",
          items: ["/integrations/opencode"],
        },
      ],
    },
  }),
);
