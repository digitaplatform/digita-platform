import { type Action, Actions, type P, Section, readAction, s } from "./shared";

/** The glow panel: an accent glow from the top of a surface card with a strong border. */
export function GlowPanel({ heading, body, primary, secondary }: { heading: string; body: string; primary: Action | null; secondary: Action | null }) {
  return (
    <Section>
      <div className="relative isolate flex flex-col items-center gap-5 overflow-hidden rounded-dialog border border-borderStrong bg-surface px-6 py-14 text-center md:px-16 md:py-20">
        <div aria-hidden="true" className="pointer-events-none absolute -top-1/2 left-1/2 -z-10 h-full w-4/5 -translate-x-1/2 rounded-full bg-primary-600 opacity-10 blur-3xl dark:opacity-20" />
        {heading && (
          <h2 className="max-w-3xl text-balance font-display text-3xl font-semibold tracking-tight text-textMain [overflow-wrap:anywhere] md:text-5xl">{heading}</h2>
        )}
        {body && <p className="max-w-2xl text-pretty text-lg leading-relaxed text-textMuted [overflow-wrap:anywhere]">{body}</p>}
        <Actions primary={primary} secondary={secondary} className="pt-2" />
      </div>
    </Section>
  );
}

export function CtaPanel({ props }: { props?: P }) {
  const heading = s(props, "heading");
  if (!heading) return null;
  return <GlowPanel heading={heading} body={s(props, "body")} primary={readAction(props, "primary")} secondary={readAction(props, "secondary")} />;
}
