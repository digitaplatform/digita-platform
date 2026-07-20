/**
 * Dependency rules for @digitaplatform/engine. Run: pnpm depcruise
 *
 * All three rules encode invariants that are TRUE today — a violation is a
 * regression, not pre-existing debt. Type-only edges are deliberately allowed
 * where noted: they are erased at compile time and cannot create runtime
 * coupling or load-order cycles. Removing a `dependencyTypesNot` line below
 * must surface the known type-only edges (action-runner/hook-runner →
 * document/base-document; seven core modules → core/api/response-context) —
 * if it does not, the cruise is not seeing the TypeScript sources (check that
 * the summary reports well over 150 modules, not ~3).
 */
module.exports = {
  forbidden: [
    {
      name: "no-static-cycles",
      comment:
        "Value-import cycles are errors (runtime load-order hazards). " +
        "Type-only edges may participate in cycles — they are erased by tsc.",
      severity: "error",
      from: {},
      to: {
        circular: true,
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "engines-never-import-orchestrator",
      comment:
        "The declarative engines (workflow, rules, permissions, hooks, action, " +
        "entity) must never depend on the orchestrator (core/document) at " +
        "runtime — DocumentService calls INTO them, never the reverse. " +
        "Type-only edges (BaseDocument in action-runner/hook-runner) are allowed.",
      severity: "error",
      from: {
        path: "^src/core/(workflow|rules|permissions|hooks|action|entity)/",
      },
      to: {
        path: "^src/core/document/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "core-never-imports-api",
      comment:
        "Core services must not depend on the HTTP layer (core/api routers/" +
        "middleware) or the composition roots (app.ts, server.ts) at runtime. " +
        "Type-only edges (ResponseContext) are allowed.",
      severity: "error",
      from: {
        path: "^src/core/",
        pathNot: "^src/core/api/",
      },
      to: {
        path: "^src/core/api/|^src/(app|server)\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
