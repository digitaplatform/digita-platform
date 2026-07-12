import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  type?: ToastType;
  /** Auto-dismiss delay in ms. Default 4000 (errors 6000 — they carry
   *  consequences); `0` or negative = sticky until manually dismissed. */
  duration?: number;
  /** Optional inline action ("Undo") — clicking runs it and dismisses. */
  action?: ToastAction;
}

export interface ToastApi {
  /** Show a toast; returns its id (for programmatic `dismiss`). The second
   *  argument accepts a bare type (`toast('Saved', 'success')`) or options. */
  toast: (text: string, options?: ToastType | ToastOptions) => number;
  dismiss: (id: number) => void;
}

interface ToastEntry {
  id: number;
  text: string;
  type: ToastType;
  action?: ToastAction;
}

const Ctx = createContext<ToastApi | null>(null);

/** Imperative toast api — throws outside <ToastHost> (never a silent no-op). */
export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToast must be used within <ToastHost>');
  return api;
}

const TONES: Record<ToastType, string> = {
  error: 'border-error bg-error-light text-error',
  warning: 'border-warning bg-warning-light text-warning',
  success: 'border-success bg-success-light text-success',
  info: 'border-border bg-surface text-textMain',
};

export interface ToastHostProps {
  children: ReactNode;
  /** Accessible name of the per-toast dismiss (×) control. */
  closeLabel?: string;
}

/**
 * App-wide toast host. Capability is provided DOWN via context; deep components
 * invoke UP via useToast(). The stack renders through a portal at <body> on the
 * z-toast layer (above open dialogs), enters with anim-toast-in, auto-dismisses
 * per type (errors linger) and always offers manual dismiss. Errors/warnings are
 * `role="alert"` (assertive), the rest `role="status"` (polite).
 */
export function ToastHost({ children, closeLabel = 'Dismiss' }: ToastHostProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, options?: ToastType | ToastOptions) => {
      const opts: ToastOptions = typeof options === 'string' ? { type: options } : (options ?? {});
      const type = opts.type ?? 'info';
      const id = ++seq.current;
      setToasts((list) => [...list, { id, text, type, action: opts.action }]);
      const ms = opts.duration ?? (type === 'error' ? 6000 : 4000);
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss],
  );

  // Unmount = drop every pending auto-dismiss (no timers firing into a dead host).
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {typeof document !== 'undefined' &&
        toasts.length > 0 &&
        createPortal(
          <div
            data-ui="toast-viewport"
            className="fixed bottom-4 right-4 z-toast flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
          >
            {toasts.map((t) => {
              const assertive = t.type === 'error' || t.type === 'warning';
              return (
                <div
                  key={t.id}
                  data-ui="toast"
                  data-type={t.type}
                  role={assertive ? 'alert' : 'status'}
                  aria-live={assertive ? 'assertive' : 'polite'}
                  className={cn(
                    'anim-toast-in flex items-start gap-2 rounded-card border px-3 py-2 text-sm shadow-lg',
                    TONES[t.type],
                  )}
                >
                  <ToastIcon type={t.type} />
                  <span className="min-w-0 flex-1 break-words pt-px">{t.text}</span>
                  {t.action && (
                    <button
                      type="button"
                      data-ui="toast-action"
                      onClick={() => {
                        t.action!.onClick();
                        dismiss(t.id);
                      }}
                      className="shrink-0 rounded px-1 pt-px text-sm font-semibold underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {t.action.label}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={closeLabel}
                    onClick={() => dismiss(t.id)}
                    className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

/** Status glyph per toast type — the kit's inline-SVG language, no icon lib. */
function ToastIcon({ type }: { type: ToastType }) {
  const cls = 'mt-0.5 h-4 w-4 shrink-0';
  if (type === 'success') {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 10.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'warning') {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <path d="M10 3l8 14H2l8-14z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M10 8.5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="0.9" fill="currentColor" />
    </svg>
  );
}
