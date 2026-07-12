import { DIGITA } from "@digitaplatform/shared";
import type { BaseDocument } from "../../core/document/base-document.js";
import type { ResponseContext } from "../../core/api/response-context.js";
import type { HookServices } from "../../core/hooks/hook-runner.js";

/**
 * DocShare — before_insert / before_save hook (ADR-12 P3).
 *
 * The engine no longer defines a User entity; `shared_with` / `shared_by`
 * are plain identity refs (the user id IS the email, keyed by digita-auth).
 * Display names are denormalized at write time:
 *
 *   shared_by / shared_by_name  — stamped once from the acting user's JWT
 *                                 claims (no DB lookup needed).
 *   shared_with_name            — resolved via a READ-ONLY findOne against
 *                                 the identity store's User collection
 *                                 (digita-auth owns it; the engine may read
 *                                 identity, never write). Falls back to the
 *                                 email itself when the user is not found.
 */
export async function beforeSave(
  doc: BaseDocument,
  _ctx?: ResponseContext,
  services?: HookServices,
): Promise<void> {
  const actor = services?.user;

  // Stamp the sharer once, at creation time (read_only fields are stripped
  // from client input, so this hook is the only writer).
  if (!doc.get("shared_by") && actor) {
    doc.set("shared_by", actor.email);
    doc.set("shared_by_name", actor.full_name ?? actor.email);
  }

  const sharedWith = doc.get("shared_with") as string | undefined;
  if (!sharedWith) return; // required-field validation rejects this case

  if (!doc.get("shared_with_name") || doc.hasChanged("shared_with")) {
    let displayName = sharedWith;
    if (services?.db) {
      // digita-auth keys users by lowercased email — normalize for lookup only.
      const row = await services.db.findOne(
        DIGITA.COLLECTIONS.USER,
        sharedWith.trim().toLowerCase(),
        DIGITA.DATABASES.IDENTITY,
        services.session,
      );
      const fullName = (row as { full_name?: string } | null)?.full_name;
      if (fullName) displayName = fullName;
    }
    doc.set("shared_with_name", displayName);
  }
}
