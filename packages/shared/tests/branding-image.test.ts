import { describe, it, expect } from "vitest";
import { INLINE_IMAGE_MAX_LENGTH, brandingImageKind } from "../src/branding-image.js";

// A tenant's branding image loads only from the app's own paths or inline, so no stored value makes
// every visitor's page request another host.

describe("brandingImageKind", () => {
  it("takes a path of the app's own and an inline base64 image", () => {
    expect(brandingImageKind("/api/v1/public/file/FILE-000001")).toBe("path");
    expect(brandingImageKind("/api/v1/public/file/FILE-1?v=2")).toBe("path");
    expect(brandingImageKind("/files/logo..v2.png")).toBe("path");
    expect(brandingImageKind("data:image/png;base64,iVBORw0KGgo=")).toBe("inline");
    expect(brandingImageKind("data:image/svg+xml;base64,PHN2Zy8+")).toBe("inline");
  });

  it("PLANTED DEFECT: refuses another host and a path that could end the address a page writes it in", () => {
    for (const value of [
      "https://cdn.example.test/logo.svg",
      "http://cdn.example.test/bg.jpg",
      "//cdn.example.test/logo.svg",
      "api/v1/public/file/FILE-1",
      '/x"),url("https://evil.example/t.png',
      "/x'),url('https://evil.example/t.png",
      "/x)",
      "/x\\..\\evil",
      "/x\nurl(https://evil.example/t.png)",
      "/x y",
      "/../crm/api/v1/public/file/F-1",
      "/a/%2E%2e/b",
      "/a/..?v=1",
      "/%2e%2e%2fcrm/api/v1/public/file/F-1",
      "/a/..%2F..%2fcrm",
      "/%2E%2E%5Ccrm",
      '/x"y',
      "/x'y",
    ]) {
      expect(brandingImageKind(value), value).toBeNull();
    }
  });

  it("PLANTED DEFECT: refuses other inline data, inline data after an outside address, and an image past its bound", () => {
    const head = "data:image/png;base64,";
    const atBound = `${head}${"A".repeat(INLINE_IMAGE_MAX_LENGTH - head.length)}`;
    expect(brandingImageKind(atBound)).toBe("inline");
    for (const value of [
      `${atBound}AAAA`,
      "data:image/svg+xml,<svg onload='alert(1)'/>",
      "data:text/html;base64,PHNjcmlwdD4=",
      'data:image/png;base64,AAAA"),url("https://evil.example/t.png',
      "https://evil.example/x?data:image/png;base64,AAAA",
      "data:image/png;base64,AAAA\n",
    ]) {
      expect(brandingImageKind(value), value.slice(0, 60)).toBeNull();
    }
  });
});
