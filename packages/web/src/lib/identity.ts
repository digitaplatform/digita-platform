import { getSignature, registerSignature, type Signature } from "@digitaplatform/theme";
import { signature as bundledDefault } from "@digitaplatform/digita";

// The platform's default signature ships bundled, as in the app (packages/app/src/stores/theme.ts):
// registered before any id is resolved, so it lands with its full identity.
registerSignature(bundledDefault);

/** The signature a site is drawn in: the one its `theme` names. getSignature falls back to the
 *  default for an id nobody registered. */
// ponytail: only the digita signature is bundled; "simetrix" draws as digita until the unpublished
// @digitaplatform/simetrix package is a dependency and registered here like bundledDefault.
export function siteSignature(theme: string | undefined): Signature {
  return getSignature(theme);
}
