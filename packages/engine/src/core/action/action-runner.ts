import type { ActionDefinition, EntityDefinition } from "@digitaplatform/shared";
import type { BaseDocument } from "../document/base-document.js";
import type { ResponseContext } from "../api/response-context.js";
import type { UserContext } from "../permissions/types.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import { evaluateExpression } from "../expression/expression-evaluator.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("action-runner");

export class ActionRunner {
  constructor(private permissionChecker: PermissionChecker) {}

  /**
   * Get available actions for a document based on current state and user permissions.
   */
  async getAvailableActions(
    entity: EntityDefinition,
    doc: BaseDocument,
    user: UserContext,
  ): Promise<ActionDefinition[]> {
    if (!entity.actions) return [];

    const available: ActionDefinition[] = [];

    for (const action of entity.actions) {
      // Check show_if
      if (action.show_if) {
        const show = evaluateExpression(action.show_if, {
          doc: doc._data,
          user: user as Record<string, unknown>,
        });
        if (!show) continue;
      }

      // Check permission
      if (action.requires_permission) {
        const result = await this.permissionChecker.hasPermission(
          user,
          entity.name,
          action.requires_permission,
          doc._data,
        );
        if (!result.allowed) continue;
      }

      available.push(action);
    }

    return available;
  }
}
