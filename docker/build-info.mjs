import process from 'node:process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const [name, manifest, output, inventory, tier] = process.argv.slice(2);
const buildVersion = process.env.BUILD_VERSION ?? "";
const version = buildVersion === buildVersion.trim() && /^\d+\.\d+\.\d+-(alpha|beta|stable)-\d{14}-[a-f0-9]{7}$/.test(buildVersion) ? buildVersion : undefined;
const subpackages = new Map();
const visited = new Set();
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const add = (name, version) => subpackages.set(`${name}@${version}`, { name, version });

// Follow installed project dependencies, not ranges or unused sibling manifests.
function visit(file) {
  file = realpathSync(file);
  if (visited.has(file)) return;
  visited.add(file);
  const pkg = json(file);
  add(pkg.name, pkg.version);
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    if (dependency.startsWith('@digitaplatform/')) {
      const installed = (createRequire(file).resolve.paths(dependency) ?? [])
        .map((path) => resolve(path, dependency, 'package.json')).find(existsSync);
      if (!installed) throw new Error(`missing installed project package: ${dependency}`);
      visit(installed);
    }
  }
}
visit(resolve(manifest));
if (inventory && existsSync(inventory)) {
  for (const plugin of json(inventory).plugins) {
    if (plugin.tier === tier) add(plugin.id, plugin.version);
  }
}
writeFileSync(output, `${JSON.stringify({ name, version, subpackages: [...subpackages.values()] })}\n`);
