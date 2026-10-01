// An engine that cannot answer is an outage, not an empty site: the log says why, the pages and the
// sitemap answer a server error, and only a site the engine really holds no page of answers 404.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/components/PageView", () => ({ PageView: () => "the page" }));
const { NotFound } = vi.hoisted(() => ({ NotFound: class NotFound extends Error {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("not found");
  },
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de",
  DEFAULT_LOCALE: "en",
});

const { default: HomePage, generateMetadata } = await import("../src/app/[locale]/page");
const { default: ContentPage } = await import("../src/app/[locale]/[...slug]/page");
const { default: sitemap } = await import("../src/app/sitemap");

/** The status Next answers for a page or route: what returns is 200, notFound() is 404 and any
 *  other error is 500. */
async function statusOf(render: () => Promise<unknown>): Promise<number> {
  try {
    await render();
    return 200;
  } catch (err) {
    return err instanceof NotFound ? 404 : 500;
  }
}

const home = () => HomePage({ params: Promise.resolve({ locale: "en" }) });
const about = () => ContentPage({ params: Promise.resolve({ locale: "en", slug: ["about"] }) });
const homeMetadata = () => generateMetadata({ params: Promise.resolve({ locale: "en" }) });

const networkError = new TypeError("fetch failed");
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an engine that answers HTTP 500", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false }, { status: 500 })));
  });

  it("PLANTED DEFECT: answers every page with a server error, not the not-found page, and logs the status", async () => {
    expect(await statusOf(home)).toBe(500);
    expect(await statusOf(about)).toBe(500);
    expect(await statusOf(homeMetadata)).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/WebPage read answered HTTP 500/));
  });

  it("PLANTED DEFECT: answers the sitemap with an error, not an empty list, and logs the status", async () => {
    expect(await statusOf(sitemap)).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/WebPage read answered HTTP 500/));
  });
});

describe("an engine that cannot be reached", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw networkError;
    }));
  });

  it("PLANTED DEFECT: answers every page with a server error and logs the error itself", async () => {
    expect(await statusOf(home)).toBe(500);
    expect(await statusOf(about)).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/WebPage read could not reach the engine/), networkError);
  });

  it("PLANTED DEFECT: answers the sitemap with an error and logs the error itself", async () => {
    expect(await statusOf(sitemap)).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/WebPage read could not reach the engine/), networkError);
  });
});

describe("an engine answer that is no list", () => {
  it("PLANTED DEFECT: is a failed read, not an empty site, for a page and for the sitemap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true })));
    expect(await statusOf(home)).toBe(500);
    expect(await statusOf(sitemap)).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/WebPage read answered no list/));

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 200 })));
    expect(await statusOf(sitemap)).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/WebPage read answered a body that is no JSON/), expect.any(SyntaxError));
  });
});

describe("a list the engine fails after its first page", () => {
  it("PLANTED DEFECT: answers the sitemap with an error, not with the pages read so far", async () => {
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++requests === 1
          ? Response.json({ data: [{ _id: "example::en::", slug: "", locale: "en" }], meta: { total_pages: 2 } })
          : Response.json({ success: false }, { status: 503 }),
      ),
    );
    expect(await statusOf(sitemap)).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/WebPage read answered HTTP 503/));
  });
});

describe("a site the engine really holds no page of", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [], meta: { total_pages: 0 } })));
  });

  it("PLANTED INNOCENT: still answers a page with 404, and logs nothing", async () => {
    expect(await statusOf(home)).toBe(404);
    expect(await statusOf(about)).toBe(404);
    expect(await homeMetadata()).toEqual({});
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("PLANTED INNOCENT: still answers the sitemap with an empty list, and logs nothing", async () => {
    expect(await sitemap()).toEqual([]);
    expect(errorLog).not.toHaveBeenCalled();
  });
});
