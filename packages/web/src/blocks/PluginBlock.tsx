import { resolvePlugin } from "@/plugins";

/**
 * Renders a `plugin` block by resolving `props.plugin_id` against the frontend
 * plugin registry (code-split). Unknown ids render nothing in production; in
 * dev a subtle placeholder makes a typo'd id visible. The registry is empty
 * until M4 ships the flagship plugins.
 */
export function PluginBlock({ props }: { props?: Record<string, unknown> }) {
  const id = typeof props?.plugin_id === "string" ? props.plugin_id : undefined;
  const Plugin = resolvePlugin(id);

  if (!Plugin) {
    if (process.env.NODE_ENV !== "production" && id) {
      return (
        <div className="mx-auto my-8 max-w-3xl rounded-xl border border-dashed border-line px-6 py-8 text-center text-sm text-fg-muted">
          Plugin <code className="text-fg">{id}</code> is not registered.
        </div>
      );
    }
    return null;
  }
  return <Plugin props={props} />;
}
