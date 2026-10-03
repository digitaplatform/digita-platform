import type { BaseDocument } from "../../core/document/base-document.js";
import { ValidationFailedError } from "../../core/document/document-service.js";
import { validateViewContent } from "../../core/view/view-validator.js";

/**
 * View — before_insert / before_save: refuse a view the load of a View file would skip, such as a
 * list section without a limit or a pipeline with a stage that reads past the field mask. Stored,
 * it would not be served.
 */
export async function beforeSave(doc: BaseDocument): Promise<void> {
  // The id comes later, from the naming; the save refuses a View row without one there.
  const errors = validateViewContent(doc._data);
  if (errors.length === 0) return;
  throw new ValidationFailedError("View", [
    { field: "sections", code: "view_invalid", params: { error: errors.map((e) => e.message).join("; ") } },
  ]);
}
