"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";

const STEP = 0.1;
const BASE = 0.3;

export interface MetadataDemoViewProps {
  label: string;
  tags: { define: string; api: string; form: string };
  generator: string;
  definitionTitle: string;
  definition: string[];
  apiTitle: string;
  api: string[];
  formTitle: string;
  fields: { label: string; value: string }[];
  columns: string[];
  rows: string[][];
  states: string[];
  state: string;
}

function Panel({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="truncate font-mono text-xs text-textMuted">{title}</span>
        <span className="rounded-full bg-primaryContainer px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-onPrimaryContainer">
          {tag}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/** A line of code with its keys in the accent and its comments muted. */
function CodeLine({ line }: { line: string }) {
  return (
    <>
      {line.split(/("[^"]*"(?=\s*:)|\/\/.*$)/).map((part, j) =>
        part.startsWith("//") ? (
          <span key={j} className="text-textMuted">
            {part}
          </span>
        ) : part.startsWith('"') && j % 2 === 1 ? (
          <span key={j} className="text-primaryText">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The three panels, each line coming in after the one before it; still where motion is reduced. */
export function MetadataDemoView(p: MetadataDemoViewProps) {
  const reduce = useReducedMotion();
  const card: Variants = {
    hidden: { opacity: 0, y: reduce ? 0 : 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  };
  const row = (i: number): Variants => ({
    hidden: { opacity: 0, y: reduce ? 0 : 6 },
    show: { opacity: 1, y: 0, transition: { delay: reduce ? 0 : BASE + i * STEP, duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  });
  const code = (lines: string[]) => (
    <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-textMain">
      <code>
        {lines.map((line, i) => (
          <motion.span key={i} variants={row(i)} className="block whitespace-pre">
            <CodeLine line={line} />
          </motion.span>
        ))}
      </code>
    </pre>
  );
  // The first state of the name is the current one, so two states of one name never both say so.
  const current = p.states.indexOf(p.state);
  const grid = { gridTemplateColumns: `3fr ${p.columns.slice(1).map(() => "1fr").join(" ")}`.trim() };

  return (
    <section aria-label={p.label}>
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        className="grid items-start gap-5 lg:grid-cols-[1.05fr_auto_1fr]"
      >
        <motion.div variants={card}>
          <Panel title={p.definitionTitle} tag={p.tags.define}>
            {code(p.definition)}
          </Panel>
        </motion.div>

        <div className="flex items-center justify-center py-2 lg:h-full lg:flex-col lg:py-0">
          <div className="flex flex-col items-center gap-1">
            <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-textMain">{p.generator}</span>
            <span aria-hidden className="text-textMuted">
              <span className="lg:hidden">↓</span>
              <span className="hidden lg:inline">→</span>
            </span>
          </div>
        </div>

        <div className="grid gap-5">
          {p.api.length > 0 && (
            <motion.div variants={card}>
              <Panel title={p.apiTitle} tag={p.tags.api}>
                {code(p.api)}
              </Panel>
            </motion.div>
          )}

          <motion.div variants={card}>
            <Panel title={p.formTitle} tag={p.tags.form}>
              <div className="space-y-3">
                {p.fields.map((f, i) => (
                  <motion.div key={i} variants={row(i)}>
                    <span className="mb-1 block text-xs font-medium text-textMuted">{f.label}</span>
                    <div className="flex h-9 items-center rounded-input border border-border bg-subtle px-3 text-sm text-textMain">{f.value}</div>
                  </motion.div>
                ))}

                {p.columns.length > 0 && (
                  <motion.div variants={row(p.fields.length)} className="overflow-hidden rounded-card border border-border">
                    <div
                      style={grid}
                      className="grid gap-2 border-b border-border bg-subtle px-3 py-1.5 text-micro font-medium uppercase tracking-wide text-textMuted"
                    >
                      {p.columns.map((c, i) => (
                        <span key={i} className={i > 0 ? "text-right" : undefined}>
                          {c}
                        </span>
                      ))}
                    </div>
                    {p.rows.map((cells, r) => (
                      <motion.div key={r} variants={row(p.fields.length + 1 + r)} style={grid} className="grid gap-2 px-3 py-1.5 text-sm text-textMain">
                        {cells.map((cell, i) => (
                          <span key={i} className={i > 0 ? "text-right tabular-nums" : undefined}>
                            {cell}
                          </span>
                        ))}
                      </motion.div>
                    ))}
                  </motion.div>
                )}

                {p.states.length > 0 && (
                  <motion.div variants={row(p.fields.length + p.rows.length + 1)} className="flex flex-wrap items-center gap-x-1.5 gap-y-2 pt-1 text-xs">
                    {p.states.map((name, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        <span
                          aria-current={i === current ? "step" : undefined}
                          className={
                            i === current
                              ? "rounded-full bg-primary-600 px-2.5 py-1 font-medium text-onPrimary"
                              : "rounded-full border border-border px-2.5 py-1 text-textMuted"
                          }
                        >
                          {name}
                        </span>
                        {i < p.states.length - 1 && (
                          <span aria-hidden className="text-textMuted">
                            →
                          </span>
                        )}
                      </span>
                    ))}
                  </motion.div>
                )}
              </div>
            </Panel>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
