import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { stripPluginTokenBlocks } from '../build/plugin-tokens.mjs';

// vitest runs a package's tests from its root; theme.css is the artifact `pnpm build` writes.
const THEME_CSS = readFileSync(join(process.cwd(), 'dist/theme.css'), 'utf8');

describe('theme.css bundles only the variant layer of the minimal plugin', () => {
  it('carries the plugin rules keyed on data-design-variant', () => {
    expect(THEME_CSS).toContain(':root[data-design-variant="minimal"] [data-ui="command-palette"]');
  });

  it('drops the plugin token blocks, whose values belong to the plugin release', () => {
    // The theme emits its own pair of these blocks for the baked design; the plugin's pair is dropped.
    expect(THEME_CSS.split(':root[data-design="minimal"] {')).toHaveLength(2);
    // The theme's own dark block carries its dark band twin.
    expect(THEME_CSS.split(':root[data-design="minimal"].dark,')).toHaveLength(2);
  });

  it('bakes the minimal release that plugins.lock.json delivers, so the baked default and the plugin agree', () => {
    const lock = JSON.parse(readFileSync(join(process.cwd(), '../../plugins.lock.json'), 'utf8'));
    const baked = createRequire(import.meta.url)('@digitaplatform/minimal/package.json').version;
    expect(baked).toBe(lock.free.minimal);
  });

  it('fills the primary button with the tint', () => {
    const rule = THEME_CSS.split(':root[data-design-variant="minimal"] [data-ui="button"][data-variant="primary"] {')[1];
    expect(rule.slice(0, rule.indexOf('}'))).toContain('background: var(--color-primary-600)');
  });

  it('drops only the token blocks; a rule keyed on the same attribute stays (planted case)', () => {
    const tokens = ':root[data-design="minimal"] {\n  --a: 1;\n}\n:root[data-design="minimal"].dark {\n  --a: 2;\n}\n';
    const rules =
      ':root[data-design="minimal"] [data-ui="card"] { color: red; }\n' +
      ':root[data-design-variant="minimal"] [data-ui="card"] { color: blue; }\n';
    expect(stripPluginTokenBlocks(tokens + rules)).toBe(rules);
  });

  it('drops the dark token block of a plugin release that carries its dark band twin', () => {
    const tokens =
      ':root[data-design="minimal"] {\n  --a: 1;\n}\n' +
      ':root[data-design="minimal"].dark,\n:root[data-design="minimal"] [data-block][data-variant="dark"] {\n  --a: 2;\n}\n';
    const rules = ':root[data-design-variant="minimal"].dark [data-ui="card"] { color: blue; }\n';
    expect(stripPluginTokenBlocks(tokens + rules)).toBe(rules);
  });
});
