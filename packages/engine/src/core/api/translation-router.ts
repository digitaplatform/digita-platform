import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { TranslationService } from "../i18n/translation-service.js";
import { requireAdministrator } from "../auth/require-admin.js";
import { successResponse } from "./response-model.js";
import { ResponseContext } from "./response-context.js";

/**
 * Register translation management API endpoints.
 */
export function registerTranslationRoutes(
  app: FastifyInstance,
  prefix: string,
  translationService: TranslationService,
): void {
  const base = `${prefix}/translations`;

  // Get all translations for a locale (with optional pagination)
  app.get(`${base}/:locale`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { locale } = request.params as { locale: string };
    const query = request.query as Record<string, string>;

    const filters: Record<string, unknown>[] = [{ locale }];
    if (query["namespace"]) filters.push({ namespace: query["namespace"] });
    if (query["entity"]) filters.push({ entity: query["entity"] });
    if (query["document"]) filters.push({ document_name: query["document"] });

    const page = query["page"] ? Number(query["page"]) : undefined;
    const pageSize = query["page_size"] ? Number(query["page_size"]) : undefined;

    if (page && pageSize) {
      const total = await translationService.countTranslations(filters);
      const offset = (page - 1) * pageSize;
      const docs = await translationService.findTranslations(filters, pageSize, offset);
      const result: Record<string, string> = {};
      for (const doc of docs) {
        const d = doc as Record<string, unknown>;
        result[d["key"] as string] = d["value"] as string;
      }
      return reply.send(
        successResponse(result, [], {
          total,
          page,
          page_size: pageSize,
          total_pages: Math.ceil(total / pageSize),
        }),
      );
    }

    const docs = await translationService.findTranslations(filters);
    const result: Record<string, string> = {};
    for (const doc of docs) {
      const d = doc as Record<string, unknown>;
      result[d["key"] as string] = d["value"] as string;
    }

    return reply.send(successResponse(result));
  });

  // Set a single translation — P-SEC/R4: tenant-wide UI strings; Administrator only.
  app.put(`${base}/:locale/:key`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return;
    const { locale, key } = request.params as { locale: string; key: string };
    const { value } = request.body as { value: string };
    const user = request.user?.email ?? "system";

    await translationService.setTranslation({
      namespace: key.startsWith("entity.") || key.startsWith("field.") ? "entity" : "system",
      locale,
      key,
      value,
      user,
    });

    const ctx = new ResponseContext();
    ctx.success("translation_saved", { key, locale });
    return reply.send(successResponse({ key, locale, value }, ctx.getMessages()));
  });

  // Bulk set translations — P-SEC/R4: Administrator only.
  app.post(`${base}/bulk`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return;
    const { locale, translations } = request.body as {
      locale: string;
      translations: Record<string, string>;
    };
    const user = request.user?.email ?? "system";

    let count = 0;
    for (const [key, value] of Object.entries(translations)) {
      await translationService.setTranslation({
        namespace: key.startsWith("entity.") || key.startsWith("field.") ? "entity" : "system",
        locale,
        key,
        value,
        user,
      });
      count++;
    }

    const ctx = new ResponseContext();
    ctx.success("translations_bulk_saved", { count: String(count), locale });
    return reply.send(successResponse({ count, locale }, ctx.getMessages()));
  });

  // Set data-level translations for a document
  app.put(
    `${prefix}/resource/:entity/:name/translations`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdministrator(request, reply)) return; // P-SEC/R4
      const { entity, name } = request.params as { entity: string; name: string };
      const { locale, fields } = request.body as {
        locale: string;
        fields: Record<string, string>;
      };
      const user = request.user?.email ?? "system";

      for (const [fieldname, value] of Object.entries(fields)) {
        await translationService.setTranslation({
          namespace: "data",
          locale,
          key: `${entity}.${name}.${fieldname}`,
          value,
          user,
          entity,
          document_name: name,
          fieldname,
        });
      }

      const ctx = new ResponseContext();
      ctx.success("data_translations_saved", { entity, name, locale });
      return reply.send(
        successResponse(
          { entity, name, locale, fields_count: Object.keys(fields).length },
          ctx.getMessages(),
        ),
      );
    },
  );

  // Bulk set data-level translations across many documents/fields/locales in one
  // call. Used by an app's setup wizard to persist a chosen chart-of-accounts'
  // per-language names (account×locale) without a request per cell. Generic —
  // each item names its own entity/document/field/locale.
  app.post(`${prefix}/translations/data/bulk`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return; // P-SEC/R4
    const { items } = request.body as {
      items?: Array<{
        entity: string;
        document_name: string;
        fieldname: string;
        locale: string;
        value: string;
      }>;
    };
    const user = request.user?.email ?? "system";

    let count = 0;
    for (const it of items ?? []) {
      if (
        !it?.entity ||
        !it.document_name ||
        !it.fieldname ||
        !it.locale ||
        typeof it.value !== "string" ||
        !it.value.trim()
      ) {
        continue;
      }
      await translationService.setTranslation({
        namespace: "data",
        locale: it.locale,
        key: `${it.entity}.${it.document_name}.${it.fieldname}`,
        value: it.value,
        user,
        entity: it.entity,
        document_name: it.document_name,
        fieldname: it.fieldname,
      });
      count++;
    }

    const ctx = new ResponseContext();
    ctx.success("translations_bulk_saved", { count: String(count), locale: "data" });
    return reply.send(successResponse({ count }, ctx.getMessages()));
  });

  // Get data-level translations for a document. Returns all locales × all
  // translatable fields. Used by the FE TranslationsDialog so the editor
  // can pre-fill existing translations.
  app.get(
    `${prefix}/resource/:entity/:name/translations`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { entity, name } = request.params as { entity: string; name: string };
      const docs = await translationService.findDataTranslations(entity, name);
      // Reshape from rows into { [locale]: { [fieldname]: value } } for the FE.
      const grouped: Record<string, Record<string, string>> = {};
      for (const row of docs) {
        const r = row as Record<string, unknown>;
        const loc = r["locale"] as string;
        const fld = r["fieldname"] as string;
        const val = r["value"] as string;
        if (!loc || !fld) continue;
        if (!grouped[loc]) grouped[loc] = {};
        grouped[loc][fld] = val ?? "";
      }
      return reply.send(successResponse({ entity, name, translations: grouped }));
    },
  );

  // Get translation coverage
  app.get(`${base}/coverage`, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const locale = query["locale"];

    if (locale) {
      const coverage = await translationService.getCoverage(locale);
      return reply.send(successResponse(coverage));
    }

    // Get coverage for all locales (with optional pagination)
    const page = query["page"] ? Number(query["page"]) : undefined;
    const pageSize = query["page_size"] ? Number(query["page_size"]) : undefined;

    const languages = await translationService.findLanguages(
      [{ enabled: true }],
      ["_id", "native_name"],
    );

    const allResults = await Promise.all(
      (languages as Record<string, unknown>[]).map(async (lang) => {
        const coverage = await translationService.getCoverage(lang["_id"] as string);
        return {
          locale: lang["_id"],
          name: lang["native_name"],
          ...coverage,
        };
      }),
    );

    if (page && pageSize) {
      const total = allResults.length;
      const offset = (page - 1) * pageSize;
      const paged = allResults.slice(offset, offset + pageSize);
      return reply.send(
        successResponse(paged, [], {
          total,
          page,
          page_size: pageSize,
          total_pages: Math.ceil(total / pageSize),
        }),
      );
    }

    return reply.send(successResponse(allResults));
  });

  // Re-seed from files — P-SEC/R4: destructive tenant-wide reseed; Administrator only.
  app.post(`${base}/seed`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return;
    const result = await translationService.seedFromFiles(
      (await import("../config/env.js")).env.LOCALES_DIR,
    );
    const ctx = new ResponseContext();
    ctx.success("translations_seeded", {
      inserted: String(result.inserted),
      skipped: String(result.skipped),
    });
    return reply.send(successResponse(result, ctx.getMessages()));
  });

  // Reset an overridden translation
  app.delete(
    `${base}/:locale/:key/override`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdministrator(request, reply)) return; // P-SEC/R4
      const { locale, key } = request.params as { locale: string; key: string };
      const namespace = key.startsWith("entity.") || key.startsWith("field.") ? "entity" : "system";
      const docId = `${namespace}:${locale}:${key}`;

      await translationService.resetOverride(docId);
      return reply.send(successResponse({ key, locale, reset: true }));
    },
  );
}
