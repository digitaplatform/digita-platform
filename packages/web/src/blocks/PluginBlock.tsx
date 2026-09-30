import type { Locale } from "@/i18n/config";
import { resolvePlugin } from "@/plugins";
import { Section } from "./marketing/shared";

/**
 * Renders a `plugin` block by resolving `props.plugin_id` against the frontend
 * plugin registry (code-split). Unknown ids render nothing in production; in
 * dev a subtle placeholder makes a typo'd id visible. The plugin gets the
 * block's props and the page's locale.
 */
export function PluginBlock({ props, locale }: { props?: Record<string, unknown>; locale: Locale }) {
  const id = typeof props?.plugin_id === "string" ? props.plugin_id : undefined;
  const Plugin = resolvePlugin(id);

  if (!Plugin) {
    if (process.env.NODE_ENV !== "production" && id) {
      return (
        <div className="mx-auto my-8 max-w-3xl rounded-card border border-dashed border-border px-6 py-8 text-center text-sm text-textMuted">
          Plugin <code className="text-textMain">{id}</code> is not registered.
        </div>
      );
    }
    return null;
  }
  // The section owns the page spacing, so a plugin placed alone and one inside a showcase line up.
  return (
    <Section>
      <Plugin props={props} locale={locale} />
    </Section>
  );
}
