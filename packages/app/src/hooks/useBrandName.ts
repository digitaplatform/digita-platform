import { getSignature } from '@digitaplatform/theme';
import { useSessionStore } from '@/stores/session';
import { useThemeStore } from '@/stores/theme';

/** The tenant's name wherever the app shows it: its BrandingSetting.app_name, else the look's own
 *  name. The header, the sign-in card and the browser tab show the same name. */
export function useBrandName(): string {
  const appName = useSessionStore((s) => s.branding?.app_name);
  const signatureId = useThemeStore((s) => s.signature);
  return appName ?? getSignature(signatureId).name;
}
