// A site names its signature in `theme`; simetrix.ch wears the simetrix mark and the Veloluck site
// one of Veloluck's three looks, not the family's.
import { describe, it, expect, vi } from "vitest";
import { siteSignature } from "../src/lib/identity";

describe("siteSignature", () => {
  it("PLANTED DEFECT: a site with theme simetrix is drawn in the simetrix signature, not in digita", () => {
    const signature = siteSignature("simetrix");
    // While the package was not bundled, this fell back to digita; that goes red here.
    expect(signature.id).toBe("simetrix");
    expect(signature.wordmark).toContain("simetri");
    expect(signature.monogram).not.toBe(siteSignature("digita").monogram);
  });

  it.each(["veloluck-workbench", "veloluck-lakeside", "veloluck-precise"])(
    "PLANTED DEFECT: a site with theme %s is drawn in that Veloluck signature, not in digita",
    (id) => {
      const signature = siteSignature(id);
      expect(signature.id).toBe(id);
      expect(signature.monogram).not.toBe(siteSignature("digita").monogram);
    },
  );

  it("PLANTED INNOCENT: the digita family and an unknown id keep the default", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(siteSignature("digita").id).toBe("digita");
    expect(siteSignature(undefined).id).toBe("digita");
    expect(siteSignature("nobody").id).toBe("digita");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('"nobody"'));
    logged.mockRestore();
  });
});
