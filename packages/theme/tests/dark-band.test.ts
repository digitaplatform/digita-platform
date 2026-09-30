// A website block set to theme_variant "dark" is a dark band on a light page: every rule that flips
// with the `.dark` class flips inside the band too. The step that gives each such rule its band twin
// is proven on planted shapes first, then on the whole generated theme.css.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { addDarkBandSelectors, darkBandIdentityRule, DARK_BAND_SELECTOR } from '../src/index.js';

const BAND = DARK_BAND_SELECTOR;
// vitest runs a package's tests from its root; theme.css is the artifact `pnpm build` writes.
const THEME_CSS = readFileSync(join(process.cwd(), 'dist/theme.css'), 'utf8');

/** Every style rule's selector list and declarations, @media rules included, as a browser parses them. */
function styleRules(css: string): { selectors: string[]; style: CSSStyleDeclaration }[] {
  const { window } = new JSDOM(`<style>${css}</style>`);
  const out: { selectors: string[]; style: CSSStyleDeclaration }[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof window.CSSStyleRule) {
        out.push({ selectors: rule.selectorText.split(/,\s*(?![^[(]*[\])])/).map((s) => s.trim()), style: rule.style });
      } else if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  walk(window.document.styleSheets[0]!.cssRules);
  return out;
}

const DARK = /\.dark(?![\w-])/;

