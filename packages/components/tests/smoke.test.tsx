import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../src/primitives/Button.js';

describe('test setup smoke', () => {
  it('renders a kit component under jsdom', () => {
    render(<Button>OK</Button>);
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });
});
