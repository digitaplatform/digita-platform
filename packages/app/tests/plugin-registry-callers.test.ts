// A registry export nothing calls reads like a way to drive the plugins: whoever looks for how to
// load a legacy manifest or to ask whether a plugin is locked finds a function the shell never
// runs. Every export of the plugin registry has a caller in the app.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const src = fileURLToPath(new URL('../src', import.meta.url));
const REGISTRY = 'plugins/registry.tsx';

/** The lines of a source text that are code: a comment that names a thing calls nothing. */
const codeLines = (text: string): string[] => text.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));

/** The exports of a module that no other source names in code. */
function exportsWithoutCaller(exported: string[], otherSources: string[]): string[] {
  const code = otherSources.flatMap(codeLines).join('\n');
  return exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(code));
}

describe('the exports of the plugin registry', () => {
  const registry = readFileSync(join(src, REGISTRY), 'utf8');
  const exported = [...registry.matchAll(/^export (?:async )?(?:function|const|class|interface|type) (\w+)/gm)].map(
    (match) => match[1]!,
  );
  const others = (readdirSync(src, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && join(src, file) !== join(src, REGISTRY))
    .map((file) => readFileSync(join(src, file), 'utf8'));

  it('each have a caller', () => {
    expect(exported.length).toBeGreaterThan(0);
    expect(exportsWithoutCaller(exported, others)).toEqual([]);
  });

  it('PLANTED DEFECT: the check names an export that only a comment mentions', () => {
    expect(exportsWithoutCaller(['loadA', 'loadB'], ['loadA();', '// loadB would go here'])).toEqual(['loadB']);
  });

  it('PLANTED INNOCENT: the check passes an export a file calls, and ignores a longer name that contains it', () => {
    expect(exportsWithoutCaller(['load'], ['load(1);'])).toEqual([]);
    expect(exportsWithoutCaller(['load'], ['loadAll(1);'])).toEqual(['load']);
  });
});
