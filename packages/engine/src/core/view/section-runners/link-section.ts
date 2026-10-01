import type { LinkSection } from "@digitaplatform/shared";
import type { DocumentService } from "../../document/document-service.js";
import type { PermissionChecker } from "../../permissions/permission-checker.js";
import type { UserContext } from "../../permissions/types.js";
import type { ResponseContext } from "../../api/response-context.js";
import { resolveString, type ResolverContext } from "../param-resolver.js";

export interface LinkRunnerDeps {
  documentService: DocumentService;
  permissionChecker: PermissionChecker;
}

/**
 * Resolve a 1:1 link. The `target` token resolves to a document _id; the
 * runner then loads it via `DocumentService.getDoc` (full permission/field-mask
 * pipeline applies). Returns null when the target is unresolved, once the caller
 * is shown to read the entity, so a caller who may not is refused whether or not
 * the request named a target; a missing doc fails the section as not found.
 */
export async function runLinkSection(
  section: LinkSection,
  rctx: ResolverContext,
  user: UserContext,
  ctx: ResponseContext,
  deps: LinkRunnerDeps,
): Promise<Record<string, unknown> | null> {
  const targetValue = resolveString(section.target, rctx);
  if (typeof targetValue !== "string" || !targetValue) {
    await deps.permissionChecker.check(user, section.entity, "read");
    return null;
  }

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
