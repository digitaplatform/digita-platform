import type { LinkSection } from "@digitaplatform/shared";
import type { DocumentService } from "../../document/document-service.js";
import type { UserContext } from "../../permissions/types.js";
import type { ResponseContext } from "../../api/response-context.js";
import { resolveString, type ResolverContext } from "../param-resolver.js";

export interface LinkRunnerDeps {
  documentService: DocumentService;
}

/**
 * Resolve a 1:1 link. The `target` token resolves to a document _id; the
 * runner then loads it via `DocumentService.getDoc` (full permission/field-mask
 * pipeline applies). Returns null when the target is unresolved or the doc
 * is missing — caller decides whether that's a warning.
 */
export async function runLinkSection(
  section: LinkSection,
  rctx: ResolverContext,
  user: UserContext,
  ctx: ResponseContext,
  deps: LinkRunnerDeps,
): Promise<Record<string, unknown> | null> {
  const targetValue = resolveString(section.target, rctx);
  if (typeof targetValue !== "string" || !targetValue) return null;

  const doc = await deps.documentService.getDoc(section.entity, targetValue, user, ctx);
  const data = doc.toJSON() as Record<string, unknown>;
  if (section.fields?.length) {
    const projected: Record<string, unknown> = {};
    for (const f of section.fields) {
      if (f in data) projected[f] = data[f];
    }
    return projected;
  }
  return data;
}
