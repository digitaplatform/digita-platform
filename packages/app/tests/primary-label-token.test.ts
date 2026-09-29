import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A label takes a theme token (text-onPrimary on a primary fill, #89): a literal white is 2.41:1 on the
// digita cyan and 4.02:1 on the default blue, and a literal black fails on a dark fill. The scan is per
// file, not per string, so a fill and its label split across cn() arguments, a concatenation or a
// template literal cannot slip through. The components package keeps the same rule.
const ROOTS = [join(__dirname, '../src'), join(__dirname, '../../components/src')];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

/** Tailwind text-colour classes with a literal white or black, with any variant or important prefix. */
function literalLabels(text: string): string[] {
  return [...text.matchAll(/(?<![\w-])!?(?:[\w[\]&:-]+:)*text-(?:white|black|\[(?:#(?:fff|ffffff|000|000000)|white|black)\])(?:\/\d+)?(?![\w-])/gi)].map(
    (match) => match[0],
  );
}

describe('the label colours of the app and the kit', () => {
  it('finds a planted literal label however it is written, so the scan can go red', () => {
    for (const planted of [
      `className="bg-primary-600 text-white"`,
      `cn('rounded bg-primary-600', 'text-white shadow-sm', className)`,
      `'bg-primary-600 ' + 'text-white'`,
      "`bg-primary-600 ${open ? 'ring-2' : ''} text-white`",
      `className="focus:bg-primary-600 focus:text-white"`,
      `className="bg-primary-600 !text-white"`,
      `className="bg-primary-600 text-[#fff]"`,
      `className="bg-primary-600 text-black/90"`,
    ]) {
      expect(literalLabels(planted), planted).toHaveLength(1);
    }
    for (const innocent of [`className="bg-primary-600 text-onPrimary"`, `className="bg-white"`, `const whiteList = 1`, `className="text-whitespace"`]) {
      expect(literalLabels(innocent), innocent).toHaveLength(0);
    }
  });

  it('never label with a literal white or black; a label takes a theme token', () => {
    const offenders = ROOTS.flatMap(sources).flatMap((file) =>
      literalLabels(readFileSync(file, 'utf8')).map((label) => `${file}: ${label}`),
    );
    expect(offenders).toEqual([]);
  });
});
