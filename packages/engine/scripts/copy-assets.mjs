// Post-tsc step: copy non-TS assets from src/ to dist/ preserving paths.
//
// tsc only emits artifacts for .ts inputs. Other file types stay behind:
//   • .cjs       — pino transports loaded via dynamic require
//   • .json      — entity definitions, locales, view/rule definitions
//
// In production (`node dist/server.js`), these assets must be co-located
// with the compiled .js so the platform can find them at runtime. dev
// runs `tsx watch src/server.ts` which reads from src/ directly.
//
// Add new asset extensions to ASSET_EXTENSIONS as needed.
import { readdirSync, mkdirSync, copyFileSync, statSync, existsSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const SRC = "src";
const DIST = "dist";
const ASSET_EXTENSIONS = [".cjs", ".json"];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!ASSET_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    const rel = relative(SRC, full);
    const out = join(DIST, rel);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(full, out);
  }
}

// Prune stale assets: a dist asset whose src counterpart was deleted would
// otherwise survive incremental builds and resurface at runtime (e.g. the
// removed User.entity.json re-registering the User entity in prod).
function prune(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      prune(full);
      continue;
    }
    if (!ASSET_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    const rel = relative(DIST, full);
    if (!existsSync(join(SRC, rel))) {
      rmSync(full);
      console.log(`[copy-assets] pruned stale asset ${rel}`);
    }
  }
}

try {
  statSync(SRC);
} catch {
  console.error(`[copy-assets] ${SRC}/ not found — run from packages/backend/`);
  process.exit(1);
}

walk(SRC);
prune(DIST);
console.log("[copy-assets] done");
