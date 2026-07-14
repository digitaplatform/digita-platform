import { describe, it, expect } from 'vitest';
import { isDigitaPlugin } from '../src/index.js';

describe('isDigitaPlugin', () => {
  it('accepts all three plugin types, including the new signature type', () => {
    expect(isDigitaPlugin({ type: 'component', id: 'x' })).toBe(true);
    expect(isDigitaPlugin({ type: 'design', id: 'x' })).toBe(true);
    expect(isDigitaPlugin({ type: 'signature', id: 'x' })).toBe(true);
  });

  it('rejects unknown types and non-objects', () => {
    expect(isDigitaPlugin({ type: 'theme', id: 'x' })).toBe(false);
    expect(isDigitaPlugin(null)).toBe(false);
    expect(isDigitaPlugin('signature')).toBe(false);
    expect(isDigitaPlugin({})).toBe(false);
  });
});
