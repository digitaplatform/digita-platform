import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { BaseDialog, Button, ToastHost, useToast, type ToastType } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';

/**
 * App-wide dialog + toast host. Capability is provided DOWN via context; deep
 * components invoke UP via useDialogHost() (confirm/toast). Both ride the kit:
 * the confirm on BaseDialog, the toasts on ToastHost, so a design reaches them
 * through the kit's hooks. Throws if used outside the provider — never a
 * silent no-op.
 */

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
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
  const tc = useChrome();
  return (
    <ToastHost closeLabel={tc('ui.action.close')}>
      <ConfirmHost>{children}</ConfirmHost>
    </ToastHost>
  );
}

/** Inside ToastHost, so the api can hand out the kit's toast under the app's signature. */
function ConfirmHost({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const tc = useChrome();
  const { toast } = useToast();

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
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
          ownership, exit animation all come from BaseDialog). The message is a
          bare text child of the kit's dialog-body, so a design styles it there. */}
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
        {pending?.message}
      </BaseDialog>
    </Ctx.Provider>
  );
}
