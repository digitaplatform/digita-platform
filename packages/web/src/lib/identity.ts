import { DEFAULT_SIGNATURE_ID, getSignature, registerSignature, type Signature } from "@digitaplatform/theme";
import { signature as bundledDefault } from "@digitaplatform/digita";

// The platform's default signature ships bundled, as in the app (packages/app/src/stores/theme.ts):
// registered before the default id is resolved, so it lands with its full identity.
registerSignature(bundledDefault);

/** The signature a visitor sees before any choice of their own: the theme's default, resolved. */
export const defaultSignature: Signature = getSignature(DEFAULT_SIGNATURE_ID);
