import { Card } from "@digitaplatform/components";
import { type P, Section, cardClass, list, s } from "./shared";

export function Segments({ props }: { props?: P }) {
  const items = list(props, "items").filter((item) => s(item, "title"));
  if (!items.length) return null;
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")} lede={s(props, "lede")}>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <Card key={i} variant="default" className={cardClass}>
            {s(item, "mark") && <p className="font-mono text-xs uppercase tracking-widest text-primary-600">{s(item, "mark")}</p>}
            <h3 className="font-display text-xl font-semibold text-textMain">{s(item, "title")}</h3>
            {s(item, "who") && <p className="text-sm leading-relaxed text-textMuted">{s(item, "who")}</p>}
            {s(item, "gain") && <p className="mt-auto border-t border-border pt-3 text-sm leading-relaxed text-textMain">{s(item, "gain")}</p>}
          </Card>
        ))}
      </div>
    </Section>
  );
}
