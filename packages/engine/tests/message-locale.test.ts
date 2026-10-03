import { describe, expect, it, vi } from "vitest";

vi.mock("@digitaplatform/shared/i18n-node", () => ({
  readBundle: () => ({ en: { saved: "Saved" }, de: { saved: "Gespeichert" }, es: { saved: "Guardado" }, "es-MX": { saved: "Guardado en México" } }),
}));
vi.mock("../src/core/config/env.js", () => ({ env: { TRANSLATIONS_DIR: "unused", TRANSLATION_FALLBACK_LOCALE: "en" } }));
vi.mock("../src/core/logging/logger.js", () => ({ createLogger: () => ({ info: vi.fn() }) }));

import { engineI18n, loadEngineI18n, messageLocale } from "../src/i18n.js";

describe("engine response message language", () => {
  it("keeps the canonical Mexican profile language ahead of the request header", () => {
    loadEngineI18n();
    const locale = messageLocale("ES-mx", "en");
    expect(locale).toBe("es-MX");
    expect(engineI18n().t("saved", undefined, locale)).toBe("Guardado en México");
  });

  it("preserves base Spanish and the header fallback for unsupported profile languages", () => {
    loadEngineI18n();
    expect(messageLocale("es", "en")).toBe("es");
    expect(messageLocale("es-ES", "de")).toBe("de");
    expect(messageLocale("ja", "es-MX")).toBe("es-MX");
  });
});
