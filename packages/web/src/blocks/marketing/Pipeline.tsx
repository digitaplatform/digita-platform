import { Card } from "@digitaplatform/components";
import { type P, Section, cardClass, columnsFor, list, s } from "./shared";

export function Pipeline({ props }: { props?: P }) {
  const stages = list(props, "stages").filter((stage) => s(stage, "title"));
  if (!stages.length) return null;
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")} lede={s(props, "lede")}>
      <ol className={`grid gap-5 ${columnsFor(stages.length)}`}>
        {stages.map((stage, i) => (
          <li key={i}>
            <Card variant="default" className={`h-full ${cardClass}`}>
              {s(stage, "stage") && <p className="font-mono text-xs tracking-wider text-primaryText">{s(stage, "stage")}</p>}
              <h3 className="font-display text-xl font-semibold text-textMain">{s(stage, "title")}</h3>
              {s(stage, "body") && <p className="text-sm leading-relaxed text-textMuted">{s(stage, "body")}</p>}
              {s(stage, "target") && (
                <p className="mt-auto border-t border-border pt-3 font-mono text-xs uppercase tracking-wider text-textMuted">{s(stage, "target")}</p>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </Section>
  );
}
