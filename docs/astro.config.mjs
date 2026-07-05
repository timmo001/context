// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightLinksValidator from "starlight-links-validator";
import rehypeExternalLinks from "rehype-external-links";
import { unified } from "@astrojs/markdown-remark";

export default defineConfig({
  site: "https://context.timmo.dev",
  markdown: {
    processor: unified({
      rehypePlugins: [
        [
          rehypeExternalLinks,
          { target: "_blank", rel: ["noopener", "noreferrer"] },
        ],
      ],
    }),
  },
  integrations: [
    sitemap(),
    starlight({
      title: "context",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/starlight.css"],
      editLink: {
        baseUrl: "https://github.com/timmo001/context/edit/main/docs/",
      },
      lastUpdated: true,
      plugins: [
        starlightLinksValidator(),
        starlightLlmsTxt({
          projectName: "context",
          description:
            "Standalone CLI and MCP server for deterministic repository context.",
          promote: ["index*"],
        }),
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/timmo001/context",
        },
      ],
      sidebar: [
        { label: "Overview", link: "/" },
        {
          label: "CLI",
          items: [{ autogenerate: { directory: "cli" } }],
        },
        {
          label: "Context",
          items: [{ autogenerate: { directory: "context" } }],
        },
        {
          label: "MCP",
          items: [{ autogenerate: { directory: "mcp" } }],
        },
        {
          label: "Integrations",
          items: [{ autogenerate: { directory: "integrations" } }],
        },
      ],
    }),
  ],
});
