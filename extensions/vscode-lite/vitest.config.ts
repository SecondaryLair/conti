import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.vitest.ts"],
    exclude: ["e2e/**"],
    environment: "node",
  },
});
