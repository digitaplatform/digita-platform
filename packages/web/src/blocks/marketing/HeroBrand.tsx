import type { CSSProperties } from "react";
import type { Locale } from "@/i18n/config";
import type { WebSite } from "@/lib/types";
import { resolvePlugin } from "@/plugins";
import { Actions, Eyebrow, type P, Section, list, readAction, s, texts } from "./shared";

/* The text sits at its reading width until a figure is drawn beside it. Whether one is drawn is
   known only once the plugin has rendered (it may draw nothing without its content, or for a site
   without a mark), so the page itself decides: the two columns open when a second child is there. */
const LAYOUT =
  "max-w-3xl has-[>:nth-child(2)]:grid has-[>:nth-child(2)]:max-w-none has-[>:nth-child(2)]:items-center has-[>:nth-child(2)]:gap-12 md:has-[>:nth-child(2)]:grid-cols-2 md:has-[>:nth-child(2)]:gap-14";

/**
 * The opening section of a site: headline, lede and calls to action beside the site's figure.
 * `visual` names the plugin that draws the figure and gets the block's props; `none` or an id no
 * plugin carries draws none. `data-rain` lets the tokens of `rain` fall behind the section.
 * A block that names no atmosphere takes the site's, so every page of the site opens the same.
 */
export function HeroBrand({ props, locale, site }: { props?: P; locale: Locale; site?: WebSite | null }) {
  const heading = s(props, "heading");
  if (!heading) return null;
  const Figure = resolvePlugin(s(props, "visual") || undefined);
  const lede = s(props, "lede");
  // The site's atmosphere is read through the same accessors as the block's, so an unusable value
  // draws nothing and never throws.
  const atmosphereSource = s(props, "atmosphere") ? props : { atmosphere: site?.hero_atmosphere, rain: site?.hero_rain };
  return (
    <div className="relative isolate overflow-hidden">
      {s(atmosphereSource, "atmosphere") === "data-rain" && <DataRain columns={list(atmosphereSource, "rain").map((column) => texts(column, "tokens"))} />}
      <Section>
        <div className={LAYOUT}>
          <div className="flex flex-col gap-7">
            {s(props, "eyebrow") && <Eyebrow>{s(props, "eyebrow")}</Eyebrow>}
            <h1 className="text-balance font-display text-4xl font-semibold tracking-tight text-textMain [overflow-wrap:anywhere] sm:text-5xl lg:text-7xl">
              {heading}
            </h1>
            {lede && <p className="max-w-xl text-pretty text-lg leading-relaxed text-textMuted md:text-xl">{lede}</p>}
            <Actions primary={readAction(props, "primary")} secondary={readAction(props, "secondary")} className="pt-2" />
          </div>
          {Figure && <Figure props={props} locale={locale} />}
        </div>
      </Section>
    </div>
  );
}

/** Where each column of the rain falls and how fast; the first five columns of `rain` take them. */
const RAIN_COLUMNS = [
  { left: "4%", duration: "17s", delay: "0s" },
  { left: "18%", duration: "23s", delay: "-12s" },
  { left: "35%", duration: "20s", delay: "-25s" },
  { left: "76%", duration: "26s", delay: "-30s" },
  { left: "93%", duration: "19s", delay: "-8s" },
];

/** leading-10 is 40px a line: 20 lines keep the band the mask leaves opaque (18% to 70%) covered up to a 1142px hero. */
const HALF_LINES = 20;

/** Columns of tokens falling behind the hero, under reduced motion too. */
function DataRain({ columns }: { columns: string[][] }) {
  const falling = RAIN_COLUMNS.flatMap((place, i) => (columns[i]?.length ? [{ ...place, tokens: columns[i] }] : []));
  if (!falling.length) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-[.12] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_70%,transparent)]"
    >
      {/* The fall runs under reduced motion too: the important animation outranks the theme rule
          that cuts every animation to 0.01ms there, and it reads each column's own timing. */}
      {falling.map((column) => {
        // A cycle moves the column by one half, and the halves are equal, so a cycle ends where the
        // next begins; a half repeats the tokens until it is taller than the opaque band of the hero.
        const half = Array.from({ length: Math.ceil(HALF_LINES / column.tokens.length) }, () => column.tokens).flat();
        return (
          <div
            key={column.left}
            className="absolute top-0 !animate-[rain-fall_var(--rain-duration)_linear_var(--rain-delay)_infinite] whitespace-pre font-mono text-xs leading-10 text-primary-600"
            style={{ left: column.left, "--rain-duration": column.duration, "--rain-delay": column.delay } as CSSProperties}
          >
            {[...half, ...half].join("\n")}
          </div>
        );
      })}
    </div>
  );
}
