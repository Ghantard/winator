import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The e2e suite is slow and needs a real toolchain: npm run test:e2e.
    exclude: ["tests/e2e/**"],
  },
});
