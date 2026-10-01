import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Git takes a file that holds a NUL byte for binary and shows no diff of it, so no reviewer sees a
// change to it. A string that needs the character spells it as the escape `\u0000`, which builds the
// same string.
const SRC = join(__dirname, '../src');
const holdsNul = (text: string) => text.includes('\0');

describe('the sources of the kit', () => {
  it('finds a planted NUL byte and passes its escape, so the scan can go red', () => {
    expect(holdsNul("rows.map(getRowId).join('\0')")).toBe(true);
    expect(holdsNul("rows.map(getRowId).join('\\u0000')")).toBe(false);
  });

  it('hold no NUL byte, so git shows every change to them as text', () => {
    const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((name) => /\.tsx?$/.test(name));
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.filter((name) => holdsNul(readFileSync(join(SRC, name), 'utf8')))).toEqual([]);
  });
});
