import type { Locale } from "@/i18n/config";
import { t } from "@/i18n/messages";
import { type P, list, s, texts } from "@/blocks/marketing/shared";

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

/* A pointer that can hover dissolves the form while it rests on it; a tap toggles the checkbox, so a
   phone reveals the code without the hover a touch screen would leave stuck on. */
const HOVER_FADE = "[@media(hover:hover)]:group-hover:opacity-10 [@media(hover:hover)]:group-hover:blur-sm";
const HOVER_SHOW = "[@media(hover:hover)]:group-hover:opacity-100";

/**
 * A generated form that dissolves into the definition it came from on hover or tap. Every text of
 * the form and the definition comes from the props, so each site and locale writes its own; only
 * the toggle label and the hint are chrome texts. Without a definition there is nothing to reveal.
 */
export default function CodeApp({ props, locale }: { props?: P; locale: Locale }) {
  const definition = texts(props, "definition");
  if (!definition.length) return null;
  const [product, qty, total] = texts(props, "columns");
  return (
    <label className="group relative block h-[26rem] cursor-pointer overflow-hidden rounded-card border border-borderStrong bg-surface shadow-lg has-[:focus-visible]:shadow-focus">
      <input type="checkbox" className="peer sr-only" aria-label={t("heroRevealToggle", locale)} />
      <div
        className={`absolute inset-0 flex flex-col transition duration-slow ease-smooth motion-reduce:transition-none peer-checked:opacity-10 peer-checked:blur-sm ${HOVER_FADE}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="truncate font-display text-sm font-semibold text-textMain">{s(props, "form_title")}</span>
          <span className="font-mono text-xs uppercase tracking-wider text-primary-600">{s(props, "form_status")}</span>
        </div>
        <div className="grid grid-cols-2 gap-3.5 p-5 text-sm">
          {list(props, "fields").map((field, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <span className="text-textMuted">{s(field, "label")}</span>
              <span className="rounded-input border border-borderStrong px-3 py-2.5 text-textMain">{s(field, "value")}</span>
            </div>
          ))}
        </div>
        <div className="px-5 text-sm">
          <div className="grid grid-cols-[3fr_1fr_1fr] border-b border-border px-3 py-2 font-mono text-xs uppercase tracking-wider text-textMuted">
            <span>{product}</span>
            <span className="text-right">{qty}</span>
            <span className="text-right">{total}</span>
          </div>
          {list(props, "lines").map((line, i) => (
            <div key={i} className="grid grid-cols-[3fr_1fr_1fr] border-b border-border px-3 py-2.5 text-textMain">
              <span>{s(line, "product")}</span>
              <span className="text-right tabular-nums">{s(line, "qty")}</span>
              <span className="text-right tabular-nums">{s(line, "total")}</span>
            </div>
          ))}
          <div className="grid grid-cols-[3fr_1fr_1fr] px-3 pt-3 text-textMuted">
            <span>{s(props, "total_label")}</span>
            <span />
            <span className="text-right font-bold tabular-nums text-textMain">{s(props, "grand_total")}</span>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3.5 text-sm">
          <span className="text-textMuted">{s(props, "footer")}</span>
          <span className="font-semibold text-primary-600">{t("heroRevealHint", locale)} ↗</span>
        </div>
      </div>
      <div
        className={`absolute inset-0 flex flex-col opacity-0 transition-opacity duration-slow ease-smooth motion-reduce:transition-none peer-checked:opacity-100 ${HOVER_SHOW}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="truncate font-mono text-xs text-textMuted">{s(props, "definition_title")}</span>
          <span className="font-mono text-xs uppercase tracking-wider text-primary-600">{s(props, "definition_tag")}</span>
        </div>
        <Code lines={definition} />
      </div>
    </label>
  );
}
