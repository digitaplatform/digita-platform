import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import { ToastHost, useToast, type ToastOptions, type ToastType } from '../src/composites/Toast.js';

/** Test rig: a button that fires one toast through the context api. */
function Trigger({ text, opts }: { text: string; opts?: ToastType | ToastOptions }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(text, opts)}>
      fire
    </button>
  );
}

describe('ToastHost / useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a polite role=status toast and auto-dismisses after 4s', () => {
    render(
      <ToastHost>
        <Trigger text="Saved" opts="success" />
      </ToastHost>,
    );
    fireEvent.click(screen.getByText('fire'));
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Saved');
    expect(toast).toHaveAttribute('data-type', 'success');
    expect(toast).toHaveAttribute('aria-live', 'polite');
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders errors as assertive role=alert and keeps them 6s', () => {
    render(
      <ToastHost>
        <Trigger text="Boom" opts="error" />
      </ToastHost>,
    );
    fireEvent.click(screen.getByText('fire'));
    const toast = screen.getByRole('alert');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.getByRole('alert')).toBeTruthy(); // outlives the info window
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dismisses manually via the × control (duration 0 = sticky)', () => {
    render(
      <ToastHost>
        <Trigger text="Pinned" opts={{ type: 'info', duration: 0 }} />
      </ToastHost>,
    );
    fireEvent.click(screen.getByText('fire'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('status')).toBeTruthy(); // sticky — never auto-dismissed
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('runs the optional action and dismisses the toast', () => {
    const onUndo = vi.fn();
    render(
      <ToastHost>
        <Trigger text="Deleted" opts={{ type: 'warning', action: { label: 'Undo', onClick: onUndo } }} />
      </ToastHost>,
    );
    fireEvent.click(screen.getByText('fire'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stacks multiple toasts in the z-toast viewport', () => {
    render(
      <ToastHost>
        <Trigger text="One" />
      </ToastHost>,
    );
    fireEvent.click(screen.getByText('fire'));
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getAllByRole('status')).toHaveLength(2);
    const viewport = document.querySelector('[data-ui="toast-viewport"]')!;
    expect(viewport.className).toContain('z-toast');
  });

  it('useToast outside <ToastHost> throws (no silent no-op)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow('useToast must be used within <ToastHost>');
    spy.mockRestore();
  });
});
