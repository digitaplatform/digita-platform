import type { ReactNode } from "react";
import { mediaUrl } from "@/lib/media";

/**
 * Generic content-block components. Each reads its typed config from the block's
 * `props` (JSON). Presentational + server-rendered; token-styled (airy, light +
 * dark via @digitaplatform/theme variables). Add a block type by adding a component here
 * and registering it in registry.ts.
 */

type P = Record<string, unknown>;
const s = (p: P | undefined, k: string): string => (typeof p?.[k] === "string" ? (p[k] as string) : "");
const list = (p: P | undefined, k: string): P[] => (Array.isArray(p?.[k]) ? (p[k] as P[]) : []);

function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`mx-auto w-full max-w-6xl px-6 py-16 md:px-8 md:py-24 ${className}`}>{children}</section>
  );
}

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
        <a
          href={ctaHref}
          className="mt-10 inline-flex items-center justify-center rounded-full bg-primary-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-700"
        >
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
          <div key={i} className="rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-lg font-medium text-textMain">{s(item, "title")}</h3>
            {s(item, "body") && <p className="mt-2 text-sm leading-relaxed text-textMuted">{s(item, "body")}</p>}
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Stats({ props }: { props?: P }) {
  const items = list(props, "items");
  return (
    <Section>
      <div className="grid gap-8 rounded-3xl border border-border bg-surface p-10 sm:grid-cols-3">
        {items.map((item, i) => (
          <div key={i} className="text-center">
            <div className="text-4xl font-semibold tracking-tight text-primary-600 md:text-5xl">{s(item, "value")}</div>
            <div className="mt-2 text-sm text-textMuted">{s(item, "label")}</div>
          </div>
        ))}
      </div>
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
        className="mx-auto w-full max-w-5xl rounded-2xl border border-border"
      />
      {s(props, "caption") && <p className="mt-3 text-center text-sm text-textMuted">{s(props, "caption")}</p>}
    </Section>
  );
}

export function Cta({ props }: { props?: P }) {
  const href = s(props, "cta_href");
  return (
    <Section>
      <div className="rounded-3xl bg-primary-600 px-8 py-14 text-center text-white">
        {s(props, "heading") && <h2 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{s(props, "heading")}</h2>}
        {s(props, "body") && <p className="mx-auto mt-3 max-w-xl text-white/90 [overflow-wrap:anywhere]">{s(props, "body")}</p>}
        {s(props, "cta_label") && href && (
          <a
            href={href}
            className="mt-8 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-medium text-primary-700 transition-opacity hover:opacity-90"
          >
            {s(props, "cta_label")}
          </a>
        )}
      </div>
    </Section>
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
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {(title || language) && (
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <span className="min-w-0 truncate font-mono text-xs text-textMuted">{title}</span>
            {language && (
              <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-600">
                {language}
              </span>
            )}
          </div>
        )}
        <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-textMain">
          <code>{code}</code>
        </pre>
      </div>
      {s(props, "caption") && <p className="mt-3 text-sm text-textMuted">{s(props, "caption")}</p>}
    </Section>
  );
}

export function Embed({ props }: { props?: P }) {
  const src = s(props, "src");
  if (!src) return null;
  return (
    <Section>
      <div className="aspect-video w-full overflow-hidden rounded-2xl border border-border">
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
