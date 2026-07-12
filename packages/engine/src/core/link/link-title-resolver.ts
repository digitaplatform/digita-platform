import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { TranslationService } from "../i18n/translation-service.js";

/**
 * Resolve display titles for all Link fields in a document.
 * Returns a map of { fieldname: displayValue }.
 *
 * When a `locale` is given and the target entity's display field is
 * `translatable`, the title is replaced with its per-document data translation
 * (falling back to the stored value) — so a SELECTED link (e.g. the chosen
 * account in a form) shows in the viewer's language, matching the list/dropdown.
 */
export class LinkTitleResolver {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
    private translationService: TranslationService,
  ) {}

  /** Whether the target entity's display field carries data translations. */
  private isTranslatableTitle(target: string, displayField: string): boolean {
    return displayField !== "_id" && this.registry.getTranslatableFields(target).includes(displayField);
  }

  async resolve(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    locale?: string,
  ): Promise<Record<string, string>> {
    const titles: Record<string, string> = {};

    const promises: Array<Promise<void>> = [];

    for (const field of entity.fields) {
      if (field.fieldtype !== "Link" || !field.target) continue;

      const value = data[field.fieldname];
      if (!value) continue;

      const targetEntity = this.registry.get(field.target);
      const displayField = field.target_display ?? targetEntity.title_field ?? "_id";
      const targetDb = targetEntity.database;
      const target = field.target;
      const translate = !!locale && this.isTranslatableTitle(target, displayField);

      promises.push(
        (async () => {
          const doc = await this.db.findOne(target, String(value), targetDb);
          if (!doc) return;
          let title = String((doc as Record<string, unknown>)[displayField] ?? value);
          if (translate) {
            const tr = await this.translationService.resolveDocumentTranslations(
              target,
              String(value),
              [displayField],
              locale!,
            );
            if (tr[displayField]) title = tr[displayField];
          }
          titles[field.fieldname] = title;
        })(),
      );
    }

    await Promise.all(promises);

    return titles;
  }

  /**
   * Resolve link titles for a list of documents (batch).
   * Groups by target entity for efficient querying.
   */
  async resolveForList(
    entity: EntityDefinition,
    docs: Record<string, unknown>[],
    locale?: string,
  ): Promise<Map<string, Record<string, string>>> {
    const result = new Map<string, Record<string, string>>();

    // Collect all link values grouped by target
    const linkGroups: Map<
      string,
      {
        field: string;
        displayField: string;
        ids: Set<string>;
      }
    > = new Map();

    for (const field of entity.fields) {
      if (field.fieldtype !== "Link" || !field.target) continue;

      const targetEntity = this.registry.get(field.target);
      const displayField = field.target_display ?? targetEntity.title_field ?? "_id";

      const key = `${field.target}:${displayField}`;
      if (!linkGroups.has(key)) {
        linkGroups.set(key, {
          field: field.fieldname,
          displayField,
          ids: new Set(),
        });
      }

      const group = linkGroups.get(key)!;
      for (const doc of docs) {
        const value = doc[field.fieldname];
        if (value) group.ids.add(String(value));
      }
    }

    // Batch fetch all linked documents
    const titleCache: Map<string, Map<string, string>> = new Map();

    for (const [key, group] of linkGroups) {
      const [target] = key.split(":");
      if (!target || group.ids.size === 0) continue;

      const targetDb = this.registry.get(target).database;
      const ids = Array.from(group.ids);
      const linkedDocs = await this.db.find(
        target,
        {
          filters: [{ _id: { $in: ids } } as Record<string, unknown>],
          fields: ["_id", group.displayField],
        },
        targetDb,
      );

      const cache = new Map<string, string>();
      for (const linked of linkedDocs) {
        const linkedData = linked as Record<string, unknown>;
        cache.set(
          String(linkedData["_id"]),
          String(linkedData[group.displayField] ?? linkedData["_id"]),
        );
      }

      // Overlay per-document data translations for the (translatable) title field.
      if (locale && this.isTranslatableTitle(target, group.displayField)) {
        const trMap = await this.translationService.resolveListTranslations(
          target,
          ids,
          [group.displayField],
          locale,
        );
        for (const [id, fields] of trMap) {
          const v = fields[group.displayField];
          if (v) cache.set(id, v);
        }
      }

      titleCache.set(key, cache);
    }

    // Map titles to each document
    for (const doc of docs) {
      const docId = String(doc["_id"]);
      const titles: Record<string, string> = {};

      for (const field of entity.fields) {
        if (field.fieldtype !== "Link" || !field.target) continue;

        const value = doc[field.fieldname];
        if (!value) continue;

        const targetEntity = this.registry.get(field.target);
        const displayField = field.target_display ?? targetEntity.title_field ?? "_id";
        const key = `${field.target}:${displayField}`;

        const cache = titleCache.get(key);
        if (cache) {
          const title = cache.get(String(value));
          if (title) titles[field.fieldname] = title;
        }
      }

      if (Object.keys(titles).length > 0) {
        result.set(docId, titles);
      }
    }

    return result;
  }
}
