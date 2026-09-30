// @vitest-environment jsdom
// A block set to theme_variant "dark" is a dark band: the site's Tailwind `dark:` utilities, which
// draw the signature graphics and the kit's cards, apply inside the band as under the `.dark` root.
import { describe, it, expect, vi } from "vitest";
import postcss, { type AcceptedPlugin } from "postcss";
import tailwind, { type Config } from "tailwindcss";
import digitaTheme from "@digitaplatform/theme/preset";
import { DARK_BAND_SELECTOR } from "@digitaplatform/theme";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockRenderer } from "../src/blocks/BlockRenderer";
import type { Block } from "../src/lib/types";

vi.mock("server-only", () => ({}));

/** The selectors Tailwind builds for the classes in `html` with the preset the site renders with. */
async function utilitySelectors(html: string): Promise<string[]> {
  // tailwindcss types its plugin against its own copy of postcss, a patch release apart from this one,
  // and the preset's readonly token tuples do not fit Tailwind's mutable Config type.
  const plugin = tailwind({
    content: [{ raw: html, extension: "html" }],
    presets: [digitaTheme as unknown as Config],
    corePlugins: { preflight: false },
  }) as unknown as AcceptedPlugin;
  const { root } = await postcss([plugin]).process("@tailwind utilities", { from: undefined });
  const selectors: string[] = [];
  root.walkRules((rule) => {
    selectors.push(...rule.selectors);
  });
  return selectors;
}

const PAGE =
  '<div id="band" data-block="hero" data-variant="dark"><i id="in" class="dark:bg-surface"></i></div>' +
  '<div data-block="hero"><i id="out" class="dark:bg-surface"></i></div>' +
  '<button data-variant="dark"><i id="button" class="dark:bg-surface"></i></button>';

async function matchedIds(darkRoot: boolean): Promise<string[]> {
  document.documentElement.classList.toggle("dark", darkRoot);
  document.body.innerHTML = PAGE;
  const selectors = await utilitySelectors('<i class="dark:bg-surface"></i>');
  expect(selectors.length).toBeGreaterThan(0);
  const ids = selectors.flatMap((s) => Array.from(document.querySelectorAll(s), (e) => e.id));
  return [...new Set(ids)].sort();
}

describe("the site's dark: utilities", () => {
  it("apply inside a dark band and nowhere else on a light page", async () => {
    expect(await matchedIds(false)).toEqual(["in"]);
  });

  it("PLANTED INNOCENT: still apply everywhere under the .dark root", async () => {
    expect(await matchedIds(true)).toEqual(["button", "in", "out"]);
  });
});

describe("the block renderer", () => {
  it("draws a block set to theme_variant dark as the band, and only that block", () => {
    const blocks = [
      { type: "richtext", theme_variant: "dark", props: { heading: "Dark", body: "In the band." } },
      { type: "richtext", props: { heading: "Light", body: "Beside the band." } },
    ] as Block[];
    document.body.innerHTML = renderToStaticMarkup(createElement(BlockRenderer, { blocks, locale: "en" }));
    const bands = Array.from(document.querySelectorAll(DARK_BAND_SELECTOR), (e) => e.querySelector("h2, h3")?.textContent);
    expect(bands).toEqual(["Dark"]);
  });
});
