import type { Audience } from '@digitaplatform/shared';
import { canEnterAudience } from '@digitaplatform/shared';
import { useSessionStore } from '@/stores/session';
import { ShellRenderer } from '@/templates/ShellRenderer';

/**
 * The audience seam (ADR-A1…A3). Sits between RequireAuth and the generic
 * ShellRenderer and selects the shell for the caller's ACTIVE audience.
 *
 * Today the only wired SPA runtime is `internal` (the operator back office);
 * dual-grant users default to internal (roadmap 2.3), so this resolves to a
 * constant and renders ShellRenderer unchanged — ZERO visible change. Phase 5
 * adds external/anonymous SPA arms here (portal/marketing templates), keyed off
 * the /boot audiences map.
 *
 * The canEnterAudience call is the presentation-gate SEAM — wired + tested, but
 * NON-BLOCKING in Phase 4: audience is chrome-only (ADR-A3) and RBAC remains the
 * real data boundary, so a failed gate must not deny render (and the grant-set is
 * absent until digita-auth signs it — blocking would lock out every live session).
 * Enforcement (redirect on a failed gate) is a deliberate later decision.
 */
export function AudienceShell() {
  const tiers = useSessionStore((s) => s.tiers);

  // TODO(P5): resolveActiveAudience(tiers) once more than `internal` is live.
  const active: Audience = 'internal';

  // Evaluated for its seam/observability only — intentionally not used to gate.
  const mayEnter = canEnterAudience(active, tiers ?? undefined);
  if (!mayEnter && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug(
      `[audience] rendering "${active}" shell though canEnterAudience is false ` +
        `(grants=${JSON.stringify(tiers)}) — chrome-only, RBAC is the boundary (ADR-A3).`,
    );
  }

  return <ShellRenderer />;
}
