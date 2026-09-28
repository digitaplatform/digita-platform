import { Card } from "@digitaplatform/components";
import { type P, Section, cardClass, list, s } from "./shared";

/** Four items fill four columns and three fill three; a row never ends on a lone card. */
const COLUMNS = (count: number) => (count % 4 === 0 ? "sm:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3");

export function Pillars({ props }: { props?: P }) {
  const items = list(props, "items").filter((item) => s(item, "title"));
  if (!items.length) return null;
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")} lede={s(props, "lede")}>
      <div className={`grid gap-5 ${COLUMNS(items.length)}`}>
        {items.map((item, i) => (
          <Card key={i} variant="default" className={cardClass}>
            {s(item, "num") && <p className="font-mono text-xs tracking-wider text-primary-600">{s(item, "num")}</p>}
            <h3 className="font-display text-xl font-semibold text-textMain">{s(item, "title")}</h3>
            {s(item, "body") && <p className="text-sm leading-relaxed text-textMuted">{s(item, "body")}</p>}
          </Card>
        ))}
      </div>
    </Section>
  );
}
