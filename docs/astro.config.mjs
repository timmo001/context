// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightContextualMenu from "starlight-contextual-menu";
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
      title: "Context",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "Context logo",
      },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/starlight.css"],
      editLink: {
        baseUrl: "https://github.com/timmo001/context/edit/main/docs/",
      },
      lastUpdated: true,
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://context.timmo.dev/og.png",
          },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:width", content: "1200" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:height", content: "630" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:alt", content: "Context" },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content: "https://context.timmo.dev/og.png",
          },
        },
      ],
      plugins: [
        starlightLinksValidator(),
        starlightLlmsTxt({
          projectName: "Context",
          description:
            "Standalone CLI and MCP server for deterministic repository context.",
          promote: ["index*"],
        }),
        starlightContextualMenu({
          actions: ["copy", "view"],
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
        { label: "Install", link: "/install/" },
        { label: "Quick Start", link: "/quick-start/" },
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
