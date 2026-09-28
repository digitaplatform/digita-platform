import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests import the blocks, which resolve `@/` as Next resolves it and use the automatic JSX runtime.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  oxc: { jsx: { runtime: "automatic" } },
});
