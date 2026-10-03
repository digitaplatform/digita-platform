// A type or function the SDK exports and nothing reads reads like part of the contract: a designer
// who filled the sku of a plugin package after reading the SDK types expected it to matter. Every
// export of the SDK is read by the host (app, website, theme, kit or the staging tools),
// or by another declaration of the SDK that is.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const sdkSrc = fileURLToPath(new URL('../src', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const HOST_DIRS = ['packages/app/src', 'packages/web/src', 'packages/theme/src', 'packages/components/src', 'tools'];

/** The lines of a source text that are code: a comment that names a thing reads nothing. */
const codeLines = (text: string): string[] => text.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));

const DECLARATION = /^export (?:async )?(?:function|const|class|interface|type) (\w+)/;

/** The exports of the SDK sources that neither the host code, a plugin of the list nor another
 *  SDK declaration reads. */
function exportsWithoutReader(sdkTexts: string[], hostTexts: string[], readByPlugins: Record<string, string>): string[] {
  const sdkCode = sdkTexts.flatMap(codeLines);
  const hostCode = hostTexts.flatMap(codeLines);
  const exported = sdkCode.flatMap((line) => DECLARATION.exec(line)?.slice(1) ?? []);
  return exported.filter((name) => {
    if (name in readByPlugins) return false;
    const named = new RegExp(`\\b${name}\\b`);
    const ownDeclaration = (line: string) => DECLARATION.exec(line)?.[1] === name;
    return !sdkCode.some((line) => !ownDeclaration(line) && named.test(line)) && !hostCode.some((line) => named.test(line));
  });
}

const sourceTexts = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[])
    .filter((file) => /\.(tsx?|mjs|js)$/.test(file) && !file.split(/[\\/]/).includes('node_modules'))
    .map((file) => readFileSync(join(dir, file), 'utf8'));

describe('the exports of the plugin SDK', () => {
  it('each have a reader', () => {
    const sdkTexts = sourceTexts(sdkSrc);
    const hostTexts = HOST_DIRS.flatMap((dir) => sourceTexts(join(repoRoot, dir)));
    expect(sdkTexts.length).toBeGreaterThan(0);
    expect(hostTexts.length).toBeGreaterThan(0);
    expect(exportsWithoutReader(sdkTexts, hostTexts, {})).toEqual([]);
  });

  it('PLANTED DEFECT: the check names an export only its own declaration and a comment name', () => {
    const sdk = ['export interface Used { size: Size }', 'export interface Size {}', '// Unread is kept for later', 'export type Unread = string;'];
    expect(exportsWithoutReader(sdk, ['const used: Used = load();'], {})).toEqual(['Unread']);
  });

  it('PLANTED INNOCENT: the check passes an export the host names, one another declaration names and one a plugin reads', () => {
    const sdk = ['export function provide(services: Services): void {}', 'export interface Services {}', 'export function read() {}'];
    expect(exportsWithoutReader(sdk, ['provide(hostServices);'], { read: 'a plugin calls it' })).toEqual([]);
    expect(exportsWithoutReader(['export interface Plugin {}'], ['const p: TypedPlugin = x;'], {})).toEqual(['Plugin']);
  });
});
