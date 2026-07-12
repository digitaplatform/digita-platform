import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("document-share-service");

export interface DocumentShare {
  _id?: string;
  entity: string;
  document_name: string;
  shared_with: string;
  shared_by: string;
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  expires_at?: Date;
  notify: boolean;
  creation?: Date;
}

export class DocumentShareService {
  constructor(private db: MongoDBService) {}

  async share(share: DocumentShare): Promise<void> {
    const _id = `${share.entity}:${share.document_name}:${share.shared_with}`;

    const existing = await this.db.findOne(DIGITA.COLLECTIONS.DOC_SHARE, _id, DIGITA.DATABASES.IDENTITY);

    if (existing) {
      await this.db.updateOne(
        DIGITA.COLLECTIONS.DOC_SHARE,
        _id,
        {
          can_read: share.can_read,
          can_write: share.can_write,
          can_share: share.can_share,
          expires_at: share.expires_at,
          modified: new Date(),
        },
        DIGITA.DATABASES.IDENTITY,
      );
    } else {
      await this.db.insertOne(
        DIGITA.COLLECTIONS.DOC_SHARE,
        {
          _id,
          ...share,
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.IDENTITY,
      );
    }

    log.info(
      {
        entity: share.entity,
        document: share.document_name,
        shared_with: share.shared_with,
      },
      "Document shared",
    );
  }

  async unshare(entity: string, documentName: string, sharedWith: string): Promise<void> {
    const _id = `${entity}:${documentName}:${sharedWith}`;
    await this.db.deleteOne(DIGITA.COLLECTIONS.DOC_SHARE, _id, DIGITA.DATABASES.IDENTITY);
  }

  async getShares(entity: string, documentName: string): Promise<DocumentShare[]> {
    const docs = await this.db.find(
      DIGITA.COLLECTIONS.DOC_SHARE,
      {
        filters: [{ entity, document_name: documentName }],
      },
      DIGITA.DATABASES.IDENTITY,
    );
    return docs as unknown as DocumentShare[];
  }

  async hasShare(
    entity: string,
    documentName: string,
    userEmail: string,
    action: "read" | "write",
  ): Promise<boolean> {
    const _id = `${entity}:${documentName}:${userEmail}`;
    const share = await this.db.findOne(DIGITA.COLLECTIONS.DOC_SHARE, _id, DIGITA.DATABASES.IDENTITY);

    if (!share) return false;

    const shareData = share as unknown as DocumentShare;

    // Check expiry
    if (shareData.expires_at && new Date(shareData.expires_at) < new Date()) {
      return false;
    }

    if (action === "read") return shareData.can_read;
    if (action === "write") return shareData.can_write;
    return false;
  }

  /**
   * IDs of all documents of `entity` shared with `userEmail` for `action`
   * (excluding expired shares). Used to surface shared docs in list views.
   */
  async sharedDocumentIds(
    entity: string,
    userEmail: string,
    action: "read" | "write",
  ): Promise<string[]> {
    const shares = (await this.db.find(
      DIGITA.COLLECTIONS.DOC_SHARE,
      { filters: [{ entity, shared_with: userEmail }] },
      DIGITA.DATABASES.IDENTITY,
    )) as unknown as DocumentShare[];
    const now = new Date();
    return shares
      .filter((s) => (action === "read" ? s.can_read : s.can_write))
      .filter((s) => !s.expires_at || new Date(s.expires_at) > now)
      .map((s) => s.document_name);
  }
}
