// `vite build` copies public/ into dist/, so the plugin inventory the app fetches at
// /plugins/index.json reaches a local production build only when it is staged before that step,
// as the image build does (docker/app.Dockerfile).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootPackage = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('the root build:app script', () => {
  it('stages the plugin inventory before the app build', () => {
    const steps = (rootPackage.scripts['build:app'] ?? '').split('&&').map((s) => s.trim());
    const stage = steps.findIndex((s) => s.startsWith('node tools/plugin-mock/stage-plugins.mjs'));
    const build = steps.findIndex((s) => s === 'pnpm --filter @digitaplatform/app build');

    expect(build).toBeGreaterThanOrEqual(0);
    expect(stage).toBeGreaterThanOrEqual(0);
    expect(stage).toBeLessThan(build);
  });
});
