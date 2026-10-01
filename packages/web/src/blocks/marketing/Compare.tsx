import { type P, Section, list, s, texts } from "./shared";

/**
 * A comparison, row by row, with the second column as the answer the page argues for. A table on
 * a wide screen; on a phone each row stacks and every cell carries its column's name.
 */
export function Compare({ props }: { props?: P }) {
  const [columnA, columnB] = texts(props, "columns");
  const rows = list(props, "rows").filter((row) => s(row, "aspect"));
  if (!columnA || !columnB || !rows.length) return null;
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")} lede={s(props, "lede")}>
      <table className="block w-full text-left md:table md:table-fixed md:border-collapse">
        <thead className="hidden md:table-header-group">
          <tr>
            <th scope="col" className="w-1/4 pb-4" />
            <th scope="col" className="pb-4 pr-6 font-mono text-xs font-medium uppercase tracking-widest text-textMuted">
              {columnA}
            </th>
            <th scope="col" className="pb-4 pl-6 font-mono text-xs font-medium uppercase tracking-widest text-primaryText">
              {columnB}
            </th>
          </tr>
        </thead>
        <tbody className="block md:table-row-group">
          {rows.map((row, i) => (
            <tr key={i} className="flex flex-col gap-3 border-t border-border py-5 md:table-row">
              <th scope="row" className="block align-top font-display text-lg font-semibold text-textMain md:table-cell md:py-5 md:pr-6">
                {s(row, "aspect")}
              </th>
              <td className="block align-top text-sm leading-relaxed text-textMuted md:table-cell md:py-5 md:pr-6">
                <span className="mb-1 block font-mono text-xs uppercase tracking-widest md:hidden">{columnA}</span>
                {s(row, "a")}
              </td>
              <td className="block border-l-2 border-primaryGraphic pl-4 align-top text-sm font-medium leading-relaxed text-textMain md:table-cell md:border-l md:py-5 md:pl-6">
                <span className="mb-1 block font-mono text-xs uppercase tracking-widest text-primaryText md:hidden">{columnB}</span>
                {s(row, "b")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