/** A selector's specificity as [ids, classes, types], after Selectors Level 4; `:where()` weighs nothing. */
function specificity(selector: string): number[] {
  const total = [0, 0, 0];
  let i = 0;
  while (i < selector.length) {
    const rest = selector.slice(i);
    const fn = /^:(where|is|not|has)\(/.exec(rest);
    if (fn) {
      let depth = 1;
      let end = fn[0].length;
      for (; depth; end++) depth += rest[end] === '(' ? 1 : rest[end] === ')' ? -1 : 0;
      if (fn[1] !== 'where') {
        const args = rest.slice(fn[0].length, end - 1).split(/,(?![^(]*\))/).map(specificity);
        const heaviest = args.reduce((a, b) => ((a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!) >= 0 ? a : b));
        heaviest.forEach((n, k) => (total[k]! += n));
      }
      i += end;
      continue;
    }
    const token = /^(?:#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?|[a-zA-Z][\w-]*|[\s\S])/.exec(rest)![0];
    if (token[0] === '#') total[0]!++;
    else if (token[0] === '.' || token[0] === '[' || (token[0] === ':' && token[1] !== ':')) total[1]!++;
    else if (token.startsWith('::') || /^[a-zA-Z]/.test(token)) total[2]!++;
    i += token.length;
  }
  return total;
}

/** The band twin the step gives one `.dark` selector. */
const twinOf = (selector: string) => addDarkBandSelectors(`${selector} {}`).split(',\n')[1]!.replace(/ \{\}$/, '');

describe('addDarkBandSelectors', () => {
  it('PLANTED DEFECT: gives a token block and a descendant rule their band twin', () => {
    const css = ':root[data-design="x"].dark {\n  --a: 1;\n}\n.dark [data-ui="card"] { color: red; }\n';
    expect(addDarkBandSelectors(css)).toBe(
      `:root[data-design="x"].dark,\n:root[data-design="x"] ${BAND} {\n  --a: 1;\n}\n` +
        `.dark [data-ui="card"],\n${BAND} [data-ui="card"] { color: red; }\n`,
    );
  });

  it('twins every .dark selector of a list and a rule inside @media', () => {
    const css = '@media (hover: hover) {\n  .dark a:hover, .dark b { color: red; }\n}\n';
    expect(addDarkBandSelectors(css)).toBe(
      `@media (hover: hover) {\n  .dark a:hover, .dark b,\n  ${BAND} a:hover,\n  ${BAND} b { color: red; }\n}\n`,
    );
  });

  it('PLANTED INNOCENT: leaves comments, other classes and rules without .dark as they are', () => {
    const css = '/* .dark x { } */\n.dark-mode a { color: red; }\n[data-x=".dark"] { color: blue; }\na { content: ".dark {"; }\n';
    expect(addDarkBandSelectors(css)).toBe(css);
  });

  it('adds no twin twice, so CSS that went through the step before stays as it is', () => {
    const once = addDarkBandSelectors('.dark a { color: red; }\n');
    expect(addDarkBandSelectors(once)).toBe(once);
  });

  it('refuses a .dark it cannot twin, instead of leaving the rule light inside a band', () => {
    expect(() => addDarkBandSelectors(':root:not(.dark) a { color: red; }')).toThrow(/outside its first compound/);
    expect(() => addDarkBandSelectors('main .dark a { color: red; }')).toThrow(/outside its first compound/);
  });
});

describe('theme.css flips inside a dark band', () => {
  const rules = styleRules(THEME_CSS);
  const darkSelectors = rules.flatMap((r) => r.selectors.filter((s) => DARK.test(s)).map((s) => ({ s, r })));

  it('reads the whole sheet, so a clean answer means it was looked at', () => {
    // The token blocks, the scrollbar, color-scheme, base.css and the minimal variant layer.
    expect(darkSelectors.length).toBeGreaterThan(40);
  });

  it('carries the band twin of every .dark selector in the same rule', () => {
    const missing = darkSelectors.filter(({ s, r }) => !r.selectors.includes(twinOf(s))).map(({ s }) => s);
    expect(missing).toEqual([]);
  });

  it('PLANTED DEFECT: the specificity count tells a band selector heavier than .dark from .dark', () => {
    expect(specificity('[data-block][data-variant="dark"] a')).not.toEqual(specificity('.dark a'));
    expect(specificity(`${BAND} a`)).toEqual(specificity('.dark a'));
  });

  it("gives every twin its original's specificity, so a twin wins and loses the ties its original does", () => {
    const unequal = darkSelectors
      .filter(({ s }) => specificity(twinOf(s)).join() !== specificity(s).join())
      .map(({ s }) => `${s} ${specificity(s)} / ${twinOf(s)} ${specificity(twinOf(s))}`);
    expect(unequal).toEqual([]);
  });

  it('gives the band color-scheme dark, so light-dark() colors take their dark side there', () => {
    const scheme = rules.filter((r) => r.selectors.includes(BAND)).map((r) => r.style.getPropertyValue('color-scheme'));
    expect(scheme).toContain('dark');
  });

  it('paints the band with the dark ground and text', () => {
    const own = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === BAND);
    expect(own?.style.getPropertyValue('background-color')).toBe('var(--color-bg)');
    expect(own?.style.getPropertyValue('color')).toBe('var(--color-text-main)');
  });

  it('never matches outside a band: the band is the subject or an ancestor of every twin', () => {
    const twins = rules.flatMap((r) => r.selectors.filter((s) => s.includes(BAND)));
    const escaped = BAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const shape = new RegExp(`^(?::root\\S*\\s)?${escaped}(?:\\s|$)`);
    expect(twins.filter((s) => !shape.test(s))).toEqual([]);
    const { window } = new JSDOM(
      '<html data-design="minimal"><body>' +
        '<div id="band" data-block="hero" data-variant="dark"><i id="inside"></i></div>' +
        '<div id="light" data-block="hero"><i id="outside"></i></div>' +
        '<button id="button" data-variant="dark"></button></body></html>',
    );
    const doc = window.document;
    const matched = (selector: string) => Array.from(doc.querySelectorAll(selector)).map((e) => e.id);
    expect(matched(`:root[data-design="minimal"] ${BAND}`)).toEqual(['band']);
    expect(matched(`${BAND} i`)).toEqual(['inside']);
  });
});

describe('darkBandIdentityRule', () => {
  it('declares the identity properties again for the band, over every band twin', () => {
    expect(darkBandIdentityRule({ '--color-bg': 'light-dark(#fff, #000)' })).toBe(
      `:root ${BAND} { --color-bg: light-dark(#fff, #000) !important; }`,
    );
  });

  it('PLANTED DEFECT: a tenant value cannot end the rule or the style element', () => {
    const rule = darkBandIdentityRule({ '--font-sans': 'x;}</style><script>' });
    expect(rule).not.toMatch(/[<>]|;\}/);
    expect(rule.match(/[{}]/g)).toEqual(['{', '}']);
  });

  it('PLANTED INNOCENT: writes no rule for a site without identity properties', () => {
    expect(darkBandIdentityRule({})).toBe('');
  });
});
