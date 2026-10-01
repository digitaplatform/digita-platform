import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The primary colour as text takes the theme role text-primaryText: a ramp step is the same in
// both modes, and no step reaches 4.5:1 on both a light and a dark canvas. The scan is per file, so a
// class split across cn() arguments, a concatenation or a template literal cannot slip through. The
// kit and the website keep the same rule.
const ROOTS = [join(__dirname, '../src'), join(__dirname, '../../components/src'), join(__dirname, '../../web/src')];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

/** Tailwind text-colour classes with a primary ramp step, with any variant or important prefix. */
function rampTextColours(text: string): string[] {
  return [...text.matchAll(/(?<![\w-])!?(?:[\w[\]&:-]+:)*text-primary-\d{2,3}(?:\/\d+)?(?![\w-])/g)].map((match) => match[0]);
}

describe('the primary colour drawn as text', () => {
  it('finds a planted ramp step however it is written, so the scan can go red', () => {
    for (const planted of [
      `className="font-medium text-primary-600"`,
      `cn('rounded', active && 'text-primary-600', className)`,
      `'text-sm ' + 'text-primary-600'`,
      "`px-2 ${open ? 'ring-2' : ''} text-primary-600`",
      `className="hover:text-primary-600"`,
      `className="text-primaryText dark:text-primary-400"`,
      `className="[&_a]:text-primary-600"`,
      `className="!text-primary-700/80"`,
    ]) {
      expect(rampTextColours(planted), planted).toHaveLength(1);
    }
    for (const innocent of [
      `className="font-medium text-primaryText"`,
      `className="text-primaryGraphic"`,
      `className="bg-primary-600 text-onPrimary"`,
      `className="border-primary-600"`,
    ]) {
      expect(rampTextColours(innocent), innocent).toHaveLength(0);
    }
  });

  it('never draws text in a primary ramp step; it takes the primaryText or primaryGraphic role', () => {
    const files = ROOTS.flatMap(sources);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) => rampTextColours(readFileSync(file, 'utf8')).map((cls) => `${file}: ${cls}`));
    expect(offenders).toEqual([]);
  });
});
