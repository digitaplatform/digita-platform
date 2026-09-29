import type { ReactNode } from "react";
import { Badge } from "@digitaplatform/components";
import type { Locale } from "@/i18n/config";
import { t } from "@/i18n/messages";
import { Actions, Eyebrow, type P, Section, readAction, s } from "./shared";

/**
 * The opening section of a brand site: headline, lede and calls to action beside the site's
 * visual. `simetrix-mark` is the X with its node aura; `code-app` is a sales order definition
 * beside the API and the admin form generated from it, and with `reveal` the form shows its
 * definition on hover or tap. `data-rain` lets the definition's tokens fall behind the section.
 * The sales order is demo content, as in the metadata-demo plugin.
 */
export function HeroBrand({ props, locale }: { props?: P; locale: Locale }) {
  const heading = s(props, "heading");
  if (!heading) return null;
  const visual = s(props, "visual");
  const lede = s(props, "lede");
  const figure =
    visual === "simetrix-mark" ? <SimetrixMark /> : visual === "code-app" ? props?.reveal === true ? <RevealApp locale={locale} /> : <CodeApp /> : null;
  return (
    <div className="relative isolate overflow-hidden">
      {s(props, "atmosphere") === "data-rain" && <DataRain />}
      <Section>
        <div className={figure ? "grid items-center gap-12 md:grid-cols-2 md:gap-14" : "max-w-3xl"}>
          <div className="flex flex-col gap-7">
            {s(props, "eyebrow") && <Eyebrow>{s(props, "eyebrow")}</Eyebrow>}
            <h1 className="text-balance font-display text-4xl font-semibold tracking-tight text-textMain [overflow-wrap:anywhere] sm:text-5xl lg:text-7xl">
              {heading}
            </h1>
            {lede && <p className="max-w-xl text-pretty text-lg leading-relaxed text-textMuted md:text-xl">{lede}</p>}
            <Actions primary={readAction(props, "primary")} secondary={readAction(props, "secondary")} className="pt-2" />
          </div>
          {figure}
        </div>
      </Section>
    </div>
  );
}

/** The approved simetrix X, as drawn in the brand canvas. */
const X_PATH = "M272.5 3L276.5 3L275.5 8L217 221.5L205.5 189ZM309.5 3L313 2.5L313.5 5L265.5 183L235 213.5ZM235.5 10L236.5 14L197.5 160L196 162.5L179 161.5L229.5 20ZM345.5 11L348 10.5L348.5 14L309.5 160L291 161.5ZM193.5 26L194.5 30L160.5 160L142 161.5L188.5 33ZM377.5 27L380.5 30L346.5 161L328 161.5ZM140.5 163L148.5 180L151.5 195L130.5 275L104.5 346L74 376.5L98.5 276ZM344.5 165L317.5 274L276 383.5L265.5 351L285.5 275L315.5 194ZM159.5 215L173.5 249L168.5 270L162.5 287L125 324.5L136.5 277ZM292.5 217L293.5 220L279.5 273L257 331.5L243.5 295L247.5 280L257.5 252ZM241.5 269L239 280.5L236.5 274ZM199.5 324L211.5 353L211.5 358L145.5 542L143.5 547L140 547.5ZM183.5 327L185.5 327L106.5 547L103 547.5L152.5 359ZM220.5 383L222.5 383L226 393.5L235.5 395L183.5 538L180 540.5L179.5 536ZM124.5 387L124.5 392L72.5 535L68 539.5L105.5 394L118 393.5ZM68.5 394L86.5 394L38 523.5L35.5 520ZM254.5 394L272.5 395L227.5 517L222 524.5Z";

