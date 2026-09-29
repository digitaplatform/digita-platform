// The theme self-hosts every font it declares, so a visitor's address never reaches Google.
// Only this scan proves it: without it a font change that brings a fonts.googleapis.com or
// fonts.gstatic.com URL back into the built CSS, the theme or the website stays green.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const THEME = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = join(THEME, '..');
const BUILT_CSS = join(THEME, 'dist', 'theme.css');
// This file names the hosts as its planted defect, so it is the one source the scan skips.
const SELF = fileURLToPath(import.meta.url);
// Installed packages and build output are not sources; the built CSS is scanned by name.
const NOT_SOURCE = new Set(['node_modules', 'dist', '.next']);
const GOOGLE_FONTS_HOST = /fonts\.(?:googleapis|gstatic)\.com/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return NOT_SOURCE.has(name) ? [] : sources(path);
    return /\.(tsx?|mjs|css)$/.test(name) && path !== SELF ? [path] : [];
  });
}

function googleFontsHostFindings(file: string, text: string): string[] {
  return text
    .split('\n')
    .flatMap((line, i) => (GOOGLE_FONTS_HOST.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
}

describe('no font of the theme or the website is loaded from Google', () => {
  const files = [BUILT_CSS, ...sources(THEME), ...sources(join(PACKAGES, 'web'))];

  it('reads the built CSS and every source of both packages, so a clean answer means it was looked at', () => {
    expect(existsSync(BUILT_CSS), 'build the theme first: pnpm --filter @digitaplatform/theme build').toBe(true);
    expect(files.length).toBeGreaterThan(20);
    for (const tail of ['theme/build/gen-css.mjs', 'web/src/app/globals.css', 'web/src/app/[locale]/layout.tsx']) {
      expect(files.some((f) => f.endsWith(tail)), tail).toBe(true);
    }
  });

  it('finds no fonts.googleapis.com or fonts.gstatic.com reference', () => {
    const found = files.flatMap((f) => googleFontsHostFindings(relative(PACKAGES, f), readFileSync(f, 'utf8')));
    expect(found, 'self-host the font: a ./fonts/*.woff2 file declared in theme/build/gen-css.mjs').toEqual([]);
  });
});

describe('PROBES: the scan catches a Google Fonts host and nothing else', () => {
  it('catches a planted defect of each shape', () => {
    for (const planted of [
      `@font-face {\n  font-family: 'Inter';\n  src: url(https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff2) format('woff2');\n}`,
      `@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400..700&display=swap');`,
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />`,
      `const href = "//fonts.googleapis.com/css?family=Space+Grotesk";`,
    ]) {
      expect(googleFontsHostFindings('x.css', planted), planted).toHaveLength(1);
    }
  });

  it('PLANTED INNOCENT: a self-hosted src, the family names and a comment naming Google Fonts pass', () => {
    for (const innocent of [
      `@font-face {\n  font-family: 'Space Grotesk';\n  src: url('./fonts/SpaceGrotesk-latin.woff2') format('woff2');\n}`,
      `body { font-family: 'Manrope', 'Inter', 'JetBrains Mono', sans-serif; }`,
      `/* Space Grotesk, Manrope and JetBrains Mono come from Google Fonts, self-hosted from ./fonts. */`,
    ]) {
      expect(googleFontsHostFindings('x.css', innocent), innocent).toEqual([]);
    }
  });
});
