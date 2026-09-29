import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// vitest runs a package's tests from its root; theme.css is the artifact `pnpm build` writes.
const THEME_CSS = readFileSync(join(process.cwd(), 'dist/theme.css'), 'utf8');

describe('theme.css bundles only the variant layer of the minimal plugin', () => {
  it('carries the plugin rules keyed on data-design-variant', () => {
    expect(THEME_CSS).toContain(':root[data-design-variant="minimal"] [data-ui="command-palette"]');
  });

  it('drops the plugin token blocks, whose values belong to the plugin release', () => {
    // The theme emits its own pair of these blocks for the baked design; the plugin's pair is dropped.
    expect(THEME_CSS.split(':root[data-design="minimal"] {')).toHaveLength(2);
    expect(THEME_CSS.split(':root[data-design="minimal"].dark {')).toHaveLength(2);
  });
});
