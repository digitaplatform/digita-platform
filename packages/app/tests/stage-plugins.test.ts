// The staging tool writes the plugin inventory this app serves at /plugins/index.json. It finds
// plugins.lock.json and each built package (digita-plugins-free/<id>/dist) from its own path, so
// every case copies it into a temporary platform root beside one built signature package, runs it
// as the image build does, and reads the inventory it wrote.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginInventory, PluginInventoryEntry } from '@digitaplatform/plugins';

const tool = fileURLToPath(new URL('../../../tools/plugin-mock/stage-plugins.mjs', import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stageSignature(manifest: { id: string } & Record<string, unknown>): PluginInventoryEntry {
  const root = mkdtempSync(join(tmpdir(), 'stage-plugins-'));
  roots.push(root);
  const platform = join(root, 'digita-platform');
  const copy = join(platform, 'tools', 'plugin-mock', 'stage-plugins.mjs');
  mkdirSync(join(platform, 'tools', 'plugin-mock'), { recursive: true });
  copyFileSync(tool, copy);
  writeFileSync(join(platform, 'plugins.lock.json'), JSON.stringify({ schemaVersion: 1, free: { [manifest.id]: '1.0.0' } }));
  const dist = join(root, 'digita-plugins-free', manifest.id, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'digita-plugin.json'), JSON.stringify(manifest));
  execFileSync(process.execPath, [copy, '--local'], { stdio: 'pipe' });
  const inventory = JSON.parse(
    readFileSync(join(platform, 'packages', 'app', 'public', 'plugins', 'index.json'), 'utf8'),
  ) as PluginInventory;
  return inventory.plugins[0]!;
}

// What gen-signature of digita-plugins-free writes into a signature package's dist/digita-plugin.json:
// `name` is the Signature's own name, `displayName` the store's.
const aurora = {
  id: 'aurora',
  type: 'signature',
  tier: 'free',
  sdk: '^0.1.0',
  displayName: 'Aurora for the store',
  name: 'Aurora',
  accent: '#123456',
};

describe('the staging tool', () => {
  it("stages a signature manifest's name as the record's title", () => {
    expect(stageSignature(aurora)).toMatchObject({ id: 'aurora', type: 'signature', title: 'Aurora' });
  });

  it('stages no title for a signature manifest without a name, so the menu keeps the id', () => {
    // JSON leaves an undefined key out, so the manifest on disk carries no name.
    expect(stageSignature({ ...aurora, name: undefined })).not.toHaveProperty('title');
  });

  it("stages a signature manifest's family", () => {
    expect(stageSignature({ ...aurora, family: 'aurora' })).toMatchObject({
      id: 'aurora',
      type: 'signature',
      accent: '#123456',
      family: 'aurora',
    });
  });

  it('stages no family for a signature manifest without one', () => {
    expect(stageSignature(aurora)).not.toHaveProperty('family');
  });
});
