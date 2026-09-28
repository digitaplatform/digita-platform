import { Card, ProductLockup } from "@digitaplatform/components";
import { LocaleLink } from "../LocaleLink";
import { type P, Section, StatusPill, cardClass, columnsFor, list, record, s } from "./shared";

function lockupOf(item: P): { family: string; product: string } | null {
  const lockup = record(item, "lockup");
  const family = s(lockup, "family");
  const product = s(lockup, "product");
  return family && product ? { family, product } : null;
}

/** The products and apps a site offers, each named by its family lockup or a plain title, with
 *  how available it is today. */
export function Stack({ props }: { props?: P }) {
  const items = list(props, "items").filter((item) => s(item, "title") || lockupOf(item));
  if (!items.length) return null;
  return (
    <Section eyebrow={s(props, "eyebrow")} heading={s(props, "heading")} lede={s(props, "lede")}>
      <div className={`grid gap-5 ${columnsFor(items.length)}`}>
        {items.map((item, i) => {
          const lockup = lockupOf(item);
          const coming = s(item, "status") === "coming";
          return (
            <Card key={i} variant="default" className={`${cardClass} ${coming ? "border-dashed border-borderStrong bg-transparent" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-xl font-semibold text-textMain">
                  {lockup ? (
                    <ProductLockup family={lockup.family} product={lockup.product} className="text-2xl" />
                  ) : (
                    s(item, "title")
                  )}
                </h3>
                <StatusPill status={s(item, "status")} />
              </div>
              {s(item, "body") && <p className="text-sm leading-relaxed text-textMuted">{s(item, "body")}</p>}
              {s(item, "href") && s(item, "link_label") && (
                <LocaleLink href={s(item, "href")} className="mt-auto text-sm font-semibold text-primary-600 hover:underline">
                  {s(item, "link_label")}
                </LocaleLink>
              )}
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
