import type { ClientSession } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { createLogger } from "./logger.js";

const log = createLogger("activity-log");

export type ActivityAction =
  | "Created"
  | "Updated"
  | "Submitted"
  | "Cancelled"
  | "Deleted"
  | "Amended"
  | "Shared"
  | "Login"
  | "Logout"
  | "Password Changed"
  | "Import"
  | "Export";

export interface ActivityLogEntry {
  _id: string;
  entity: string;
  document_name: string;
  action: ActivityAction;
  user: string;
  /** Denormalized display name of the actor at write time (from JWT claims). */
  user_name?: string;
  ip_address?: string;
  details?: Record<string, unknown>;
  summary?: string;
  creation: Date;
}

export class ActivityLogService {
  constructor(private db: MongoDBService) {}

  /**
   * Append a log entry. Pass `session` to enlist the write into the
   * caller's transaction so the log is rolled back if the parent
   * operation fails (the audit trail then matches what actually
   * persisted, with no false-positive entries for failed writes).
   *
   * For session-less callers (login/logout/import/export), errors are
   * still swallowed locally so a logging hiccup doesn't break the
   * unrelated business action.
   */
  async log(
    params: {
      entity: string;
      document_name: string;
      action: ActivityAction;
      user: string;
      /** Actor display name from the UserContext claims (fallback: email). */
      user_name?: string;
      details?: Record<string, unknown>;
      ip_address?: string;
      summary?: string;
    },
    session?: ClientSession,
  ): Promise<void> {
    try {
      await this.db.insertOne(
        DIGITA.COLLECTIONS.LOG,
        {
          _id: `${params.entity}:${params.document_name}:${params.action}:${Date.now()}`,
          doctype: DIGITA.COLLECTIONS.LOG,
          docstatus: 0,
          entity: params.entity,
          document_name: params.document_name,
          action: params.action,
          user: params.user,
          user_name: params.user_name ?? params.user,
          ip_address: params.ip_address,
          details: params.details,
          summary: params.summary ?? `${params.action} ${params.entity} ${params.document_name}`,
          owner: params.user,
          modified_by: params.user,
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.LOGS,
        session,
      );
    } catch (err) {
      // Inside a transaction we MUST re-throw so the caller can roll
      // back the parent write — silently swallowing here would leave a
      // committed doc with no audit trail. Outside a transaction, keep
      // the existing best-effort semantics so a logging hiccup doesn't
      // break login/logout flows.
      log.error({ err, ...params }, "Failed to write activity log");
      if (session) throw err;
    }
  }

  async getLog(
    entity: string,
    documentName: string,
    limit: number = 50,
  ): Promise<ActivityLogEntry[]> {
    const docs = await this.db.find(
      DIGITA.COLLECTIONS.LOG,
      {
        filters: [{ entity, document_name: documentName }],
        order_by: "creation desc",
        limit,
      },
      DIGITA.DATABASES.LOGS,
    );
    return docs as unknown as ActivityLogEntry[];
  }

  async getUserActivity(user: string, limit: number = 50): Promise<ActivityLogEntry[]> {
    const docs = await this.db.find(
      DIGITA.COLLECTIONS.LOG,
      {
        filters: [{ user }],
        order_by: "creation desc",
        limit,
      },
      DIGITA.DATABASES.LOGS,
    );
    return docs as unknown as ActivityLogEntry[];
  }

  async query(
    filters: Record<string, unknown>,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: ActivityLogEntry[]; total: number }> {
    const [data, total] = await Promise.all([
      this.db.find(
      DIGITA.COLLECTIONS.LOG,
        {
          filters: Object.keys(filters).length > 0 ? [filters] : [],
          order_by: "creation desc",
          limit,
          offset,
        },
        DIGITA.DATABASES.LOGS,
      ),
      this.db.count(DIGITA.COLLECTIONS.LOG, Object.keys(filters).length > 0 ? [filters] : [], DIGITA.DATABASES.LOGS),
    ]);
    return { data: data as unknown as ActivityLogEntry[], total };
  }
}
