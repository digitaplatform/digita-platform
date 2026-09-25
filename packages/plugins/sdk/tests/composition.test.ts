import { describe, it, expect, vi, afterEach } from 'vitest';
import { designFromSource, findPluginInventory, joinCompositionWithInventory, type PluginInventory } from '../src/index.js';

const inventory: PluginInventory = {
  schemaVersion: 1,
  plugins: [
    { id: 'minimal', type: 'design', tier: 'free', version: '1.0.0', url: '/plugins/minimal/1.0.0/minimal.css' },
    { id: 'material', type: 'design', tier: 'premium', version: '1.0.0', url: '/api/v1/plugin-assets/material/1.0.0/material.css' },
    { id: 'aurora', type: 'signature', tier: 'free', version: '1.0.0', accent: '#123456', monogram: '<svg/>' },
  ],
};

describe('joinCompositionWithInventory', () => {
  it('joins what the app enables with what is staged, and locks a premium plugin without entitlement', () => {
    const { sources, lockedIds } = joinCompositionWithInventory(
      [{ id: 'minimal' }, { id: 'material' }, { id: 'aurora', title: 'Aurora' }],
      inventory,
      [],
    );
    expect(lockedIds).toEqual(['material']);
    expect(sources.map((s) => [s.id, s.type, s.url])).toEqual([
      ['minimal', 'design', '/plugins/minimal/1.0.0/minimal.css'],
      ['aurora', 'signature', undefined],
    ]);
    expect(sources[1]).toMatchObject({ title: 'Aurora', accent: '#123456', monogram: '<svg/>' });
  });

  it('loads an entitled premium plugin, and falls back to a legacy inline url or a bare id', () => {
    const { sources, lockedIds } = joinCompositionWithInventory(
      [{ id: 'material' }, { id: 'legacy', url: '/legacy.js' }, { id: 'dev-only' }],
      inventory,
      ['material'],
    );
    expect(lockedIds).toEqual([]);
    expect(sources).toEqual([
      expect.objectContaining({ id: 'material', type: 'design', url: '/api/v1/plugin-assets/material/1.0.0/material.css' }),
      { id: 'legacy', title: undefined, type: 'component', url: '/legacy.js' },
      { id: 'dev-only', title: undefined },
    ]);
  });
});

describe('designFromSource', () => {
  it('derives the design id and its variant from the plugin id, with the stylesheet at the given url', () => {
    expect(designFromSource({ id: 'material', title: 'Material', type: 'design', url: '/x.css' }, '/erp/x.css')).toEqual({
      type: 'design',
      id: 'material',
      title: 'Material',
      designId: 'material',
      variant: 'material',
      cssUrl: '/erp/x.css',
    });
  });
});

describe('findPluginInventory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('returns the inventory the app stages', async () => {
    respond(200, inventory);
    expect(await findPluginInventory('/erp/plugins/index.json')).toEqual(inventory);
    expect(fetch).toHaveBeenCalledWith('/erp/plugins/index.json', { headers: { Accept: 'application/json' } });
  });

  it('answers null, and says so, for a missing or malformed inventory', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    respond(404, {});
    expect(await findPluginInventory('/erp/plugins/index.json')).toBeNull();
    respond(200, { schemaVersion: 1 });
    expect(await findPluginInventory('/erp/plugins/index.json')).toBeNull();
    expect(logged).toHaveBeenCalledTimes(2);
  });
});
