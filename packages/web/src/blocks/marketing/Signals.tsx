import { Badge } from "@digitaplatform/components";
import { type P, Section, s, texts } from "./shared";

export function Signals({ props }: { props?: P }) {
  const items = texts(props, "items");
  if (!items.length) return null;
  return (
    <Section eyebrow={s(props, "eyebrow")}>
      <ul className="flex flex-wrap gap-2.5">
        {items.map((item, i) => (
          <li key={i}>
            <Badge variant="outline" size="lg" className="h-8 rounded-full px-3.5 text-sm font-normal">
              {item}
            </Badge>
          </li>
        ))}
      </ul>
      {s(props, "note") && <p className="mt-6 text-sm text-textMuted">{s(props, "note")}</p>}
    </Section>
  );
}
