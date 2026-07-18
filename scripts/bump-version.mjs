#!/usr/bin/env node
// bump-version.mjs <version> — set every workspace package.json version (lockstep).
//
// Walks the repo, skipping node_modules/.git/dist, and rewrites each package.json
// "version" field. Install-free (no pnpm/npm needed) so release.{sh,ps1} can run
// on a clean checkout. Private packages are bumped too but never published.
import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/bump-version.mjs <version>');
  process.exit(1);
}

const SKIP = new Set([
  'node_modules', '.git', 'dist', 'dist-server', 'build',
  '.next', '.turbo', '.svelte-kit', 'out', 'coverage',
]);
let count = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name === 'package.json') {
      const pkg = JSON.parse(fs.readFileSync(full, 'utf8'));
      // Only our own manifests: every @digitaplatform/* package + the repo root.
      // Skips any vendored third-party package.json that isn't under node_modules.
      const isRoot = path.resolve(full) === path.resolve('package.json');
      const isOurs = typeof pkg.name === 'string' && pkg.name.startsWith('@digitaplatform/');
      if (!isRoot && !isOurs) continue;
      pkg.version = version;
      fs.writeFileSync(full, JSON.stringify(pkg, null, 2) + '\n');
      count += 1;
      console.log(`  ${version}  ${path.relative(process.cwd(), full)}`);
    }
  }
}

walk(process.cwd());
console.log(`bumped ${count} package.json file(s) to ${version}`);
