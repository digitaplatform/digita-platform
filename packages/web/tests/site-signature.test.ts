// A site names its signature in `theme`; simetrix.ch wears the simetrix mark, not the family's.
import { describe, it, expect } from "vitest";
import { siteSignature } from "../src/lib/identity";

describe("siteSignature", () => {
  it("PLANTED DEFECT: a site with theme simetrix is drawn in the simetrix signature, not in digita", () => {
    const signature = siteSignature("simetrix");
    // While the package was not bundled, this fell back to digita; that goes red here.
    expect(signature.id).toBe("simetrix");
    expect(signature.wordmark).toContain("simetri");
    expect(signature.monogram).not.toBe(siteSignature("digita").monogram);
  });

  it("PLANTED INNOCENT: the digita family and an unknown id keep the default", () => {
    expect(siteSignature("digita").id).toBe("digita");
    expect(siteSignature(undefined).id).toBe("digita");
    expect(siteSignature("nobody").id).toBe("digita");
  });
});
