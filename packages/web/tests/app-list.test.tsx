// The app list draws one card per app of the tenant, from the list the header links, so an app the
// tenant adds appears with no change to the site; each card enters its app, and on a demo tenant
// also through the IdP's one-click entry. A tenant without apps gets the empty line.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { setSiteEnv } from "./site-env";

vi.mock("server-only", () => ({}));

/** The show site's texts for its apps, as a German page of its seed carries them. */
const props = {
  heading: "Die Demos",
  apps: [
    { app: "workshop", title: "Veloluck Werkstatt", description: "Eine Velowerkstatt vom Auftrag bis zur Rechnung." },
    { app: "erp", title: "Eine App, die der Mandant nicht betreibt" },
  ],
};

/** Renders the block under the tenant settings given, read fresh as a new pod reads them. */
async function render(env: Record<string, string | undefined>, blockProps: Record<string, unknown> = props, locale = "de") {
  setSiteEnv();
  for (const key of ["TENANT_APPS", "AUTH_URL", "DEMO_TENANT"]) delete process.env[key];
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  vi.resetModules();
  const { getBlockComponent } = await import("../src/blocks/registry");
  const Block = getBlockComponent("app_list");
  if (!Block) throw new Error("app_list is not registered");
  return renderToStaticMarkup(<Block props={blockProps} locale={locale} />);
}

const cards = (html: string) => [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => match[1]!);

describe("the app_list block", () => {
  it("draws one card per app of a two-app tenant, in the tenant's order, each entering its app outside the page's locale", async () => {
    const html = await render({ TENANT_APPS: "workshop, events" });
    const [workshop, events] = cards(html);
    expect(cards(html)).toHaveLength(2);
    expect(workshop).toContain("Veloluck Werkstatt");
    expect(workshop).toContain("Eine Velowerkstatt vom Auftrag bis zur Rechnung.");
    expect(workshop).toContain('href="/workshop/"');
    // PLANTED DEFECT: an app the site's texts do not name yet still appears, under its own name,
    // so a new app needs no change to the seed; a list filtered by the texts goes red here.
    expect(events).toContain(">events<");
    expect(events).toContain('href="/events/"');
    // An app the texts name but the tenant does not run is not offered.
    expect(html).not.toContain("/erp/");
    expect(html).toContain(">Öffnen<");
  });

  it("shows the empty line on a site whose tenant links no apps", async () => {
    const html = await render({});
    expect(cards(html)).toHaveLength(0);
    expect(html).toContain("Die Demos");
    expect(html).toContain("Noch keine Apps.");
  });

  it("PLANTED DEFECT: offers the one-click demo entry on a demo tenant, and goes on to the app", async () => {
    const html = await render({ TENANT_APPS: "workshop", AUTH_URL: "https://show.example.org/auth/", DEMO_TENANT: "true" }, { ...props, demo_label: "Demo öffnen" });
    const [workshop] = cards(html);
    expect(workshop).toContain('href="https://show.example.org/auth/demo-login?redirect=%2Fworkshop%2F"');
    expect(workshop).toContain(">Demo öffnen<");
    expect(workshop).toContain('href="/workshop/"');
  });

  it("PLANTED INNOCENT: offers no demo entry on a tenant that is no demo, or without the IdP's address", async () => {
    for (const env of [
      { TENANT_APPS: "workshop", AUTH_URL: "https://show.example.org/auth" },
      { TENANT_APPS: "workshop", AUTH_URL: "https://show.example.org/auth", DEMO_TENANT: "false" },
      { TENANT_APPS: "workshop", DEMO_TENANT: "true" },
    ]) {
      const html = await render(env);
      expect(html, JSON.stringify(env)).not.toContain("demo-login");
      expect(html, JSON.stringify(env)).toContain('href="/workshop/"');
    }
  });

  it("takes the site's own texts in the page's language where the block names no labels", async () => {
    const html = await render({ TENANT_APPS: "workshop", AUTH_URL: "https://show.example.org/auth", DEMO_TENANT: "1" }, {}, "en");
    expect(html).toContain(">workshop<");
    expect(html).toContain(">Enter the demo<");
    expect(html).toContain(">Open<");
  });
});
