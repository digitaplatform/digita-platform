/**
 * CSS value grammars for report definitions — the single validator shared by
 * digita-report's server renderer, its Zod schema, and the designer canvas.
 *
 * WHY THIS EXISTS: report definitions carry author-supplied colour, background,
 * border-colour and font-family strings that both renderers concatenate into
 * CSS. HTML-escaping (which the renderer already does) prevents breaking OUT of
 * a `style="…"` attribute, but leaves `;`, `(`, `)` and `/` intact — so a value
 * such as `red;background:url(http://169.254.169.254/)` survives into the
 * declaration block and the server-side Chromium fetches it during PDF export.
 * That is a server-side request forgery, and it is closed here.
 *
 * The design is an ALLOW-grammar, never a deny-list: the functional-colour
 * argument class contains no letters, parentheses or quotes at all, which
 * structurally excludes `url()`, `image-set()`, `expression()`, `@import`,
 * comments, CSS escapes and declaration-append — without having to enumerate
 * them. Font families are parsed into tokens and RE-SERIALIZED, so the emitted
 * value is well-formed by construction and cannot carry a trailing declaration.
 *
 * Every helper returns the canonical value, or `null` when the input is not in
 * the grammar. Callers decide what rejection means: the Zod schema turns `null`
 * into a 400 (fail closed at write); the renderer drops the declaration and
 * records a warning (a stored legacy value must not make a report permanently
 * unrenderable). Neither is silent.
 */

/** Values longer than this are rejected outright — no legitimate value is near it. */
const MAX_VALUE_LENGTH = 256;

/** CSS Color Module Level 4 named colours, plus the two keywords we honour. */
const NAMED_COLORS: ReadonlySet<string> = new Set([
  "transparent", "currentcolor",
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque",
  "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood",
  "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk",
  "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray",
  "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen",
  "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise",
  "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue",
  "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro",
  "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey",
  "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral",
  "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
  "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen",
  "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue",
  "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue",
  "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace",
  "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod",
  "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff",
  "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red",
  "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen",
  "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray",
  "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle",
  "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow",
  "yellowgreen",
]);

/** CSS generic font families — emitted unquoted, they are keywords not names. */
const GENERIC_FONT_FAMILIES: ReadonlySet<string> = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
]);

/**
 * bwip-js symbologies (`bcid`) the report renderer supports. The renderer
 * inserts bwip-js' SVG output UNESCAPED, so this allow-list bounds which of the
 * library's code paths author-shaped input can reach. Extend deliberately.
 */
const ALLOWED_BARCODE_SYMBOLOGIES: ReadonlySet<string> = new Set([
  "code128", "code39", "ean13", "ean8", "upca", "upce",
  "qrcode", "datamatrix", "pdf417", "azteccode",
  "interleaved2of5", "itf14", "gs1-128",
]);

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
/** One level of parens, no nesting: the body is captured and checked separately. */
const FUNCTIONAL_COLOR = /^(rgba?|hsla?)\(([^()]*)\)$/;
/** Digits, separators and signs only — deliberately no letters, quotes or parens. */
const FUNCTIONAL_COLOR_ARGS = /^[0-9.,%\s/+-]+$/;
/** An unquoted CSS family name: identifier characters and single inner spaces. */
const BARE_FONT_TOKEN = /^[A-Za-z][A-Za-z0-9 _-]*$/;
/** Inside a quoted family name — no backslash escapes, no quotes, no separators. */
const QUOTED_FONT_TOKEN = /^[A-Za-z0-9 _.-]+$/;
/** C0 controls + DEL: a newline or CSS escape in a value is never legitimate. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Shared preconditions for every grammar below. */
function normalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) return null;
  if (CONTROL_CHARS.test(trimmed)) return null;
  return trimmed;
}

/**
 * A CSS colour: `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, a named colour,
 * `transparent`/`currentColor`, or `rgb()`/`rgba()`/`hsl()`/`hsla()` whose
 * arguments are purely numeric. Returns the canonical (lower-cased) value.
 */
export function safeCssColor(value: unknown): string | null {
  const v = normalize(value);
  if (v === null) return null;
  const lower = v.toLowerCase();

  if (HEX_COLOR.test(lower)) return lower;
  if (NAMED_COLORS.has(lower)) return lower;

  const fn = FUNCTIONAL_COLOR.exec(lower);
  if (fn && FUNCTIONAL_COLOR_ARGS.test(fn[2]!.trim())) return lower;

  return null;
}

/**
 * A CSS `font-family` list. Each token is either a generic keyword, a bare
 * family name, or a quoted family name. The list is parsed and re-serialized
 * (quoting exactly the names that need it), so the emitted value is well-formed
 * by construction.
 */
export function safeCssFontFamily(value: unknown): string | null {
  const v = normalize(value);
  if (v === null) return null;

  const out: string[] = [];
  for (const raw of v.split(",")) {
    const token = raw.trim();
    if (!token) return null;

    const quoted =
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"));

    if (quoted) {
      const inner = token.slice(1, -1).trim();
      if (!QUOTED_FONT_TOKEN.test(inner)) return null;
      out.push(`"${inner}"`);
      continue;
    }

    if (GENERIC_FONT_FAMILIES.has(token.toLowerCase())) {
      out.push(token.toLowerCase());
      continue;
    }

    if (!BARE_FONT_TOKEN.test(token)) return null;
    // A bare name is legal unquoted only as a sequence of identifiers; quoting
    // any name that contains a space removes the ambiguity entirely.
    out.push(token.includes(" ") ? `"${token}"` : token);
  }

  return out.length ? out.join(", ") : null;
}

/** Membership test for the barcode symbologies the renderer will hand to bwip-js. */
export function isAllowedBarcodeSymbology(value: unknown): boolean {
  const v = normalize(value);
  return v !== null && ALLOWED_BARCODE_SYMBOLOGIES.has(v.toLowerCase());
}

/** The supported symbologies, for error messages and designer pickers. */
export function allowedBarcodeSymbologies(): string[] {
  return [...ALLOWED_BARCODE_SYMBOLOGIES];
}
