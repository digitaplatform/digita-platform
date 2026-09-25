// Finds hard-coded design values in the website's source: a colour, a radius, a shadow or a font
// the theme does not name. The theme's Tailwind preset only EXTENDS Tailwind, so Tailwind's own
// palette, radii, shadows and serif stack stay usable and would bypass the theme. Scripts are
// parsed, so a class list or a style value is judged as a whole however it is split over lines,
// and comments, identifiers and types are never read as values; CSS is read per declaration and
// SVG per attribute.
import ts from "typescript";
import { createRequire } from "node:module";

/** Tailwind's default palette and its v2 names; the theme's own colour names (primary, neutral,
 *  accent, …) are not in it. */
const PALETTE =
  "slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|lightBlue|warmGray|trueGray|coolGray|blueGray";
const COLOUR_UTILITY = String.raw`(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|divide|outline|decoration|accent|caret|fill|stroke|from|via|to|placeholder|shadow)`;
/** The CSS named colours (white, red, rebeccapurple, …), as the CSS standard lists them. */
const NAMED_COLOUR = new RegExp(
  String.raw`\b(?:${Object.keys(createRequire(import.meta.url)("color-name") as Record<string, unknown>).join("|")})\b`,
  "i",
);
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i;

/** Rules for one class list, read as a whole. */
const CLASS_RULES: { name: string; pattern: RegExp }[] = [
  {
    name: "colour from Tailwind's palette instead of the theme",
    pattern: new RegExp(String.raw`\b${COLOUR_UTILITY}-(?:white|black|(?:${PALETTE})-\d{2,3})\b`),
  },
  { name: "radius outside the theme tokens", pattern: /(?<![\w-])rounded(?:-[trblse]{1,2})?(?:-(?:none|sm|md|lg|xl|2xl|3xl))?(?![\w-])/ },
  { name: "shadow outside the theme tokens", pattern: /(?<![\w-])(?:drop-shadow(?:-\w+)?|shadow(?:-(?:xl|2xl|inner))?)(?![\w-])/ },
  { name: "font outside the theme tokens", pattern: /(?<![\w-])font-serif(?![\w-])/ },
  {
    name: "arbitrary value on a design utility",
    pattern: /\b(?:text|bg|rounded|shadow|border|font|leading|tracking|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|placeholder)-\[/,
  },
  {
    name: "arbitrary design property",
    pattern: /\[(?:color|background(?:-color)?|border(?:-[a-z]+)*|box-shadow|text-shadow|outline(?:-color)?|fill|stroke|font(?:-family)?|--tw-[a-z-]*color)\s*:/,
  },
];
/** A ring width paints Tailwind's default blue unless the same list names a ring colour. */
const RING_WIDTH = /(?<![\w-])ring(?:-[1-9]\d*)?(?![\w-])/;
const RING_COLOUR = /(?<![\w-])ring-(?!\d|inset\b|offset)[a-zA-Z]/;

/** A style key (camel case) or a CSS property (kebab case) whose value is a colour. */
const COLOUR_KEY = /(?:colou?r$|^(?:background(?:-?image)?|border(?:-?(?:top|right|bottom|left|inline|block)(?:-?(?:start|end))?)?|outline|box-?shadow|text-?shadow|text-?decoration|fill|stroke|column-?rule)$)/i;
/** JSX and SVG attributes whose value is a colour. */
const COLOUR_ATTRIBUTE = /^(?:fill|stroke|color|stop-?color|flood-?color|lighting-?color)$/i;
const CLASS_HOLDER = /^(?:className|class)$|(?:Class|ClassName|Classes)$/;

const withoutUrls = (value: string) => value.replace(/url\([^)]*\)/gi, "");
const isNamedColour = (value: string) => NAMED_COLOUR.test(withoutUrls(value));
const isLiteralFont = (value: string) => !/^\s*["']?var\(/.test(value);

/** Every hard-coded design value in one source file, as `<file>:<line> <rule>: <text>`. */
export function designValueFindings(file: string, text: string): string[] {
  if (file.endsWith(".css")) return cssFindings(file, text);
  if (file.endsWith(".svg")) return svgFindings(file, text);
  return scriptFindings(file, text);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function scriptFindings(file: string, text: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const findings: string[] = [];
  const report = (node: ts.Node, rule: string) =>
    findings.push(
      `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${rule}: ${node
        .getText(source)
        .replace(/\s+/g, " ")
        .slice(0, 120)}`,
    );

  /** The text of every string literal and template chunk under `node`. */
  const stringsIn = (node: ts.Node): string[] => {
    const found: string[] = [];
    const walk = (n: ts.Node) => {
      if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) found.push(n.text);
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };
  const nameOf = (name: ts.Node | undefined): string | undefined =>
    name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name))
      ? name.text
      : name && ts.isJsxNamespacedName(name)
        ? `${name.namespace.text}:${name.name.text}`
        : undefined;

  const checkClassList = (holder: ts.Node, value: ts.Node) => {
    const list = stringsIn(value).join(" ");
    for (const rule of CLASS_RULES) if (rule.pattern.test(list)) report(holder, rule.name);
    if (RING_WIDTH.test(list) && !RING_COLOUR.test(list)) report(holder, "ring width without a ring colour (Tailwind's default blue)");
  };
  const checkColour = (holder: ts.Node, value: ts.Node) => {
    if (stringsIn(value).some(isNamedColour)) report(holder, "named colour");
  };

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (COLOUR_LITERAL.test(withoutUrls(node.text))) report(node, "colour literal");
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = nameOf(node.name) ?? "";
      if (CLASS_HOLDER.test(name)) return checkClassList(node, node.initializer);
      if (COLOUR_ATTRIBUTE.test(name)) checkColour(node, node.initializer);
    }
    if ((ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node)) && node.initializer) {
      const name = nameOf(node.name) ?? "";
      if (CLASS_HOLDER.test(name)) return checkClassList(node, node.initializer);
      if (COLOUR_KEY.test(name)) checkColour(node, node.initializer);
      if (/^font-?family$/i.test(name) && stringsIn(node.initializer).some(isLiteralFont)) report(node, "font outside the theme tokens");
    }
    if (ts.isCallExpression(node) && /^(?:cn|clsx|twMerge)$/.test(node.expression.getText(source))) {
      return checkClassList(node, node);
    }
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === "meta") {
      const attribute = (name: string) =>
        node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && nameOf(p.name) === name);
      const content = attribute("content");
      if (content?.initializer && attribute("name")?.initializer?.getText(source).includes("theme-color")) checkColour(content, content.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** CSS declarations `property: value` inside rule blocks; a selector or an @media condition is
 *  followed by `{` and never read as one. */
function declarationFindings(file: string, text: string, offset: (index: number) => number): string[] {
  const findings: string[] = [];
  for (const match of text.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]*)(?=[;}])/g)) {
    const [, property = "", value = ""] = match;
    const line = offset(match.index ?? 0);
    if (COLOUR_KEY.test(property) && isNamedColour(value)) findings.push(`${file}:${line} named colour: ${match[0].trim()}`);
    if (/^font-family$/i.test(property) && isLiteralFont(value)) findings.push(`${file}:${line} font outside the theme tokens: ${match[0].trim()}`);
  }
  return findings;
}

function cssFindings(file: string, text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const findings = declarationFindings(file, code, (index) => lineOf(code, index));
  for (const match of code.matchAll(new RegExp(COLOUR_LITERAL.source, "gi"))) {
    findings.push(`${file}:${lineOf(code, match.index ?? 0)} colour literal: ${match[0]}`);
  }
  return findings;
}

function svgFindings(file: string, text: string): string[] {
  const findings: string[] = [];
  for (const match of text.matchAll(/\s([a-zA-Z-:]+)\s*=\s*"([^"]*)"/g)) {
    const [, name = "", value = ""] = match;
    const index = match.index ?? 0;
    if (COLOUR_ATTRIBUTE.test(name) && isNamedColour(value)) findings.push(`${file}:${lineOf(text, index)} named colour: ${match[0].trim()}`);
    if (name === "style") findings.push(...declarationFindings(file, `${value};`, () => lineOf(text, index)));
    if (COLOUR_LITERAL.test(withoutUrls(value))) findings.push(`${file}:${lineOf(text, index)} colour literal: ${match[0].trim()}`);
  }
  return findings;
}
