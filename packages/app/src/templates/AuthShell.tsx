import { type ReactNode } from 'react';
import { getSignature } from '@digitaplatform/theme';
import { brandingImageKind } from '@digitaplatform/shared';
import { BrandMark } from '@digitaplatform/components';
import { useSessionStore } from '@/stores/session';
import { useThemeStore } from '@/stores/theme';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { appUrl } from '@/lib/appBase';

/** Unauthenticated chrome — a centered card on the branded background. The brand
 *  is the kit's BrandMark with the one precedence every surface shares (the
 *  family lockup, the signature wordmark, the tenant logo, the monogram); the
 *  name comes from the branding payload (falls back to the platform name, then
 *  "Digita"). A language picker (backend languages) sits top-right so the
 *  operator can choose their language before signing in. */
export function AuthShell({ children }: { children: ReactNode }) {
  const branding = useSessionStore((s) => s.branding);
  const platformName = useSessionStore((s) => s.settings?.platform_name);
  const appName = branding?.app_name ?? platformName ?? 'Digita';
  const signatureId = useThemeStore((s) => s.signature);
  const background = branding?.login_background;
  const backgroundKind = background ? brandingImageKind(background) : null;

  return (
    <div
      // The signature's `panel` layer is the REAL panel-contact vector (a
      // stretch-adapted data-URI SVG, preserveAspectRatio=none) — painted
      // 100%×100% like the sites stretch the panel over its section. A tenant
      // login_background (the image below) still covers it.
      className="relative isolate flex min-h-screen items-center justify-center bg-background bg-no-repeat bg-[length:100%_100%] p-4 bg-[image:var(--sig-panel-l)] dark:bg-[image:var(--sig-panel-d)]"
    >
      {/* An image element takes the address as it is: written into a CSS url(), a quote in it
          could end the address and add another. Only the app's own paths and inline images load. */}
      {background && backgroundKind && (
        <img
          src={backgroundKind === 'path' ? appUrl(background) : background}
          alt=""
          aria-hidden="true"
          data-testid="auth-background"
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
        />
      )}
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-[28px]">
          <BrandMark
            name={appName}
            logoUrl={branding?.logo ? appUrl(branding.logo) : undefined}
            logoDarkUrl={branding?.logo_dark ? appUrl(branding.logo_dark) : undefined}
            nameIsCustom={Boolean(branding?.app_name)}
            signature={getSignature(signatureId)}
          />
        </div>
        <div className="rounded-dialog border border-border bg-surface p-8 shadow-lg">{children}</div>
      </div>
    </div>
  );
}
