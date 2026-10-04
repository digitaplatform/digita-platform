import { describe, expect, it, vi } from "vitest";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

vi.mock("../src/core/config/env.js", () => ({ env: { TRANSLATION_FALLBACK_LOCALE: "en" } }));
vi.mock("../src/core/logging/logger.js", () => ({ createLogger: () => ({ info: vi.fn() }) }));

import { TranslationService } from "../src/core/i18n/translation-service.js";

describe("regional data translations", () => {
  it("applies exact, base and live configured fallback per field with one bounded read", async () => {
    let fallback = "de";
    const rows = [
      { locale: "es-MX", document_name: "A", fieldname: "exact", value: "México" },
      { locale: "es", document_name: "A", fieldname: "exact", value: "España" },
      { locale: "es", document_name: "A", fieldname: "base", value: "Español" },
      { locale: "de", document_name: "A", fieldname: "last", value: "Deutsch" },
    ];
    const find = vi.fn(async (_collection: string, options: { filters: { locale: { $in: string[] } }[] }) => rows.filter((row) => options.filters[0]!.locale.$in.includes(row.locale)));
    const service = new TranslationService({ find } as unknown as MongoDBService, () => fallback);
    const expected = { exact: "México", base: "Español", last: "Deutsch" };
    expect(await service.resolveDocumentTranslations("Product", "A", ["exact", "base", "last"], "es-MX")).toEqual(expected);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]![1].filters[0]!).toMatchObject({ namespace: "data", entity: "Product", document_name: "A", locale: { $in: ["es-MX", "es", "de"] } });
    expect((await service.resolveListTranslations("Product", ["A"], ["exact", "base", "last"], "es-MX")).get("A")).toEqual(expected);
    expect(find).toHaveBeenCalledTimes(2);
    fallback = "es-MX";
    expect(await service.resolveDocumentTranslations("Product", "A", ["exact"], "es-MX")).toMatchObject({ exact: "México" });
    expect(await service.resolveDocumentTranslations("Product", "A", ["exact", "base", "last"], "es")).toEqual({ exact: "España", base: "Español" });
  });
});
