import type { Locale } from "@/i18n/config";
import { resolvePlugin } from "@/plugins";
import { type P, Section, s } from "./shared";

/** A live plugin under a section heading, with a caption that says what the visitor is looking at. */
export function Showcase({ props, locale }: { props?: P; locale: Locale }) {
  const Plugin = resolvePlugin(s(props, "plugin_id") || undefined);
  if (!Plugin) return null;
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")} lede={s(props, "lede")}>
      <Plugin props={props} locale={locale} />
      {s(props, "caption") && <p className="mt-6 max-w-3xl text-sm leading-relaxed text-textMuted">{s(props, "caption")}</p>}
    </Section>
  );
}
