import { getSite } from "@/lib/engine-client";
import { siteSignature } from "@/lib/identity";

const NODES = [
  { cx: 150, cy: 70, delay: "0s" },
  { cx: 430, cy: 66, delay: "0.6s" },
  { cx: 132, cy: 500, delay: "1.2s" },
  { cx: 380, cy: 512, delay: "1.8s" },
];

/** Where the mark sits in the 560 × 560 figure; the monogram is fitted into this box. */
const BOX = { x: 96, y: 30, width: 366.3, height: 500.4 };

/**
 * The site's own mark, the monogram of the signature its `theme` names, with a pulsing aura and
 * four nodes wired to it. A site whose signature has no monogram gets no figure.
 */
export default async function BrandMark() {
  const monogram = siteSignature((await getSite())?.theme).monogram;
  if (!monogram) return null;
  // The monogram paints in currentColor, which a gradient cannot reach, so its shape is an alpha
  // mask over the colour: navy in light mode, the primary gradient in dark mode.
  const shape = `data:image/svg+xml,${encodeURIComponent(monogram)}`;
  return (
    <svg viewBox="0 0 560 560" aria-hidden="true" className="mx-auto w-60 sm:w-80 md:w-full md:max-w-lg">
      <defs>
        <linearGradient id="brand-mark-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-primary-300)" />
          <stop offset="1" stopColor="var(--color-primary-700)" />
        </linearGradient>
        <radialGradient id="brand-mark-aura" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--color-primary-600)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--color-primary-600)" stopOpacity="0" />
        </radialGradient>
        <mask id="brand-mark-shape" maskUnits="userSpaceOnUse" className="[mask-type:alpha]">
          <image href={shape} {...BOX} />
        </mask>
      </defs>
      <circle
        cx="280"
        cy="280"
        r="250"
        fill="url(#brand-mark-aura)"
        className="origin-center [transform-box:fill-box] motion-safe:animate-[mark-aura_4.2s_ease-in-out_infinite]"
      />
      <rect {...BOX} mask="url(#brand-mark-shape)" fill="currentColor" className="text-textMain dark:hidden" />
      <rect {...BOX} mask="url(#brand-mark-shape)" fill="url(#brand-mark-fill)" className="hidden dark:inline" />
      <g className="stroke-primary-300" strokeOpacity="0.35" strokeWidth="1" fill="none">
        {NODES.map((node) => (
          <path key={node.cx} d={`M${node.cx} ${node.cy} L280 286`} />
        ))}
      </g>
      <g className="fill-primary-300">
        {NODES.map((node) => (
          <circle
            key={node.cx}
            cx={node.cx}
            cy={node.cy}
            r="4"
            className="motion-safe:animate-[mark-node_2.8s_ease-in-out_infinite]"
            style={{ animationDelay: node.delay }}
          />
        ))}
      </g>
      <circle cx="280" cy="286" r="7" className="fill-primary-50" />
    </svg>
  );
}
