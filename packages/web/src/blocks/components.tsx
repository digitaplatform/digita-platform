import { Badge, Card, buttonAttributes } from "@digitaplatform/components";
import { mediaUrl } from "@/lib/media";
import { type P, Section, list, s } from "./marketing/shared";
import { GlowPanel } from "./marketing/CtaPanel";

/**
 * Generic content-block components. Each reads its typed config from the block's
 * `props` (JSON). Presentational + server-rendered, built from the app's component kit
 * (Card, Badge, the button's attributes) and the theme's tokens, so a block looks and
 * restyles like the app. Add a block type by adding a component here and registering it
 * in registry.ts.
 */

export function Hero({ props }: { props?: P }) {
  const ctaHref = s(props, "cta_href");
  return (
    <Section className="text-center">
      <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight text-textMain [overflow-wrap:anywhere] md:text-6xl">
        {s(props, "heading")}
      </h1>
      {s(props, "subheading") && (
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-textMuted md:text-xl">
          {s(props, "subheading")}
        </p>
      )}
      {s(props, "cta_label") && ctaHref && (
        <a href={ctaHref} {...buttonAttributes({ size: "lg", className: "mt-10" })}>
          {s(props, "cta_label")}
        </a>
      )}
    </Section>
  );
}

export function RichText({ props }: { props?: P }) {
  return (
    <Section className="max-w-3xl">
      {s(props, "heading") && <h2 className="text-3xl font-semibold tracking-tight text-textMain [overflow-wrap:anywhere]">{s(props, "heading")}</h2>}
      {s(props, "body") && (
        <div className="mt-4 space-y-4 text-lg leading-relaxed text-textMuted [overflow-wrap:anywhere]">
          {s(props, "body")
            .split(/\n\n+/)
            .map((para, i) => (
              <p key={i}>{para}</p>
            ))}
        </div>
      )}
    </Section>
  );
}

export function FeatureGrid({ props }: { props?: P }) {
  const items = list(props, "items");
  return (
    <Section>
      {s(props, "heading") && (
        <h2 className="mb-12 text-center text-3xl font-semibold tracking-tight text-textMain [overflow-wrap:anywhere]">{s(props, "heading")}</h2>
      )}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <Card key={i} graphic>
            <h3 className="text-lg font-medium text-textMain">{s(item, "title")}</h3>
            {s(item, "body") && <p className="mt-2 text-sm leading-relaxed text-textMuted">{s(item, "body")}</p>}
          </Card>
        ))}
      </div>
    </Section>
  );
}

/** Proof-strip columns and the hairline between cells, as literal classes so the stylesheet
 *  carries them: two columns on a phone, up to four on a wide screen. */
const STRIP_COLUMNS: Record<number, string> = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" };

export function Stats({ props }: { props?: P }) {
  const items = list(props, "items");
  if (!items.length) return null;
  const columns = Math.min(items.length, 4);
  return (
    <Section>
      <dl className={`grid grid-cols-2 border-t border-border md:border-b ${STRIP_COLUMNS[columns] ?? "md:grid-cols-4"}`}>
        {items.map((item, i) => (
          <div
            key={i}
            className={`flex flex-col-reverse justify-end gap-1.5 border-b border-border py-5 pr-6 md:border-b-0 ${i % 2 ? "border-l pl-6" : "pl-0"} ${
              i % columns ? "md:border-l md:pl-6" : "md:border-l-0 md:pl-0"
            }`}
          >
            {/* The label is the term and the value its description; the value still reads first. */}
            <dt className="text-sm text-textMuted">{s(item, "label")}</dt>
            <dd className="font-display text-xl font-semibold text-textMain">{s(item, "value")}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function Media({ props }: { props?: P }) {
  const url = mediaUrl(s(props, "image") || s(props, "src"));
  if (!url) return null;
  return (
    <Section>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={s(props, "alt")}
        loading="lazy"
        className="mx-auto w-full max-w-5xl rounded-card border border-border"
      />
      {s(props, "caption") && <p className="mt-3 text-center text-sm text-textMuted">{s(props, "caption")}</p>}
    </Section>
  );
}

export function Cta({ props }: { props?: P }) {
  const label = s(props, "cta_label");
  const href = s(props, "cta_href");
  return (
    <GlowPanel
      heading={s(props, "heading")}
      body={s(props, "body")}
      primary={label && href ? { label, href, sheet: false } : null}
      secondary={null}
    />
  );
}

export function Code({ props }: { props?: P }) {
  const code = s(props, "code");
  if (!code) return null;
  const title = s(props, "title");
  const language = s(props, "language");
  return (
    <Section className="max-w-4xl">
      {s(props, "heading") && (
        <h2 className="mb-3 text-3xl font-semibold tracking-tight text-textMain [overflow-wrap:anywhere]">{s(props, "heading")}</h2>
      )}
      {s(props, "intro") && <p className="mb-6 text-lg leading-relaxed text-textMuted [overflow-wrap:anywhere]">{s(props, "intro")}</p>}
      <Card variant="default" className="overflow-hidden">
        {(title || language) && (
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <span className="min-w-0 truncate font-mono text-xs text-textMuted">{title}</span>
            {language && (
              <Badge color="primary" size="sm" className="shrink-0 uppercase">
                {language}
              </Badge>
            )}
          </div>
        )}
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-textMain">
          <code>{code}</code>
        </pre>
      </Card>
      {s(props, "caption") && <p className="mt-3 text-sm text-textMuted">{s(props, "caption")}</p>}
    </Section>
  );
}

export function Embed({ props }: { props?: P }) {
  const src = s(props, "src");
  if (!src) return null;
  return (
    <Section>
      <div className="aspect-video w-full overflow-hidden rounded-card border border-border">
        <iframe
          src={src}
          title={s(props, "title") || "Embedded content"}
          loading="lazy"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    </Section>
  );
}