function SimetrixMark() {
  const nodes = [
    { cx: 150, cy: 70, delay: "0s" },
    { cx: 430, cy: 66, delay: "0.6s" },
    { cx: 132, cy: 500, delay: "1.2s" },
    { cx: 380, cy: 512, delay: "1.8s" },
  ];
  return (
    <svg viewBox="0 0 560 560" aria-hidden="true" className="mx-auto w-60 sm:w-80 md:w-full md:max-w-lg">
      <defs>
        <linearGradient id="simetrix-mark-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-primary-300)" />
          <stop offset="1" stopColor="var(--color-primary-700)" />
        </linearGradient>
        <radialGradient id="simetrix-mark-aura" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--color-primary-600)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--color-primary-600)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle
        cx="280"
        cy="280"
        r="250"
        fill="url(#simetrix-mark-aura)"
        className="origin-center [transform-box:fill-box] motion-safe:animate-[mark-aura_4.2s_ease-in-out_infinite]"
      />
      {/* The mark is navy in light mode and the cyan gradient in dark mode, as the brand canvas draws it. */}
      <g transform="translate(96 30) scale(0.9)">
        <path d={X_PATH} fillRule="evenodd" fill="currentColor" className="text-textMain dark:hidden" />
        <path d={X_PATH} fillRule="evenodd" fill="url(#simetrix-mark-fill)" className="hidden dark:inline" />
      </g>
      <g className="stroke-primary-300" strokeOpacity="0.35" strokeWidth="1" fill="none">
        {nodes.map((node) => (
          <path key={node.cx} d={`M${node.cx} ${node.cy} L280 286`} />
        ))}
      </g>
      <g className="fill-primary-300">
        {nodes.map((node) => (
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

/** Keys in the accent, comments muted, everything else in the text color. */
function Code({ lines }: { lines: string[] }) {
  return (
    <pre className="overflow-hidden p-4 font-mono text-xs leading-relaxed text-textMain">
      <code>
        {lines.map((line, i) => (
          <span key={i} className="block">
            {line.split(/("[^"]*"(?=\s*:)|\/\/.*$)/).map((part, j) =>
              part.startsWith("//") ? (
                <span key={j} className="text-textMuted">
                  {part}
                </span>
              ) : part.startsWith('"') && j % 2 === 1 ? (
                <span key={j} className="text-primary-600">
                  {part}
                </span>
              ) : (
                part
              ),
            )}
          </span>
        ))}
      </code>
    </pre>
  );
}

function Panel({
  title,
  tag,
  strong = false,
  delay,
  className = "",
  children,
}: {
  title: string;
  tag: string;
  strong?: boolean;
  delay?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-card border bg-surface ${strong ? "border-borderStrong" : "border-border"} ${className}`}
      style={delay ? { animationDelay: delay } : undefined}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="min-w-0 truncate font-mono text-xs text-textMuted">{title}</span>
        <Badge variant="pill" color="primary" className="shrink-0 rounded-full font-mono uppercase tracking-wider">
          {tag}
        </Badge>
      </div>
      {children}
    </div>
  );
}

const RISE = "motion-safe:animate-[rise-in_0.7s_cubic-bezier(0.16,1,0.3,1)_both]";

const DEFINITION = [
  "{",
  '  "naming": "SO-{####:fiscal_year}",',
  '  "is_submittable": true,   // draft → confirmed → delivered',
  '  "fields": [',
  "    { customer, Link→Customer },",
  "    { lines, Table[ product, qty, unit_price, line_total ] },",
  "    { grand_total, computed }",
  "  ],",
  '  "hooks": { computeTotals, checkCreditLimit }',
  "}",
];

const RESPONSE = ["{", '  "_id": "SO-2026-0042",', '  "customer": "ACME GmbH",', '  "grand_total": 1886.15,', '  "docstatus": 1', "}"];

const LINES = [
  { product: "Aurora Lamp", qty: 10, total: "€1,490.00" },
  { product: "Cable Set", qty: 5, total: "€95.00" },
];
const GRAND_TOTAL = "€1,886.15";
const STATES = ["draft", "confirmed", "delivered"];

function CodeApp() {
  return (
    <div className="grid gap-3.5">
      <Panel title="salesOrder.entity.json" tag="define" strong className={RISE}>
        <Code lines={DEFINITION} />
      </Panel>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Panel title="POST /api/v1/resource/SalesOrder" tag="api" delay="0.25s" className={RISE}>
          <Code lines={RESPONSE} />
        </Panel>
        <Panel title="Sales Order" tag="admin" delay="0.5s" className={`flex flex-col ${RISE}`}>
          <div className="flex flex-col gap-2.5 px-4 py-3.5 text-xs text-textMuted">
            <div className="flex justify-between gap-2">
              <span>Customer</span>
              <span className="font-semibold text-textMain">ACME GmbH</span>
            </div>
            {LINES.map((line) => (
              <div key={line.product} className="flex justify-between gap-2">
                <span>
                  {line.product} × {line.qty}
                </span>
                <span className="tabular-nums text-textMain">{line.total}</span>
              </div>
            ))}
            <div className="flex justify-between gap-2 border-t border-border pt-2">
              <span>Grand total</span>
              <span className="font-bold tabular-nums text-textMain">{GRAND_TOTAL}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {STATES.map((state, i) => (
                <span key={state} className="flex items-center gap-1.5">
                  <Badge
                    variant={state === "confirmed" ? "pill" : "outline"}
                    color={state === "confirmed" ? "primary" : "neutral"}
                    className={`rounded-full font-mono uppercase tracking-wider ${state === "confirmed" ? "" : "text-textMuted"}`}
                  >
                    {state}
                  </Badge>
                  {i < STATES.length - 1 && <span aria-hidden="true">→</span>}
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

const FULL_DEFINITION = [
  "{",
  '  "name": "SalesOrder",',
  '  "naming": "SO-{####:fiscal_year}",',
  '  "is_submittable": true,   // draft → confirmed → delivered',
  '  "fields": [',
  '    { "fieldname": "customer", "fieldtype": "Link", "target": "Customer" },',
  '    { "fieldname": "order_date", "fieldtype": "Date" },',
  '    { "fieldname": "lines", "fieldtype": "Table",',
  '      "child_fields": [ product, qty, unit_price, line_total ] },',
  '    { "fieldname": "grand_total", "fieldtype": "Currency", "computed": true }',
  "  ],",
  '  "hooks": { "before_save": "sales/order.computeTotals" },',
  '  "permissions": [ { "role": "Sales User", "read": 1, "write": 1 } ],',
  '  "track_changes": true',
  "}",
];

/* A pointer that can hover dissolves the form while it rests on it; a tap toggles the checkbox, so a
   phone reveals the code without the hover a touch screen would leave stuck on. */
const HOVER_FADE = "[@media(hover:hover)]:group-hover:opacity-10 [@media(hover:hover)]:group-hover:blur-sm";
const HOVER_SHOW = "[@media(hover:hover)]:group-hover:opacity-100";

/** The generated sales order form; on hover or tap it dissolves into the definition it came from. */
function RevealApp({ locale }: { locale: Locale }) {
  return (
    <label className="group relative block h-[26rem] cursor-pointer overflow-hidden rounded-card border border-borderStrong bg-surface shadow-lg has-[:focus-visible]:shadow-focus">
      <input type="checkbox" className="peer sr-only" aria-label={t("heroRevealToggle", locale)} />
      <div
        className={`absolute inset-0 flex flex-col transition duration-slow ease-smooth motion-reduce:transition-none peer-checked:opacity-10 peer-checked:blur-sm ${HOVER_FADE}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="truncate font-display text-sm font-semibold text-textMain">Sales Order · SO-2026-0042</span>
          <span className="font-mono text-xs uppercase tracking-wider text-primary-600">confirmed</span>
        </div>
        <div className="grid grid-cols-2 gap-3.5 p-5 text-sm">
          {[
            ["Customer", "ACME GmbH"],
            ["Order date", "2026-09-28"],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1.5">
              <span className="text-textMuted">{label}</span>
              <span className="rounded-input border border-borderStrong px-3 py-2.5 text-textMain">{value}</span>
            </div>
          ))}
        </div>
        <div className="px-5 text-sm">
          <div className="grid grid-cols-[3fr_1fr_1fr] border-b border-border px-3 py-2 font-mono text-xs uppercase tracking-wider text-textMuted">
            <span>Product</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Line total</span>
          </div>
          {LINES.map((line) => (
            <div key={line.product} className="grid grid-cols-[3fr_1fr_1fr] border-b border-border px-3 py-2.5 text-textMain">
              <span>{line.product}</span>
              <span className="text-right tabular-nums">{line.qty}</span>
              <span className="text-right tabular-nums">{line.total}</span>
            </div>
          ))}
          <div className="grid grid-cols-[3fr_1fr_1fr] px-3 pt-3 text-textMuted">
            <span>Grand total</span>
            <span />
            <span className="text-right font-bold tabular-nums text-textMain">{GRAND_TOTAL}</span>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3.5 text-sm">
          <span className="text-textMuted">generated by digita · running on digita cloud</span>
          <span className="font-semibold text-primary-600">{t("heroRevealHint", locale)} ↗</span>
        </div>
      </div>
      <div
        className={`absolute inset-0 flex flex-col opacity-0 transition-opacity duration-slow ease-smooth motion-reduce:transition-none peer-checked:opacity-100 ${HOVER_SHOW}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="truncate font-mono text-xs text-textMuted">salesOrder.entity.json</span>
          <span className="font-mono text-xs uppercase tracking-wider text-primary-600">the code behind</span>
        </div>
        <Code lines={FULL_DEFINITION} />
      </div>
    </label>
  );
}

/** Five columns of the definition's own tokens, falling behind the hero; none under reduced motion. */
const RAIN = [
  { left: "4%", duration: "34s", delay: "0s", tokens: ['"customer"', "Link→Customer", '"lines"', "Table", '"qty"', "10", '"unit_price"', "149.00", '"line_total"', "1490.00", '"grand_total"', "1886.15", '"docstatus"', "1", '"naming"', "SO-{####}"] },
  { left: "18%", duration: "46s", delay: "-12s", tokens: ['"_id"', "SO-2026-0042", '"states"', "draft", "confirmed", "delivered", '"hooks"', "computeTotals", "checkCreditLimit", '"permissions"', "level 0", "level 1"] },
  { left: "35%", duration: "40s", delay: "-25s", tokens: ['"is_submittable"', "true", '"fields"', "product", "Aurora Lamp", "Cable Set", '"fiscal_year"', "2026", '"locale"', "en de fr it es tr"] },
  { left: "76%", duration: "52s", delay: "-30s", tokens: ["POST", "/api/v1/resource/SalesOrder", "201", '"track_changes"', "true", '"storage_path"', "sales/order", "GET", "/api/v1/public/WebPage", "200", '"hreflang"', "x-default"] },
  { left: "93%", duration: "38s", delay: "-8s", tokens: ['"role"', "Sales User", '"read"', "1", '"write"', "1", '"if_owner"', "0", '"snapshot"', "frozen", '"period"', "closed"] },
];

function DataRain() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-[.12] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_70%,transparent)]"
    >
      {/* Reduced motion stops the fall; the columns stay as a still texture. */}
      {RAIN.map((column) => (
        <div
          key={column.left}
          className="absolute top-0 animate-[rain-fall_40s_linear_infinite] motion-reduce:animate-none whitespace-pre font-mono text-xs leading-10 text-primary-600"
          style={{ left: column.left, animationDuration: column.duration, animationDelay: column.delay }}
        >
          {/* Twice, so a column is taller than the hero and never shows its end mid-fall. */}
          {[...column.tokens, ...column.tokens].join("\n")}
        </div>
      ))}
    </div>
  );
}
