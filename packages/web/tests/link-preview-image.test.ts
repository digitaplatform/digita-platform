// A shared link of any page shows a picture: the page's own image where it names one, else the
// image the renderer draws for it, which the metadata names and the route answers.
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import type { WebPage, WebSite } from "../src/lib/types";
import { setSiteEnv } from "./site-env";

const PAGES: WebPage[] = [
  { _id: "example::de::how-it-works", slug: "how-it-works", locale: "de", title: "So funktioniert es", status: "published" } as WebPage,
  { _id: "example::en::", slug: "", locale: "en", title: "One file. A whole app.", status: "published" } as WebPage,
];

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/engine-client", () => ({
  listPages: async () => PAGES,
  // The engine's public read answers published rows only.
  getPage: async (locale: string, slug: string) => PAGES.find((p) => p.locale === locale && p.slug === slug) ?? null,
  getSite: async () => ({ site_name: "digitaplatform.com", theme: "digita" }),
  findWebsiteSignature: async () => undefined,
}));

setSiteEnv();
const { buildPageMetadata } = await import("../src/lib/seo");
const { GET } = await import("../src/app/api/og/route");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function imageOf(metadata: Awaited<ReturnType<typeof buildPageMetadata>>): string {
  const images = metadata.openGraph?.images as { url: string }[];
  return images[0]!.url;
}

describe("the link preview image of a page", () => {
  it("PLANTED DEFECT: names a drawn image for a page without its own, and its address answers a PNG", async () => {
    for (const page of PAGES) {
      const metadata = await buildPageMetadata(page, null);
      const url = imageOf(metadata);
      expect(url.startsWith("https://example.org/api/og?")).toBe(true);
      expect((metadata.twitter as { card: string }).card).toBe("summary_large_image");
      const res = await GET(new NextRequest(url));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 8)]).toEqual(PNG);
    }
  });

  it("PLANTED INNOCENT: keeps the image a page or its site names", async () => {
    const page = { ...PAGES[0]!, og_image: "https://cdn.example.org/how.png" } as WebPage;
    expect(imageOf(await buildPageMetadata(page, null))).toBe("https://cdn.example.org/how.png");
    const site = { site_name: "digitaplatform.com", default_og_image: "https://cdn.example.org/site.png" } as WebSite;
    expect(imageOf(await buildPageMetadata(PAGES[1]!, site))).toBe("https://cdn.example.org/site.png");
  });

  it("draws no image for a page the engine does not publish, or a locale the site does not serve", async () => {
    expect((await GET(new NextRequest("https://example.org/api/og?locale=de&slug=draft"))).status).toBe(404);
    expect((await GET(new NextRequest("https://example.org/api/og?locale=xx&slug="))).status).toBe(404);
  });
});
