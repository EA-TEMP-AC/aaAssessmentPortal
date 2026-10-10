import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup-env.js"],
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
