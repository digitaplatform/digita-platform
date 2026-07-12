"use client";

import { useParams } from "next/navigation";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { formatCurrency } from "@/lib/format";

/**
 * Flagship plugin: ONE real entity definition (a Sales Order — the shape powering
 * Digita's ERP) generates a REST API and an admin UI with depth a toy CRUD can't:
 * naming series, child-table lines, computed totals (hooks), a workflow. The API
 * panel shows RAW values (JSON is locale-agnostic); the admin UI panel formats
 * money for the CURRENT locale (1,886.15 vs 1.886,15 €) — real localization, not
 * just translation. Illustrative data, authentic structure. Respects
 * prefers-reduced-motion. Client-only, code-split via the registry.
 */

const STEP = 0.1;
const BASE = 0.3;
const CURRENCY = "EUR";

const LINES = [
  { product: "Aurora Lamp", qty: 10, price: 149 },
  { product: "Cable Set", qty: 5, price: 19 },
];
const lineTotal = (l: { qty: number; price: number }) => l.qty * l.price;
const SUBTOTAL = LINES.reduce((s, l) => s + lineTotal(l), 0);
const TAX = Math.round(SUBTOTAL * 0.19 * 100) / 100;
const GRAND = SUBTOTAL + TAX;

function Panel({ title, badge, children }: { title: string; badge: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-mono text-xs text-fg-muted">{title}</span>
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
          {badge}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function MetadataDemo() {
  const reduce = useReducedMotion();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";

  const card: Variants = {
    hidden: { opacity: 0, y: reduce ? 0 : 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  };
  const row = (i: number): Variants => ({
    hidden: { opacity: 0, y: reduce ? 0 : 6 },
    show: { opacity: 1, y: 0, transition: { delay: reduce ? 0 : BASE + i * STEP, duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  });

  return (
    <section
      className="mx-auto w-full max-w-6xl px-6 py-12 md:px-8 md:py-16"
      aria-label="How one Sales Order definition generates a REST API and an admin UI"
    >
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        className="grid items-start gap-5 lg:grid-cols-[1.05fr_auto_1fr]"
      >
        {/* Source: the entity definition */}
        <motion.div variants={card}>
          <Panel title="salesOrder.entity.json" badge="define">
            <pre className="overflow-x-auto font-mono text-[12.5px] leading-relaxed text-fg">
              <code>
                <span className="text-fg-muted">{"{"}</span>
                <motion.span variants={row(0)} className="block">
                  {"  "}
                  <span className="text-primary">&quot;naming&quot;</span>: <span className="text-fg">&quot;SO-{"{####:fiscal_year}"}&quot;</span>,
                </motion.span>
                <motion.span variants={row(1)} className="block">
                  {"  "}
                  <span className="text-primary">&quot;is_submittable&quot;</span>: <span className="text-fg">true</span>,{"  "}
                  <span className="text-fg-muted">// docstatus + workflow</span>
                </motion.span>
                <motion.span variants={row(2)} className="block">
                  {"  "}
                  <span className="text-primary">&quot;states&quot;</span>: [draft → confirmed → delivered],
                </motion.span>
                <motion.span variants={row(3)} className="block">
                  {"  "}
                  <span className="text-primary">&quot;fields&quot;</span>: [
                </motion.span>
                <motion.span variants={row(4)} className="block">
                  {"    { customer, "}
                  <span className="text-fg-muted">Link→Customer </span>
                  {"},"}
                </motion.span>
                <motion.span variants={row(5)} className="block">
                  {"    { lines, "}
                  <span className="text-fg-muted">Table[ product, qty, unit_price,</span>
                </motion.span>
                <motion.span variants={row(6)} className="block">
                  {"             line_total ] },"}
                </motion.span>
                <motion.span variants={row(7)} className="block">
                  {"    { grand_total, "}
                  <span className="text-fg-muted">computed </span>
                  {"} ],"}
                </motion.span>
                <motion.span variants={row(8)} className="block">
                  {"  "}
                  <span className="text-primary">&quot;hooks&quot;</span>: {"{ computeTotals, checkCreditLimit }"}
                </motion.span>
                <span className="text-fg-muted">{"}"}</span>
              </code>
            </pre>
          </Panel>
        </motion.div>

        {/* Connector */}
        <div className="flex items-center justify-center py-2 lg:h-full lg:flex-col lg:py-0">
          <div className="flex flex-col items-center gap-1">
            <span className="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-fg">Digita</span>
            <span aria-hidden className="text-fg-muted">
              <span className="lg:hidden">↓</span>
              <span className="hidden lg:inline">→</span>
            </span>
          </div>
        </div>

        {/* Generated outputs */}
        <div className="grid gap-5">
          <motion.div variants={card}>
            <Panel title="POST /api/v1/resource/SalesOrder" badge="api">
              <pre className="overflow-x-auto font-mono text-[12.5px] leading-relaxed text-fg">
                <code>
                  <span className="text-fg-muted">{"{"}</span>
                  <motion.span variants={row(0)} className="block">
                    {"  "}
                    <span className="text-primary">&quot;_id&quot;</span>: <span className="text-fg">&quot;SO-2026-0042&quot;</span>,{"  "}
                    <span className="text-fg-muted">// naming series</span>
                  </motion.span>
                  <motion.span variants={row(1)} className="block">
                    {"  "}
                    <span className="text-primary">&quot;customer&quot;</span>: <span className="text-fg">&quot;ACME GmbH&quot;</span>,
                  </motion.span>
                  <motion.span variants={row(2)} className="block">
                    {"  "}
                    <span className="text-primary">&quot;lines&quot;</span>: [
                  </motion.span>
                  {LINES.map((l, i) => (
                    <motion.span key={l.product} variants={row(3 + i)} className="block">
                      {"    { "}
                      {l.product}, ×{l.qty}, {lineTotal(l).toFixed(2)} {"}"}
                      {i < LINES.length - 1 ? "," : ""}
                    </motion.span>
                  ))}
                  <motion.span variants={row(5)} className="block">
                    {"  ],"}
                  </motion.span>
                  <motion.span variants={row(6)} className="block">
                    {"  "}
                    <span className="text-primary">&quot;grand_total&quot;</span>: <span className="text-fg">{GRAND.toFixed(2)}</span>,{"  "}
                    <span className="text-fg-muted">// raw (JSON)</span>
                  </motion.span>
                  <motion.span variants={row(7)} className="block">
                    {"  "}
                    <span className="text-primary">&quot;status&quot;</span>: <span className="text-fg">&quot;confirmed&quot;</span>,{" "}
                    <span className="text-primary">&quot;docstatus&quot;</span>: <span className="text-fg">1</span>
                  </motion.span>
                  <span className="text-fg-muted">{"}"}</span>
                </code>
              </pre>
            </Panel>
          </motion.div>

          <motion.div variants={card}>
            <Panel title="Admin form" badge="ui">
              <div className="space-y-3">
                <motion.div variants={row(0)}>
                  <label className="mb-1 block text-xs font-medium text-fg-muted">Customer</label>
                  <div className="flex h-9 items-center justify-between rounded-lg border border-line bg-muted-bg px-3 text-sm text-fg">
                    ACME GmbH <span aria-hidden className="text-fg-muted">▾</span>
                  </div>
                </motion.div>

                {/* line grid — money formatted for the current locale */}
                <motion.div variants={row(1)} className="overflow-hidden rounded-lg border border-line">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-line bg-muted-bg px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                    <span>Product</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Line total</span>
                  </div>
                  {LINES.map((l, i) => (
                    <motion.div
                      key={l.product}
                      variants={row(2 + i)}
                      className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 text-sm text-fg"
                    >
                      <span>{l.product}</span>
                      <span className="text-right tabular-nums text-fg-muted">{l.qty}</span>
                      <span className="text-right tabular-nums">{formatCurrency(lineTotal(l), locale, CURRENCY)}</span>
                    </motion.div>
                  ))}
                </motion.div>

                <motion.div variants={row(4)} className="flex items-center justify-between px-1 text-sm">
                  <span className="font-medium text-fg-muted">Grand total</span>
                  <span className="font-semibold tabular-nums text-fg">{formatCurrency(GRAND, locale, CURRENCY)}</span>
                </motion.div>

                {/* workflow bar */}
                <motion.div variants={row(5)} className="flex flex-wrap items-center gap-x-1.5 gap-y-2 pt-1 text-xs">
                  {["Draft", "Confirmed", "Delivered"].map((s, i) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span
                        className={
                          i === 1
                            ? "rounded-full bg-primary px-2.5 py-1 font-medium text-white"
                            : "rounded-full border border-line px-2.5 py-1 text-fg-muted"
                        }
                      >
                        {s}
                      </span>
                      {i < 2 && (
                        <span aria-hidden className="text-fg-muted">
                          →
                        </span>
                      )}
                    </span>
                  ))}
                </motion.div>
              </div>
            </Panel>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
