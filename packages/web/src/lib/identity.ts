import { getSignature, registerSignature, type Signature } from "@digitaplatform/theme";
import { signature as digita } from "@digitaplatform/digita";
import { signature as simetrix } from "@digitaplatform/simetrix";

// The two signatures a site may name in `theme` ship bundled, as the default does in the app
// (packages/app/src/stores/theme.ts): registered before any id is resolved, so each lands with
// its full identity. simetrix is the company's own mark for simetrix.ch; digita the family's.
registerSignature(digita);
registerSignature(simetrix);

/** The signature a site is drawn in: the one its `theme` names. getSignature falls back to the
 *  default for an id nobody registered. */
export function siteSignature(theme: string | undefined): Signature {
  return getSignature(theme);
}
