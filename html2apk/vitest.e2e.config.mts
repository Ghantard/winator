import { defineConfig } from "vitest/config";

/**
 * End-to-end builds spawn Gradle and, in the default mode, Docker. They are
 * slow and need a real Android toolchain, so they live in their own suite:
 * `npm run test:e2e`, not `npm test`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // One build at a time: they are heavy and share the Gradle cache.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
