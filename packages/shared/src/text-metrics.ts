/**
 * Isomorphic text measurement — the P0 replacement for `prepare.ts`'s
 * `AVG_GLYPH_FACTOR` estimate (every glyph assumed 55% of the font size,
 * wrapping mid-word). Given a per-font advance-width table, this reproduces how
 * Blink breaks lines under `white-space: pre-wrap`, so `can_grow` band heights —
 * and therefore page breaks — match what Chromium prints.
 *
 * Proven by Spike A (see `digita-report/docs/SPIKE-A-measurement.md`): offline
 * advance-width tables reproduce Blink line breaking to ~100% on realistic
 * report text, IF the renderer uses `font-kerning: none` so Blink measures pure
 * advances too. Both the server (`prepare`) and the future designer canvas call
 * this one function, so what you design is measured exactly as it prints.
 *
 * Pure and dependency-free: the width table is DATA (generated offline from the
 * bundled font), so this file runs unchanged in Node and the browser.
 */

/** Per-font advance-width table, generated offline from the font's `hmtx`/`cmap`. */
export interface FontWidthTable {
  /** The font's design-unit grid (advances are in these units). */
  unitsPerEm: number;
  /** Unicode code point (as a decimal string key) → advance width in font units. */
  advance: Record<string, number>;
  /** Advance for a code point absent from `advance` (a font-specific fallback). */
  defaultAdvance: number;
}

/**
 * Break-after characters — a pragmatic UAX #14 subset that covers report text.
 * The dash family (‐ – —) always offers a soft-wrap opportunity. The
 * hyphen-minus and solidus are handled specially in `tokenize`: UAX #14 LB25
 * forbids a break between them and a following DIGIT (so `2026-01-15`, `ART-4711`,
 * `01/2026` stay one token), which a naive break-after would get wrong.
 */
const DASHES = new Set(["‐", "–", "—"]);
const HYPHEN = "-";
const SOLIDUS = "/";

/**
 * Sub-pixel tolerance, denominated in PIXELS (not font units) so it is
 * independent of font size and units-per-em. Blink snaps line-box widths to
 * LayoutUnits of 1/64 px; one LayoutUnit of slack plus a margin (≈ 1/32 px)
 * absorbs the quantization mismatch without ever masking a real glyph.
 */
const EPSILON_PX = 1 / 32;

/**
 * Code points that occupy no advance width: combining marks (Blink composes
 * them onto the base glyph), zero-width joiners/non-joiners, variation selectors
 * and the zero-width space. A naive table lookup would bill these a full
 * `defaultAdvance` and over-count width, so they are forced to zero here
 * regardless of the table.
 */
function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) || // combining marks for symbols
    cp === 0x200b || // zero-width space
    cp === 0x200c || // ZWNJ
    cp === 0x200d || // ZWJ
    cp === 0xad || // soft hyphen — invisible unless it becomes a break
    (cp >= 0xfe00 && cp <= 0xfe0f) // variation selectors
  );
}

/** Advance width of one code point, in font design units. */
function advanceOf(table: FontWidthTable, codePoint: number): number {
  if (isZeroWidth(codePoint)) return 0;
  const w = table.advance[String(codePoint)];
  return w === undefined ? table.defaultAdvance : w;
}

/** Width of a string in font design units (no kerning — see the module note). */
function widthUnits(table: FontWidthTable, s: string): number {
  let w = 0;
  for (const ch of s) w += advanceOf(table, ch.codePointAt(0)!);
  return w;
}

/**
 * Split a line into `{ ink, space }` chunks at break opportunities. A chunk's
 * `ink` is breakable content ending at a break-after char (inclusive) or at the
 * start of a space run; `space` is the trailing spaces that follow it, which
 * "hang" at a wrap (CSS pre-wrap preserves them but they never force a break).
 */
function tokenize(s: string): { ink: string; space: string }[] {
  const chunks: { ink: string; space: string }[] = [];
  let ink = "";
  let i = 0;
  const takeSpaces = (): string => {
    let sp = "";
    while (i < s.length && s[i] === " ") {
      sp += " ";
      i += 1;
    }
    return sp;
  };
  while (i < s.length) {
    const c = s[i]!;
    if (c === " ") {
      chunks.push({ ink, space: takeSpaces() });
      ink = "";
      continue;
    }
    ink += c;
    i += 1;
    const next = s[i];
    // A soft hyphen (U+00AD) is a break opportunity only; it is invisible
    // (zero-width, see isZeroWidth) until it lands at a line end.
    if (c === "\u00ad") {
      chunks.push({ ink, space: takeSpaces() });
      ink = "";
      continue;
    }
    // LB25: no break between a hyphen-minus / solidus and a following digit
    // (dates, article numbers, fractions stay whole). Dashes always break.
    const breaks =
      DASHES.has(c) ||
      ((c === HYPHEN || c === SOLIDUS) && !(next !== undefined && next >= "0" && next <= "9"));
    if (breaks) {
      chunks.push({ ink, space: takeSpaces() });
      ink = "";
    }
  }
  if (ink !== "") chunks.push({ ink, space: "" });
  return chunks.length ? chunks : [{ ink: "", space: "" }];
}

/**
 * How many lines `text` wraps to at `fontSizePx` in `availablePx`, under
 * `white-space: pre-wrap` with `font-kerning: none`. Newlines force breaks;
 * a chunk wider than the line takes its own line and overflows (no word-break).
 * Always ≥ 1.
 */
export function countWrappedLines(
  text: string,
  table: FontWidthTable,
  fontSizePx: number,
  availablePx: number,
): number {
  if (fontSizePx <= 0 || availablePx <= 0) return 1;
  const scale = fontSizePx / table.unitsPerEm; // px per font unit
  const availUnits = availablePx / scale;
  const epsilonUnits = EPSILON_PX / scale;

  // Normalize the way the HTML parser does before Blink lays text out:
  // CRLF / lone CR → LF (a CR is never ink and never its own break), and NFC
  // so a decomposed umlaut is one glyph, not a base + a fallback-width mark.
  const normalized = text.replace(/\r\n?/g, "\n").normalize("NFC");

  let lines = 0;
  for (const segment of normalized.split("\n")) {
    lines += wrapSegment(segment, table, availUnits, epsilonUnits);
  }
  return Math.max(1, lines);
}

function wrapSegment(
  segment: string,
  table: FontWidthTable,
  availUnits: number,
  epsilonUnits: number,
): number {
  if (segment === "") return 1;
  let lines = 1;
  let cur = 0; // width of the current line incl. its trailing spaces

  for (const { ink, space } of tokenize(segment)) {
    const wInk = widthUnits(table, ink);
    const wSp = widthUnits(table, space);
    if (cur === 0) {
      // an empty line takes the first chunk whatever its width (may overflow).
      // The test is `cur === 0`, not "no ink yet", so leading spaces count as
      // line content and a following word can wrap past them (fixes an
      // under-count on indented continuation lines).
      cur = wInk + wSp;
    } else if (cur + wInk <= availUnits + epsilonUnits) {
      // the chunk's ink must fit; its own trailing spaces then hang.
      cur = cur + wInk + wSp;
    } else {
      lines += 1;
      cur = wInk + wSp;
    }
  }
  return lines;
}
