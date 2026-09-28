// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// vitest runs a package's tests from its root. jsdom's style engine drops a
// border-color written as var(), so the rule under test gets a literal error color;
// the selectors, which are what this test is about, stay as shipped.
const BASE_CSS = readFileSync(join(process.cwd(), 'build/variants/base.css'), 'utf8').replaceAll(
  'var(--color-error)',
  'rgb(220, 38, 38)',
);

/** A design's resting border rule and the kit's own focus border, as they reach the page:
 *  the design layer loads after theme.css, so it wins every tie. */
const DESIGN_CSS = `
.focus\\:border-primary:focus { border-color: rgb(9, 9, 9); }
:root[data-design-variant="probe"] [data-ui="input"],
:root[data-design-variant="probe"] [data-ui="input-frame"],
:root[data-design-variant="probe"] [data-ui="textfield"],
:root[data-design-variant="probe"] [data-ui="select-trigger"] { border-color: rgb(1, 2, 3); }
`;

const HOOKS = ['input', 'input-frame', 'textfield', 'select-trigger'];

function mount(hook: string, invalid: boolean): HTMLElement {
  const el = document.createElement(hook === 'select-trigger' ? 'button' : 'div');
  el.setAttribute('data-ui', hook);
  el.className = 'focus:border-primary';
  if (invalid) el.setAttribute('aria-invalid', 'true');
  document.body.append(el);
  return el;
}

function install(css: string) {
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  for (const text of [css, DESIGN_CSS]) {
    const style = document.createElement('style');
    style.textContent = text;
    document.head.append(style);
  }
}

describe('the invalid border is a kit rule no design rest rule can hide', () => {
  beforeAll(() => document.documentElement.setAttribute('data-design-variant', 'probe'));
  afterEach(() => document.body.replaceChildren());

  it.each(HOOKS)('%s keeps the error border under a design that sets border-color', (hook) => {
    install(BASE_CSS);
    expect(getComputedStyle(mount(hook, true)).borderColor).toBe('rgb(220, 38, 38)');
    expect(getComputedStyle(mount(hook, false)).borderColor).toBe('rgb(1, 2, 3)');
  });

  it('goes red when the rule loses its root scope (planted defect)', () => {
    install(BASE_CSS.replaceAll(':root[data-design-variant] [data-ui=', ':root [data-ui='));
    expect(getComputedStyle(mount('input', true)).borderColor).toBe('rgb(1, 2, 3)');
  });
});
