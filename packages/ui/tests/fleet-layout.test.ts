import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { computeLayout, parseLayout } from '@/components/render/layout';

/**
 * Fleet census — runs the auto-layout engine over the REAL entity fleet (engine
 * platform entities + the digitaapps/erp app) and proves its invariants hold on
 * every one, so a metadata change that would drop/reorder a field or wrongly
 * re-layout an authored form fails here. `computeLayout` is pure, so this needs no
 * DOM: it walks the JSON files and checks the derived tree.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = join(HERE, '../../engine/src/entities');
const ERP_DIR = join(HERE, '../../../../digita-apps/erp');

/** Only the layout BOUNDARY types are consumed by the layout tree; Heading/HTML/
 *  Button render as normal cells and must survive into the output. */
const BOUNDARY = new Set(['TabBreak', 'SectionBreak', 'ColumnBreak']);

function* entityFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name.startsWith('.')) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) yield* entityFiles(full);
    else if (ent.name.endsWith('.entity.json')) yield full;
  }
}

function loadEntities(dir: string): EntityDefinition[] {
  const out: EntityDefinition[] = [];
  for (const file of entityFiles(dir)) {
    let e: EntityDefinition;
    try {
      e = JSON.parse(readFileSync(file, 'utf8')) as EntityDefinition;
    } catch {
      continue; // a malformed JSON is another test's problem; skip here
    }
    if (Array.isArray(e.fields)) out.push(e);
  }
  return out;
}

/** Non-data decorations — not counted toward the auto-tab field threshold (mirrors
 *  the engine's own DECORATION set in layout.ts). */
const DECORATION = new Set(['Heading', 'HTML', 'Button']);

const dataNames = (fields: FieldDefinition[]): string[] =>
  fields.filter((f) => !BOUNDARY.has(f.fieldtype)).map((f) => f.fieldname);

const flat = (tabs: ReturnType<typeof computeLayout>): string[] =>
  tabs.flatMap((t) => t.sections.flatMap((s) => s.columns.flatMap((c) => c.fields.map((f) => f.fieldname))));

function fleetChecks(label: string, dir: string) {
  const entities = loadEntities(dir);

  it(`${label}: found entities`, () => {
    expect(entities.length).toBeGreaterThan(0);
  });

  it(`${label}: census invariant — every field survives, in source order, nothing hidden`, () => {
    for (const e of entities) {
      expect(flat(computeLayout(e.fields, e.form)), e.name).toEqual(dataNames(e.fields));
    }
  });

  it(`${label}: an authored TabBreak/ColumnBreak layout is left byte-identical to parseLayout`, () => {
    for (const e of entities) {
      if (e.fields.some((f) => f.fieldtype === 'TabBreak' || f.fieldtype === 'ColumnBreak')) {
        expect(computeLayout(e.fields, e.form), e.name).toEqual(parseLayout(e.fields));
      }
    }
  });

  it(`${label}: the engine AUTO-tabs ONLY past its threshold (≥2 sections + ≥tabify data / tabbed)`, () => {
    const autoTabbed: string[] = [];
    for (const e of entities) {
      if (e.fields.some((f) => f.fieldtype === 'TabBreak')) continue; // authored — not auto
      const tabs = computeLayout(e.fields, e.form);
      if (tabs.length <= 1) continue;
      autoTabbed.push(e.name);

      // It auto-tabbed → it must genuinely qualify (guards against the engine tabbing
      // a small/flat entity). Re-derive the decision inputs from the single-tab tree.
      const base = parseLayout(e.fields)[0]!;
      const sections = base.sections.filter((s) => s.key !== '_main').length;
      const dataCount = e.fields.filter(
        (f) => !BOUNDARY.has(f.fieldtype) && !DECORATION.has(f.fieldtype),
      ).length;
      const tabify = e.form?.tabify ?? 12;
      const qualifies = e.form?.layout !== 'flat' && sections >= 2 && (e.form?.layout === 'tabbed' || dataCount >= tabify);
      expect(qualifies, `${e.name} auto-tabbed without meeting the threshold`).toBe(true);
    }
    // Visibility of the blast radius (snapshot infra is unavailable in this project).
    console.info(`[fleet-layout] ${label} auto-tabbed (${autoTabbed.length}): ${autoTabbed.sort().join(', ')}`);
  });
}

describe('fleet census — engine entities', () => fleetChecks('engine', ENGINE_DIR));

describe.skipIf(!existsSync(ERP_DIR))('fleet census — digitaapps/erp', () => fleetChecks('erp', ERP_DIR));

if (!existsSync(ERP_DIR)) {
  // digita-ui tests are not in the root CI gate; locally the sibling checkout is
  // always present, so keep the skip loud rather than silently green.
  console.warn('[fleet-layout] digitaapps sibling checkout missing — ERP census SKIPPED');
}
