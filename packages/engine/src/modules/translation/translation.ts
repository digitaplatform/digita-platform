import type { BaseDocument } from "../../core/document/base-document.js";
import type { ResponseContext } from "../../core/api/response-context.js";
import type { HookServices } from "../../core/hooks/hook-runner.js";
import { translationOverrideFields } from "../../core/i18n/translation-service.js";

export function beforeSave(doc: BaseDocument, _ctx?: ResponseContext, services?: HookServices): void {
  if (!doc.hasChanged("value")) return;
  if (!services?.user) throw new Error("Translation save requires the acting user");
  doc.merge(translationOverrideFields(doc._original, services.user.email));
}
