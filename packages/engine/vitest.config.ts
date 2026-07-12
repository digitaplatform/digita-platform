import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    root: "./",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    // Keep worker isolation ON (vitest default — do NOT set `isolate: false`).
    // With isolation off, all test files scheduled onto the same fork share
    // one module registry: whichever file imports a module FIRST permanently
    // binds it to that file's vi.mock instances for every later file in the
    // fork. Later files then see stale mocks — e.g. an env mock with an empty
    // MONGODB_URI poisoning integration files (MongoParseError / ECONNREFUSED
    // on CI), or a foreign logger mock so a file's own `warn` spy is never
    // called (entity-registry-snapshot-validation 8/10 red, schema-migrator
    // "dropped:false", period-check / timeseries validators). This was green
    // locally only because high core counts spread the 45 files ~1 per fork;
    // on a 4-vCPU CI runner (2 forks) it failed deterministically — and it is
    // NOT platform-specific (reproduced on Windows with 2 files in 1 worker).
    // Measured in a 4-CPU/16GB Linux container: isolate:false = 18 failures,
    // default isolation = 827 green in ~15s (VITEST_MAX_WORKERS=2).
  },
});
