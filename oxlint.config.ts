import recommendedEffect from "@timmo001/oxlint-rules/configs/recommended-effect";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [recommendedEffect],
  options: {
    typeAware: true,
  },
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
  ],
});
