import { getSignature, registerSignature, type Signature } from "@digitaplatform/theme";
import { signature as digita } from "@digitaplatform/digita";
import { signature as simetrix } from "@digitaplatform/simetrix";
import { signature as veloluckLakeside } from "@digitaplatform/veloluck-lakeside";
import { signature as veloluckPrecise } from "@digitaplatform/veloluck-precise";
import { signature as veloluckWorkbench } from "@digitaplatform/veloluck-workbench";

// The signatures a site may name in `theme` ship bundled, as the default does in the app
// (packages/app/src/stores/theme.ts): registered before any id is resolved, so each lands with
// its full identity. digita is the family's mark, simetrix the company's own for simetrix.ch, and
// the three Veloluck looks belong to the demo company's website.
registerSignature(digita);
registerSignature(simetrix);
registerSignature(veloluckWorkbench);
registerSignature(veloluckLakeside);
registerSignature(veloluckPrecise);

/** The signature a site is drawn in: the one its `theme` names. getSignature falls back to the
 *  default for an id nobody registered. */
export function siteSignature(theme: string | undefined): Signature {
  return getSignature(theme);
}
