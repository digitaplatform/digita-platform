import { type P, Section, list, s } from "./shared";

export function Checklist({ props }: { props?: P }) {
  const items = list(props, "items").filter((item) => s(item, "what"));
  if (!items.length) return null;
  // Three columns only when they fill evenly; otherwise two, so no column runs short by more than one.
  const columns = items.length % 3 === 0 ? "md:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2";
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")}>
      <ul className={`grid gap-x-8 ${columns}`}>
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 border-t border-border py-4">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary-600">
              <path d="M5 10.5l3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-textMain">{s(item, "what")}</span>
              {s(item, "note") && <span className="text-sm leading-relaxed text-textMuted">{s(item, "note")}</span>}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
