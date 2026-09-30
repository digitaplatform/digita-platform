/**
 * A dark band: one block of a website page that shows in dark mode while the page around it is
 * light. The website renderer stamps `data-block` on every block's wrapper and `data-variant` with
 * the block's `theme_variant`, so the pair never matches the kit's own `data-variant` on a button,
 * badge or card. `:where()` adds nothing to the specificity, so the selector weighs one attribute,
 * as much as the `.dark` class it stands in for.
 */
export const DARK_BAND_SELECTOR = '[data-variant="dark"]:where([data-block])';

const DARK_CLASS = /\.dark(?![\w-])/y;

/** Walks `text` outside strings and calls `visit` with each index and its bracket depth. */
function forEachOutsideStrings(text: string, visit: (index: number, depth: number) => boolean | void): void {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (visit(i, depth) === false) return;
  }
}

/** The indexes and depths of the `.dark` class in `text`; a `.dark` inside a string is no class. */
function darkClasses(text: string): { index: number; depth: number }[] {
  const found: { index: number; depth: number }[] = [];
  forEachOutsideStrings(text, (index, depth) => {
    DARK_CLASS.lastIndex = index;
    if (DARK_CLASS.test(text)) found.push({ index, depth });
  });
  return found;
}

function splitSelectorList(selectorList: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  forEachOutsideStrings(selectorList, (i, depth) => {
    if (depth !== 0 || selectorList[i] !== ',') return;
    selectors.push(selectorList.slice(start, i).trim());
    start = i + 1;
  });
  selectors.push(selectorList.slice(start).trim());
  return selectors;
}

/** Where the first compound selector of `selector` ends: at its first top-level combinator. */
function firstCompoundEnd(selector: string): number {
  let end = selector.length;
  forEachOutsideStrings(selector, (i, depth) => {
    if (depth !== 0 || !/[\s>+~]/.test(selector.charAt(i))) return;
    end = i;
    return false;
  });
  return end;
}

/** Whether `compound` carries a pseudo-class or pseudo-element other than `:root`. */
function carriesPseudoBesideRoot(compound: string): boolean {
  let carries = false;
  forEachOutsideStrings(compound, (i, depth) => {
    if (depth !== 0 || compound[i] !== ':') return;
    if (compound.startsWith(':root', i) && !/[\w-]/.test(compound.charAt(i + ':root'.length))) return;
    carries = true;
    return false;
  });
  return carries;
}

/** The twin of one selector scoped by `.dark`: the band stands where the class stood. */
function bandTwin(selector: string): string {
  const [dark, ...more] = darkClasses(selector);
  const end = firstCompoundEnd(selector);
  if (!dark || more.length || dark.depth !== 0 || dark.index >= end) {
    // A shape this step does not know, such as `:not(.dark)` or `.dark` after a combinator, would
    // otherwise stay light inside a band without anyone noticing.
    throw new Error(`[theme] dark band: the selector "${selector}" carries .dark outside its first compound`);
  }
  const compound = selector.slice(0, dark.index) + selector.slice(dark.index + '.dark'.length, end);
  const rest = selector.slice(end);
  if (carriesPseudoBesideRoot(compound) || /^\s*[+~]/.test(rest)) {
    // The rest of the compound becomes an ancestor of the band. A pseudo-element there makes an
    // invalid selector, and a browser then drops the whole rule, the original included; a
    // pseudo-class such as `:hover` would test an ancestor; a sibling combinator would reach the
    // block beside the band.
    throw new Error(`[theme] dark band: the selector "${selector}" has a shape its band twin cannot keep`);
  }
  return compound ? `${compound} ${DARK_BAND_SELECTOR}${rest}` : `${DARK_BAND_SELECTOR}${rest}`;
}

/** One rule's selector list with the band twin of each `.dark` selector it does not carry yet. */
function withBandTwins(selectorList: string, indent: string): string {
  const selectors = splitSelectorList(selectorList);
  const present = new Set(selectors.map((s) => s.replace(/\s+/g, ' ')));
  const twins = selectors
    .filter((s) => darkClasses(s).length > 0)
    .map(bandTwin)
    .filter((twin) => !present.has(twin.replace(/\s+/g, ' ')));
  return twins.length ? `${selectorList},\n${twins.map((twin) => indent + twin).join(',\n')}` : selectorList;
}

/**
 * Gives every rule whose selector is scoped by the `.dark` class the twin of that selector scoped
 * by a dark band, so everything that flips with dark mode flips inside a band on a light page too:
 * `.dark X` gains `[data-variant="dark"]:where([data-block]) X`, `:root[data-design="x"].dark` gains
 * `:root[data-design="x"] [data-variant="dark"]:where([data-block])`. The twin joins the rule's own
 * selector list, so no declaration is copied and the twin keeps its original's place in the cascade;
 * the band selector weighs as much as `.dark`, so a twin has its original's specificity and wins or
 * loses every tie exactly where its original does. A twin the list carries already is not added
 * again, so the step can run over CSS that went through it before.
 */
export function addDarkBandSelectors(css: string): string {
  let out = '';
  let copied = 0;
  let boundary = 0;
  let quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close === -1 ? css.length : close + 1;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ';' || c === '}') boundary = i + 1;
    else if (c === '{') {
      const prelude = css.slice(boundary, i);
      // The comments and blank lines in front of a rule are not part of its selector.
      const lead = /^(?:\s|\/\*[\s\S]*?\*\/)*/.exec(prelude)![0];
      const selectorList = prelude.slice(lead.length).trimEnd();
      if (!selectorList.startsWith('@') && darkClasses(selectorList).length > 0) {
        if (selectorList.includes('/*')) {
          throw new Error(`[theme] dark band: a comment inside the selector "${selectorList}"`);
        }
        const start = boundary + lead.length;
        out += css.slice(copied, start) + withBandTwins(selectorList, /[ \t]*$/.exec(lead)![0]);
        copied = start + selectorList.length;
      }
      boundary = i + 1;
    }
  }
  return out + css.slice(copied);
}

/** Escapes what could end a declaration, a rule or the `<style>` element that carries it. */
function cssValue(value: string): string {
  return value.replace(/[<>{};\\]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

/**
 * The rule that keeps a site's own identity inside a dark band. The site's signature and the
 * tenant's brand are inline properties on the document root, which beat every token block there;
 * inside a band the band twins of the dark token blocks declare the design's own values on the
 * band's element, so the same properties are declared again for the band. `!important` puts them
 * over every band twin, the way an inline property stands over every token block on the root. The
 * signature's colors are `light-dark()` pairs, so they take their dark side in the band's
 * `color-scheme: dark`.
 */
export function darkBandIdentityRule(properties: Record<string, string>): string {
  const declarations = Object.entries(properties).map(([name, value]) => `${name}: ${cssValue(value)} !important;`);
  return declarations.length ? `:root ${DARK_BAND_SELECTOR} { ${declarations.join(' ')} }` : '';
}
