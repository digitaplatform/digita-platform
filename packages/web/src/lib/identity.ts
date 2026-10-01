import { getRuntimeSignature, getSignature, registerSignature, type Signature } from "@digitaplatform/theme";
import { signature as digita } from "@digitaplatform/digita";
import { signature as simetrix } from "@digitaplatform/simetrix";
import { signature as veloluckLakeside } from "@digitaplatform/veloluck-lakeside";
import { signature as veloluckPrecise } from "@digitaplatform/veloluck-precise";
import { signature as veloluckWorkbench } from "@digitaplatform/veloluck-workbench";

// The signatures a site may name in `theme` ship bundled, as the same five do in the app
// (packages/app/src/stores/theme.ts): registered before any id is resolved, so each lands with
// its full identity. digita is the family's mark, simetrix the company's own for simetrix.ch, and
// the three Veloluck looks belong to the demo company's website.
registerSignature(digita);
registerSignature(simetrix);
registerSignature(veloluckWorkbench);
registerSignature(veloluckLakeside);
registerSignature(veloluckPrecise);

/** The signature a site is drawn in: the one its `theme` names, else the website look the
 *  tenant's settings name (findWebsiteSignature), else the default. An id the renderer does not
 *  bundle passes to the next one and is logged once, since every request renders the layout. */
export function siteSignature(theme: string | undefined, websiteLook?: string): Signature {
  for (const id of [theme, websiteLook]) {
    if (!id) continue;
    const signature = getRuntimeSignature(id);
    if (signature) return signature;
    if (!unbundledLooks.has(id)) {
      console.error(`[digita-web] the signature "${id}" is not bundled in the renderer; drawing the next look`);
      unbundledLooks.add(id);
    }
  }
  return getSignature(undefined);
}

const unbundledLooks = new Set<string>();
