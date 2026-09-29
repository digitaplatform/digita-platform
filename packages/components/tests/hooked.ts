import { expect } from 'vitest';

/** The one check every hooked element passes: it carries the hook a design draws it by. */
export function expectHooked(el: Element | null, hook: string) {
  expect(el, `an element hooked as ${hook}`).not.toBeNull();
  expect(el!.getAttribute('data-ui'), `hook of <${el!.tagName.toLowerCase()}>`).toBe(hook);
}
