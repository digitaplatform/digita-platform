import type { ReactNode } from "react";
import { Badge, buttonAttributes } from "@digitaplatform/components";
import type { Locale } from "@/i18n/config";
import { t } from "@/i18n/messages";
import { SheetButton } from "./SheetButton";
import { LocaleLink } from "../LocaleLink";

/** A block's JSON props, and readers that answer an empty value for anything of the wrong shape,
 *  so a block written by hand in the engine never throws in the renderer. */
export type P = Record<string, unknown>;
export const s = (p: P | undefined, k: string): string => (typeof p?.[k] === "string" ? (p[k] as string) : "");
export const list = (p: P | undefined, k: string): P[] =>
  Array.isArray(p?.[k]) ? (p[k] as unknown[]).filter((v): v is P => typeof v === "object" && v !== null) : [];
export const texts = (p: P | undefined, k: string): string[] =>
  Array.isArray(p?.[k]) ? (p[k] as unknown[]).filter((v): v is string => typeof v === "string" && v !== "") : [];
export const record = (p: P | undefined, k: string): P | undefined =>
  typeof p?.[k] === "object" && p[k] !== null && !Array.isArray(p[k]) ? (p[k] as P) : undefined;

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-xs font-medium uppercase tracking-widest text-textMuted ${className}`}>{children}</p>;
}

/**
 * One page section on the site's one spacing scale. The heading (eyebrow, title, lede) and the
 * content share this one section, so no block stacks a heading section on a content section.
 */
export function Section({
  eyebrow,
  heading,
  lede,
  className = "",
  children,
}: {
  eyebrow?: string;
  heading?: string;
  lede?: string;
  className?: string;
  children?: ReactNode;
}) {
  const hasHeading = Boolean(eyebrow || heading || lede);
  return (
    <section className={`mx-auto w-full max-w-6xl px-6 py-16 md:px-8 md:py-24 ${className}`}>
      {hasHeading && (
        <div className="flex max-w-3xl flex-col gap-4">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          {heading && (
            <h2 className="text-balance font-display text-3xl font-semibold tracking-tight text-textMain [overflow-wrap:anywhere] md:text-5xl">
              {heading}
            </h2>
          )}
          {lede && <p className="text-pretty text-lg leading-relaxed text-textMuted">{lede}</p>}
        </div>
      )}
      {hasHeading && children ? <div className="mt-10 md:mt-12">{children}</div> : children}
    </section>
  );
}

export type Status = "available" | "early_access" | "coming";
const STATUS_KEY: Record<Status, string> = { available: "statusAvailable", early_access: "statusEarlyAccess", coming: "statusComing" };
const isStatus = (value: string): value is Status => Object.hasOwn(STATUS_KEY, value);
const PILL = "shrink-0 rounded-full font-mono uppercase tracking-wider";

/** How true a capability is today: an accent pill, an outlined accent pill, an outlined muted pill. */
export function StatusPill({ status, locale }: { status: string; locale: Locale }) {
  if (!isStatus(status)) return null;
  const label = t(STATUS_KEY[status], locale);
  if (status === "available")
    return (
      <Badge variant="pill" color="primary" className={PILL}>
        {label}
      </Badge>
    );
  return (
    <Badge variant="outline" color={status === "early_access" ? "primary" : "neutral"} className={status === "coming" ? `${PILL} text-textMuted` : PILL}>
      {label}
    </Badge>
  );
}

/** A call to action from props: `{label, action: "sheet"}` opens the contact sheet, `{label, href}`
 *  (action "href" or none) is a link. Anything else is no action. */
export type Action = { label: string; sheet: boolean; href: string };
export function readAction(p: P | undefined, k: string): Action | null {
  const a = record(p, k);
  const label = s(a, "label");
  const sheet = s(a, "action") === "sheet";
  const href = s(a, "href");
  return label && (sheet || href) ? { label, sheet, href } : null;
}

function ActionButton({ action, variant }: { action: Action; variant: "primary" | "outline" }) {
  const attributes = buttonAttributes({ variant, size: "lg" });
  return action.sheet ? (
    <SheetButton {...attributes}>{action.label}</SheetButton>
  ) : (
    <LocaleLink href={action.href} {...attributes}>
      {action.label}
    </LocaleLink>
  );
}

/** The primary and the secondary call to action of a block, side by side, stacked on a phone. */
export function Actions({ primary, secondary, className = "" }: { primary: Action | null; secondary: Action | null; className?: string }) {
  if (!primary && !secondary) return null;
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:flex-wrap ${className}`}>
      {primary && <ActionButton action={primary} variant="primary" />}
      {secondary && <ActionButton action={secondary} variant="outline" />}
    </div>
  );
}

/** The hairline card on the surface every grid of the marketing blocks is built from. */
export const cardClass = "flex flex-col gap-3 p-6 md:p-7";

/** One column per item on a wide screen, as literal classes so the stylesheet carries them. */
const COLUMNS_BY_COUNT: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
  5: "md:grid-cols-3 lg:grid-cols-5",
  6: "md:grid-cols-3 lg:grid-cols-6",
};
export const columnsFor = (count: number): string => COLUMNS_BY_COUNT[count] ?? "md:grid-cols-3";
