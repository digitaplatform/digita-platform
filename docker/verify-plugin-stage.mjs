#!/usr/bin/env node
/**
 * verify-plugin-stage.mjs — image-build guard for the typed plugin delivery.
 *
 * Validates a staged plugin tree against its inventory (plugins/index.json,
 * written by tools/plugin-mock/stage-plugins.mjs):
 *   - inventory shape: schemaVersion 1, non-empty plugins[] with unique ids and
 *     id/type/tier/version/entry/integrity/url; type component|design;
 *     tier community|premium,
 *   - path-safe id/version/entry (single segments — no separators, no ".."),
 *   - community (free) entries: url is EXACTLY the nginx-static shape
 *     /plugins/<id>/<version>/<entry>, the artifact exists and its sha384
 *     matches `integrity`,
 *   - premium entries: url is EXACTLY the ENGINE-gated shape
 *     /api/v1/plugin-assets/<id>/<version>/<entry> — premium must NEVER point
 *     at the open /plugins/ path. With --require-no-premium (community-tier
 *     image) the plugins-premium dir must be absent/empty; otherwise the
 *     staged artifact must exist with a matching integrity.
 *
 * Usage (cwd = repo root, node builtins only):
 *   node docker/verify-plugin-stage.mjs --staged
 *       validate packages/ui/public (before the vite build)
 *   node docker/verify-plugin-stage.mjs --dist [--require-no-premium]
 *       validate packages/ui/dist (after the vite build / before nginx COPY)
 *
 * Exits non-zero with a precise message on the first violation.
 * Used by docker/ui.Dockerfile.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VALID_TYPES = new Set(['component', 'design']);
const VALID_TIERS = new Set(['community', 'premium']);
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

// --- argument parsing -------------------------------------------------------

let mode = null;
let requireNoPremium = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--staged') mode = 'staged';
  else if (arg === '--dist') mode = 'dist';
  else if (arg === '--require-no-premium') requireNoPremium = true;
  else fail(`Unknown argument "${arg}". Usage: verify-plugin-stage.mjs (--staged | --dist) [--require-no-premium]`);
}
if (!mode) fail('Missing mode. Usage: verify-plugin-stage.mjs (--staged | --dist) [--require-no-premium]');

const baseDir = path.join('packages', 'ui', mode === 'staged' ? 'public' : 'dist');
const freeBase = path.join(baseDir, 'plugins');
const premiumBase = path.join(baseDir, 'plugins-premium');
const inventoryPath = path.join(freeBase, 'index.json');

// --- inventory --------------------------------------------------------------

if (!fs.existsSync(inventoryPath)) fail(`Inventory not found: ${inventoryPath}`);
let inventory;
try {
  inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
} catch (err) {
  fail(`Inventory is not valid JSON (${inventoryPath}): ${err.message}`);
}
if (inventory.schemaVersion !== 1) {
  fail(`Unsupported inventory schemaVersion ${inventory.schemaVersion} (expected 1) in ${inventoryPath}`);
}
if (!Array.isArray(inventory.plugins) || inventory.plugins.length === 0) {
  fail(`Inventory lists no plugins (${inventoryPath})`);
}

// --- per-entry checks -------------------------------------------------------

function sha384(filePath) {
  return `sha384-${createHash('sha384').update(fs.readFileSync(filePath)).digest('base64')}`;
}

function assertArtifact(id, filePath, integrity) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`[${id}] staged artifact missing: ${filePath}`);
  }
  if (fs.statSync(filePath).size === 0) fail(`[${id}] staged artifact is empty: ${filePath}`);
  const actual = sha384(filePath);
  if (actual !== integrity) {
    fail(`[${id}] integrity mismatch for ${filePath}: inventory ${integrity}, file ${actual}`);
  }
}

const seenIds = new Set();
let freeCount = 0;
let premiumCount = 0;

for (const p of inventory.plugins) {
  const id = p?.id;
  for (const field of ['id', 'type', 'tier', 'version', 'entry', 'integrity', 'url']) {
    if (typeof p?.[field] !== 'string' || p[field].length === 0) {
      fail(`[${id ?? '?'}] inventory entry missing/empty field "${field}"`);
    }
  }
  if (seenIds.has(id)) fail(`[${id}] duplicate id in inventory`);
  seenIds.add(id);
  if (!VALID_TYPES.has(p.type)) fail(`[${id}] invalid type "${p.type}" (expected component|design)`);
  if (!VALID_TIERS.has(p.tier)) fail(`[${id}] invalid tier "${p.tier}" (expected community|premium)`);
  for (const [field, value] of [['id', p.id], ['version', p.version], ['entry', p.entry]]) {
    if (!SAFE_SEGMENT.test(value) || value.includes('..')) {
      fail(`[${id}] unsafe ${field} segment "${value}" (path traversal / separator)`);
    }
  }

  if (p.tier === 'community') {
    const expectedUrl = `/plugins/${p.id}/${p.version}/${p.entry}`;
    if (p.url !== expectedUrl) {
      fail(`[${id}] free plugin url "${p.url}" must be the nginx-static path "${expectedUrl}"`);
    }
    assertArtifact(id, path.join(freeBase, p.id, p.version, p.entry), p.integrity);
    freeCount += 1;
  } else {
    const expectedUrl = `/api/v1/plugin-assets/${p.id}/${p.version}/${p.entry}`;
    if (p.url !== expectedUrl) {
      fail(`[${id}] premium plugin url "${p.url}" must be the engine-gated path "${expectedUrl}" — premium is NEVER served from /plugins/`);
    }
    if (!requireNoPremium) {
      assertArtifact(id, path.join(premiumBase, p.id, p.version, p.entry), p.integrity);
    }
    premiumCount += 1;
  }
}

// --- community-tier image: NO premium bytes ---------------------------------

if (requireNoPremium && fs.existsSync(premiumBase)) {
  const stack = [premiumBase];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) stack.push(full);
      else fail(`community-tier image must ship NO premium bytes, found: ${full}`);
    }
  }
}

console.log(
  `verify-plugin-stage OK (${mode}): ${freeCount} free artifact(s) verified, ` +
    (requireNoPremium
      ? `${premiumCount} premium entr(y/ies) inventory-only (no premium bytes present)`
      : `${premiumCount} premium artifact(s) verified`),
);
