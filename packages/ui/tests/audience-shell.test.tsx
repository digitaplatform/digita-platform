// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { AudienceGrant } from '@digitaplatform/shared';

// Stub the heavy generic shell so this test isolates AudienceShell's own logic
// (delegate to the shell + non-blocking gate), not the whole region renderer.
vi.mock('@/templates/ShellRenderer', () => ({
  ShellRenderer: () => <div data-testid="shell-stub">shell</div>,
}));

import { AudienceShell } from '@/templates/AudienceShell';
import { useSessionStore } from '@/stores/session';

function setTiers(tiers: AudienceGrant[] | null): void {
  useSessionStore.setState({ tiers });
}

afterEach(() => {
  cleanup();
  setTiers(null);
});

describe('AudienceShell (ADR-A1…A3, internal path only)', () => {
  it('renders the internal shell when the audience-set is unknown (null)', () => {
    setTiers(null);
    render(<AudienceShell />);
    // Zero-change bar: pre-P1 sessions carry no grants yet and must still render.
    expect(screen.getByTestId('shell-stub')).toBeInTheDocument();
  });

  it('does NOT block render when canEnterAudience("internal", grants) is false', () => {
    // canEnterAudience('internal', []) === false — the gate is fail-open in Phase 4.
    setTiers([]);
    render(<AudienceShell />);
    expect(screen.getByTestId('shell-stub')).toBeInTheDocument();
  });

  it('renders the internal shell for an internal grant', () => {
    setTiers(['internal']);
    render(<AudienceShell />);
    expect(screen.getByTestId('shell-stub')).toBeInTheDocument();
  });

  it('renders the internal shell for a dual-grant (external+internal) user', () => {
    setTiers(['external', 'internal']);
    render(<AudienceShell />);
    expect(screen.getByTestId('shell-stub')).toBeInTheDocument();
  });
});
