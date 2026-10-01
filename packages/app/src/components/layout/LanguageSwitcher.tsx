import { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { LanguageMenu } from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import { useChrome } from '@/lib/chrome-i18n';
import { useProfileUpdate } from '@/hooks/useAccount';
import { useDialogHost } from '@/components/overlay/DialogHost';

/**
 * Language picker driven entirely by the BACKEND: the options are the engine's
 * Language entities (from /boot.available_languages) and switching reloads that
 * locale's backend translations. Hidden when the platform disallows user language
 * choice or only one language exists. `onChosen` runs after the switch; the sign-in
 * shell passes none.
 *
 * Nordstern F15: a compact globe menu (kit Menu/MenuItem radio items) instead of
 * a 176px Select box — the topbar stays one calm row of icon buttons.
 */
export function LanguageSwitcher({ onChosen }: { onChosen?: (code: string) => void }) {
  const tc = useChrome();
  const languages = useSessionStore((s) => s.languages);
  const allow = useSessionStore((s) => s.allowUserLanguage);
  const current = useSessionStore((s) => s.locale?.code);
  const setLocale = useSessionStore((s) => s.setLocale);
  const failureText = useSwitchFailureText();
  const [failure, setFailure] = useState<string | null>(null);

  if (!allow || languages.length < 2) return null;

  return (
    <>
      <LanguageMenu
        label={tc('ui.lang.label')}
        current={current}
        icon={<Globe className="h-5 w-5" aria-hidden="true" />}
        languages={languages.map((l) => ({ code: l.code, label: `${l.flag_emoji ? `${l.flag_emoji} ` : ''}${l.native_name}` }))}
        onSelect={(code) => {
          setLocale(code).catch(() => setFailure(failureText()));
          onChosen?.(code);
        }}
      />
      {failure && <FailureToast text={failure} onShown={() => setFailure(null)} />}
    </>
  );
}

/** The text that tells a person their language switch failed. */
function useSwitchFailureText(): () => string {
  const tc = useChrome();
  return () => tc('ui.status.somethingWrong');
}

/** Shows a failed switch as a toast. It mounts only once a switch failed, so the switcher
 *  reaches for the dialog host only when it has something to show. */
function FailureToast({ text, onShown }: { text: string; onShown: () => void }) {
  const dialog = useDialogHost();
  // StrictMode runs a mount effect twice, and the failure is one message.
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    dialog.toast(text, 'error');
    onShown();
  }, [dialog, text, onShown]);
  return null;
}

/**
 * Switches the page to a language, its texts, formats and text direction, from a page
 * that shows its own toasts. A switch that fails is shown, so the page never stays in
 * the old language without a word.
 */
export function useSwitchLanguage(): (code: string) => void {
  const setLocale = useSessionStore((s) => s.setLocale);
  const failureText = useSwitchFailureText();
  const dialog = useDialogHost();
  return (code) => {
    setLocale(code).catch(() => dialog.toast(failureText(), 'error'));
  };
}

/**
 * For the signed-in chrome: saves a chosen language to the user's IdP profile, because the
 * IdP writes that user's mails in the profile's language. A failed save is shown, not hidden.
 */
export function useSaveLanguageToProfile(): (code: string) => void {
  const tc = useChrome();
  const profile = useProfileUpdate();
  const dialog = useDialogHost();
  return (code) => profile.mutate({ language: code }, { onError: () => dialog.toast(tc('ui.lang.notSaved'), 'error') });
}
