import type { MongoDBService } from "../database/mongodb-service.js";

import { DIGITA } from "@digitaplatform/shared";
export class ViewLogService {
  constructor(private db: MongoDBService) {}

  async logView(entity: string, documentName: string, user: string): Promise<void> {
    await this.db.insertOne(
      "_view_logs",
      {
        _id: `${entity}:${documentName}:${user}:${Date.now()}`,
        entity,
        document_name: documentName,
        viewed_by: user,
        timestamp: new Date(),
      },
      DIGITA.DATABASES.LOGS,
    );
  }

  async getViewLog(
    entity: string,
    documentName: string,
    limit: number = 20,
  ): Promise<Array<{ viewed_by: string; timestamp: Date }>> {
    const docs = await this.db.find(
      "_view_logs",
      {
        filters: [{ entity, document_name: documentName }],
        order_by: "timestamp desc",
        limit,
      },
      DIGITA.DATABASES.LOGS,
    );
    return docs as unknown as Array<{ viewed_by: string; timestamp: Date }>;
  }
}
