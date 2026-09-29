import { describe, it, expect } from 'vitest';
import { varsForDesign, getDesign, controlHeight, topBarHeight, type Design } from '../src/index.js';

describe('the vars a design emits for the overlays and the controls', () => {
  const minimal = getDesign('minimal');

  it('emits --color-scrim in both modes', () => {
    expect(varsForDesign(minimal, 'light')['--color-scrim']).toBe(minimal.semantic.light.scrim);
    expect(varsForDesign(minimal, 'dark')['--color-scrim']).toBe(minimal.semantic.dark.scrim);
  });

  it('emits --control-h once, in the light block, from the platform scale when the design sets none', () => {
    expect(varsForDesign(minimal, 'light')['--control-h']).toBe(controlHeight);
    expect(varsForDesign(minimal, 'dark')).not.toHaveProperty('--control-h');
  });

  it('emits --topbar-h once, in the light block, from the platform scale', () => {
    expect(varsForDesign(minimal, 'light')['--topbar-h']).toBe(topBarHeight);
    expect(varsForDesign(minimal, 'dark')).not.toHaveProperty('--topbar-h');
  });

  it('lets a design raise --control-h to its own idiom', () => {
    const tall: Design = { ...minimal, controlHeight: '2.75rem' };
    expect(varsForDesign(tall, 'light')['--control-h']).toBe('2.75rem');
  });
});
