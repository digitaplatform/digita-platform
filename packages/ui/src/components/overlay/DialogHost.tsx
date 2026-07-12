import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BaseDialog, Button } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * App-wide dialog + toast host. Capability is provided DOWN via context; deep
 * components invoke UP via useDialogHost() (confirm/toast). Rendered through a
 * portal at <body> so it escapes the shell's overflow. Bottom sheet on phone,
 * centered modal on desktop (CSS). Throws if used outside the provider — never a
 * silent no-op.
 */

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
type ToastType = 'success' | 'info' | 'warning' | 'error';
interface Toast {
  id: number;
  text: string;
  type: ToastType;
}
interface DialogHostApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  toast: (text: string, type?: ToastType) => void;
}

const Ctx = createContext<DialogHostApi | null>(null);

export function useDialogHost(): DialogHostApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useDialogHost must be used within <DialogHostProvider>');
  return api;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function DialogHostProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const tc = useChrome();

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, type: ToastType = 'info') => {
      const id = ++toastSeq.current;
      setToasts((list) => [...list, { id, text, type }]);
      // Errors stay a little longer — they carry consequences.
      setTimeout(() => dismissToast(id), type === 'error' ? 6000 : 4000);
    },
    [dismissToast],
  );

  const settle = useCallback(
    (ok: boolean) => {
      setPending((p) => {
        p?.resolve(ok);
        return null;
      });
    },
    [],
  );

  const api: DialogHostApi = { confirm, toast };

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Confirm rides the ONE dialog foundation (portal, focus trap, Escape
          ownership, exit animation all come from BaseDialog). */}
      <BaseDialog
        open={!!pending}
        onClose={() => settle(false)}
        title={pending?.title}
        size="sm"
        hideClose
        initialFocusRef={confirmBtn}
        footer={
          pending && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => settle(false)}>
                {pending.cancelLabel ?? tc('ui.action.cancel')}
              </Button>
              <Button
                ref={confirmBtn}
                type="button"
                variant={pending.danger ? 'danger' : 'primary'}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? tc('ui.action.confirm')}
              </Button>
            </div>
          )
        }
      >
        {pending?.message ? (
          <p className="text-sm text-textMuted">{pending.message}</p>
        ) : (
          <span className="sr-only">{pending?.title}</span>
        )}
      </BaseDialog>
      {createPortal(
        <>

          {toasts.length > 0 && (
            <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
              {toasts.map((t) => (
                <div
                  key={t.id}
                  role={t.type === 'error' || t.type === 'warning' ? 'alert' : 'status'}
                  className={
                    'anim-toast-in flex items-start gap-2 rounded-card border px-3 py-2 text-sm shadow-lg ' +
                    (t.type === 'error'
                      ? 'border-error bg-error-light text-error'
                      : t.type === 'warning'
                        ? 'border-warning bg-warning-light text-warning'
                        : t.type === 'success'
                          ? 'border-success bg-success-light text-success'
                          : 'border-border bg-surface text-textMain')
                  }
                >
                  <ToastIcon type={t.type} />
                  <span className="min-w-0 flex-1 break-words pt-px">{t.text}</span>
                  <button
                    type="button"
                    aria-label={tc('ui.action.close')}
                    onClick={() => dismissToast(t.id)}
                    className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>,
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
