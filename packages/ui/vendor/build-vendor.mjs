// Build the shared-singleton vendor ESM (react family + @digitaplatform/plugins) as
// content-hashed browser modules + the import-map that wires bare specifiers to
// them. ONE generator → dev and prod read the SAME map.
//
// CRITICAL: built with multi-entry + code-splitting and NO externals among the
// react family. esbuild dedupes react / react-dom / scheduler into shared chunks
// that every entry imports, so each package's internal require("react") resolves
// to the bundled shared chunk — NOT a throwing dynamic-require shim (which is what
// breaks in the browser when react is externalized from a CJS dep). A guard at
// the end fails the build if any throwing-require / unreplaced process.env leaks.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
// Single source of truth for the entries + import-map mapping (kept in sync with
// vite.config's externals by tests/vendor-externals.test.ts).
import { ENTRY_FILES, SPECIFIER_TO_ENTRY } from './shared-externals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // digita-ui
const entriesDir = join(here, 'entries');
const outDir = join(root, 'public', 'vendor');
const importMapPath = join(root, 'public', 'import-map.json');

const FORBIDDEN = ['typeof require', 'Dynamic require of', 'process.env'];

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const entryPoints = Object.fromEntries(
    Object.entries(ENTRY_FILES).map(([name, file]) => [name, join(entriesDir, file)]),
  );

  const result = await build({
    entryPoints,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    // Replace process.env.NODE_ENV with "production" (dead-code-elim dev paths)
    // AND collapse any other process.env access to an empty object so no literal
    // `process.env` survives to throw in the browser. (`typeof process` guards in
    // deps stay "undefined" in the browser, so those branches are skipped anyway.)
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    minify: true,
    legalComments: 'none',
    outdir: outDir,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    metafile: true,
    write: true,
  });

  // Map each entry name → its hashed output file via the metafile.
  const entryOutputs = {}; // entryName → '/vendor/<file>'
  for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    const srcName = basename(meta.entryPoint, '.js'); // e.g. 'react-dom'
    const entryName = Object.keys(ENTRY_FILES).find((n) => ENTRY_FILES[n] === `${srcName}.js`);
    if (entryName) entryOutputs[entryName] = `/vendor/${basename(outPath)}`;
  }

  const imports = {};
  for (const [specifier, entryName] of Object.entries(SPECIFIER_TO_ENTRY)) {
    const url = entryOutputs[entryName];
    if (!url) throw new Error(`[vendor] no output produced for entry "${entryName}" (specifier "${specifier}")`);
    imports[specifier] = url;
  }

  await writeFile(importMapPath, JSON.stringify({ imports }, null, 2) + '\n');

  // GUARD: a browser has no require() / process — any leaked throwing-require
  // shim or unreplaced process.env makes a vendor module throw at import time
  // (deploy-only failure). Fail the build loudly instead.
  const files = (await readdir(outDir)).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    const text = await readFile(join(outDir, f), 'utf-8');
    const hits = FORBIDDEN.filter((p) => text.includes(p));
    if (hits.length) offenders.push(`${f}: ${hits.join(', ')}`);
  }
  if (offenders.length) {
    throw new Error(
      `[vendor] FORBIDDEN browser-breaking patterns in vendor output:\n  ${offenders.join('\n  ')}`,
    );
  }

  console.log(`[vendor] ${files.length} files, import-map ${Object.keys(imports).length} keys, guard clean:`);
  for (const [name, url] of Object.entries(entryOutputs)) console.log(`  ${name} → ${url}`);
}

main().catch((err) => {
  console.error('[vendor] build failed:', err);
  process.exit(1);
});
