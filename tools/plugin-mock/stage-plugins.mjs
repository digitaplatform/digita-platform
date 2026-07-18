#!/usr/bin/env node
/**
 * stage-plugins.mjs — MOCK plugin staging for local development.
 *
 * Reads the pinned distribution set from ../../plugins.lock.json (repo root),
 * validates each plugin's built dist (manifest shape, tier, entry file),
 * computes a sha384 SRI integrity for the entry artifact, and copies the
 * artifact + manifest into the version-addressed staged dir:
 *
 *   premium -> staged-premium/<id>/<version>/  (repo root, OUTSIDE the web root;
 *              served gated by the engine via /api/v1/plugin-assets)
 *
 * FREE plugins split by delivery mode: DELIVERED free plugins (a free design
 * like minimal) are staged here (free -> public/plugins) and inlined into the
 * inventory. BUILT-IN free plugins (the usermenu component and the digita
 * default signature) are compiled into the host bundle instead — bundled at
 * build, present on first paint — and are never staged.
 *
 * Finally emits the inventory at packages/ui/public/plugins/index.json with
 * same-origin URLs: premium entries under the engine's gated route
 * /api/v1/plugin-assets/... .
 *
 * Two source modes:
 *   --local    (default) read each package's built dist directly from the
 *              sibling repo digita-plugins-store/<id>/dist. Works with CI down.
 *   --registry `npm pack @digitaplatform/<id>@<version>` into a temp dir
 *              (auth via the existing .npmrc) and read package/dist.
 *
 * No external dependencies — node: builtins only. Fails loud (non-zero exit)
 * on any missing package/dist/manifest or integrity/shape mismatch.
 *
 * Usage: node tools/plugin-mock/stage-plugins.mjs [--local | --registry]
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_TYPES = new Set(['component', 'design', 'signature']);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.resolve(scriptDir, '..', '..');
const siblingsRoot = path.dirname(platformRoot);
const lockPath = path.join(platformRoot, 'plugins.lock.json');

const publicDir = path.join(platformRoot, 'packages', 'ui', 'public');
const freeStageBase = path.join(publicDir, 'plugins');
// Premium artifacts must NEVER live under the ui web root (nginx would serve
// them openly, bypassing the license gate). They stage into a repo-root dir
// that no web server serves; the engine streams them via /api/v1/plugin-assets.
const premiumStageBase = path.join(platformRoot, 'staged-premium');
const inventoryPath = path.join(freeStageBase, 'index.json');

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

// --- argument parsing -------------------------------------------------------

const args = process.argv.slice(2);
let mode = 'local';
for (const arg of args) {
  if (arg === '--local') mode = 'local';
  else if (arg === '--registry') mode = 'registry';
  else fail(`Unknown argument "${arg}". Usage: stage-plugins.mjs [--local | --registry]`);
}

// --- lock file --------------------------------------------------------------

if (!fs.existsSync(lockPath)) fail(`Lock file not found: ${lockPath}`);
let lock;
try {
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
} catch (err) {
  fail(`Lock file is not valid JSON (${lockPath}): ${err.message}`);
}
if (lock.schemaVersion !== 1) fail(`Unsupported lock schemaVersion ${lock.schemaVersion} (expected 1) in ${lockPath}`);

const sections = [
  {
    section: 'free',
    expectedTier: 'free',
    siblingRepo: 'digita-plugins-free',
    stageBase: freeStageBase,
    // Free artifacts (component/design) are served OPENLY from the ui web root.
    urlFor: (id, version, entry) => `/plugins/${id}/${version}/${entry}`,
    entries: lock.free ?? {},
  },
  {
    section: 'premium',
    expectedTier: 'premium',
    siblingRepo: 'digita-plugins-store',
    stageBase: premiumStageBase,
    urlFor: (id, version, entry) => `/api/v1/plugin-assets/${id}/${version}/${entry}`,
    entries: lock.premium ?? {},
  },
];

// --- source resolution ------------------------------------------------------

const tempDirs = [];

function distDirLocal(section, id) {
  const distDir = path.join(siblingsRoot, section.siblingRepo, id, 'dist');
  if (!fs.existsSync(distDir)) {
    fail(`[${id}] built dist not found at ${distDir} — build the plugin in ${section.siblingRepo} first.`);
  }
  return distDir;
}

function distDirRegistry(id, version) {
  const spec = `@digitaplatform/${id}@${version}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `digita-stage-${id}-`));
  tempDirs.push(tmp);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    execFileSync(npmCmd, ['pack', spec, '--pack-destination', tmp], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
  } catch (err) {
    fail(`[${id}] npm pack ${spec} failed: ${err.stderr?.toString().trim() || err.message}`);
  }
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  if (!tgz) fail(`[${id}] npm pack ${spec} produced no tarball in ${tmp}`);
  try {
    execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    fail(`[${id}] extracting ${tgz} failed: ${err.stderr?.toString().trim() || err.message}`);
  }
  const distDir = path.join(tmp, 'package', 'dist');
  if (!fs.existsSync(distDir)) fail(`[${id}] tarball ${spec} contains no dist/ directory.`);
  return distDir;
}

// --- validation + staging ---------------------------------------------------

function sha384(filePath) {
  return `sha384-${createHash('sha384').update(fs.readFileSync(filePath)).digest('base64')}`;
}

function stageOne(section, id, version) {
  const distDir = mode === 'local' ? distDirLocal(section, id) : distDirRegistry(id, version);

  const manifestPath = path.join(distDir, 'digita-plugin.json');
  if (!fs.existsSync(manifestPath)) fail(`[${id}] manifest missing: ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    fail(`[${id}] manifest is not valid JSON (${manifestPath}): ${err.message}`);
  }

  if (manifest.id !== id) {
    fail(`[${id}] manifest id "${manifest.id}" does not match lock key "${id}" (${manifestPath})`);
  }
  if (!VALID_TYPES.has(manifest.type)) {
    fail(`[${id}] manifest type "${manifest.type}" is not one of ${[...VALID_TYPES].join(', ')} (${manifestPath})`);
  }
  if (manifest.tier !== section.expectedTier) {
    fail(`[${id}] manifest tier "${manifest.tier}" does not match lock section "${section.section}" (expected "${section.expectedTier}")`);
  }
  if (manifest.version !== undefined && manifest.version !== version) {
    fail(`[${id}] manifest version "${manifest.version}" does not match locked version "${version}"`);
  }

  // Signatures are PURE CONFIG — no artifact to copy or hash. Inline the full
  // identity (accent + fonts + colour world + graphics + monogram + wordmark)
  // into the inventory record; the host applies it via applySignature(). No
  // entry / url / integrity — nothing is fetched beyond these inlined fields.
  if (manifest.type === 'signature') {
    const identity = {};
    for (const key of ['accent', 'fonts', 'logoUrl', 'monogram', 'wordmark', 'colors', 'graphics']) {
      if (manifest[key] !== undefined) identity[key] = manifest[key];
    }
    if (typeof identity.accent !== 'string' || identity.accent.length === 0) {
      fail(`[${id}] signature manifest has no accent (${manifestPath})`);
    }
    return {
      record: { id, type: 'signature', tier: manifest.tier, version, ...identity },
      bytes: 0,
    };
  }

  if (typeof manifest.entry !== 'string' || manifest.entry.length === 0) {
    fail(`[${id}] manifest has no entry (${manifestPath})`);
  }

  const entryPath = path.resolve(distDir, manifest.entry);
  if (!entryPath.startsWith(path.resolve(distDir) + path.sep)) {
    fail(`[${id}] entry "${manifest.entry}" escapes the dist directory`);
  }
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    fail(`[${id}] entry file missing in dist: ${entryPath}`);
  }

  const integrity = sha384(entryPath);
  const bytes = fs.statSync(entryPath).size;

  const destDir = path.join(section.stageBase, id, version);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(entryPath, path.join(destDir, manifest.entry));
  fs.copyFileSync(manifestPath, path.join(destDir, 'digita-plugin.json'));

  // Post-copy integrity check: the staged artifact must hash identically.
  const stagedIntegrity = sha384(path.join(destDir, manifest.entry));
  if (stagedIntegrity !== integrity) {
    fail(`[${id}] staged entry integrity mismatch (${stagedIntegrity} != ${integrity}) — copy corrupted?`);
  }

  return {
    record: {
      id,
      type: manifest.type,
      tier: manifest.tier,
      version,
      entry: manifest.entry,
      integrity,
      url: section.urlFor(id, version, manifest.entry),
    },
    bytes,
  };
}

// --- main -------------------------------------------------------------------

console.log(`Staging plugins (${mode} mode) from lock ${lockPath}\n`);

const plugins = [];
const rows = [];
for (const section of sections) {
  for (const [id, version] of Object.entries(section.entries)) {
    const { record, bytes } = stageOne(section, id, version);
    plugins.push(record);
    rows.push({ id, tier: record.tier, version, bytes });
    console.log(`  staged ${record.tier}/${id}@${version} -> ${record.url ?? '(signature: inlined config, no artifact)'}`);
  }
}

if (plugins.length === 0) fail('Lock file contains no plugins to stage.');

const inventory = {
  schemaVersion: 1,
  generatedAtNote: 'run stage-plugins.mjs',
  plugins,
};
fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
console.log(`\nInventory written: ${inventoryPath}`);

// Best-effort temp cleanup (registry mode).
for (const dir of tempDirs) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* non-fatal */
  }
}

// --- summary table ----------------------------------------------------------

const header = { id: 'id', tier: 'tier', version: 'version', bytes: 'bytes' };
const all = [header, ...rows.map((r) => ({ ...r, bytes: String(r.bytes) }))];
const width = (key) => Math.max(...all.map((r) => String(r[key]).length));
const wId = width('id');
const wTier = width('tier');
const wVer = width('version');
const wBytes = width('bytes');
const line = (r) =>
  `  ${String(r.id).padEnd(wId)}  ${String(r.tier).padEnd(wTier)}  ${String(r.version).padEnd(wVer)}  ${String(r.bytes).padStart(wBytes)}`;
console.log('');
console.log(line(header));
console.log(`  ${'-'.repeat(wId)}  ${'-'.repeat(wTier)}  ${'-'.repeat(wVer)}  ${'-'.repeat(wBytes)}`);
for (const r of rows) console.log(line(r));
console.log(`\nStaged ${rows.length} plugin(s) successfully.`);
