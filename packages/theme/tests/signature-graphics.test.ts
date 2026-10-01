// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applySignature, registerSignature, resetSignature, signatureStyle, type SignatureValue } from '../src/index.js';

/**
 * A signature's graphics are the backgrounds the host paints: the shell backdrop paints grid and
 * glow, a card paints card, the sign-in page paints panel. A band nothing paints was written as
 * --sig-band-l/-d all the same, so a designer who drew one saw nothing and learned nothing. A
 * signature writes the graphics the host paints, and its teardown clears each one it writes.
 */

const graphic = (key: string): SignatureValue => ({ light: `url(${key}-light)`, dark: `url(${key}-dark)` });
const ALL_GRAPHICS = {
  grid: graphic('grid'),
  glow: graphic('glow'),
  band: graphic('band'),
  card: graphic('card'),
  panel: graphic('panel'),
};

describe('the graphics of a signature', () => {
  it('are written for the backgrounds the host paints, and a band is not', () => {
    const style = signatureStyle({ id: 'banded', name: 'Banded', accent: '#00B2F6', graphics: ALL_GRAPHICS });

    const written = Object.keys(style.properties).filter((property) => property.startsWith('--sig-'));
    expect(written.sort()).toEqual([
      '--sig-card-d',
      '--sig-card-l',
      '--sig-glow-d',
      '--sig-glow-l',
      '--sig-grid-d',
      '--sig-grid-l',
      '--sig-panel-d',
      '--sig-panel-l',
    ]);
    expect(style.properties['--sig-panel-l']).toBe('url(panel-light)');
  });

  it('leave no background behind when the signature is torn down', () => {
    const root = document.documentElement;
    registerSignature({ id: 'teardown', name: 'Teardown', accent: '#00B2F6', graphics: ALL_GRAPHICS });
    applySignature('teardown');
    expect(root.style.getPropertyValue('--sig-grid-l')).toBe('url(grid-light)');

    resetSignature();

    const left = [...root.style].filter((property) => property.startsWith('--sig-'));
    expect(left).toEqual([]);
  });
});
