import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import { ROW_ID_FIELD } from "@digitaplatform/shared";

/**
 * A Password field's value at rest: AES-256-GCM under the key `key_id` names.
 * The key id is stored with the value so a new active key encrypts new values
 * while every listed old key still reads what it encrypted.
 */
export interface EncryptedPassword {
  key_id: string;
  iv: string;
  tag: string;
  data: string;
}

/** The two settings of the key set, as the engine's env module carries them. */
export interface PasswordFieldKeySettings {
  /** `<id>=<base64 of 32 bytes>` pairs, comma separated. */
  PASSWORD_FIELD_KEYS: string;
  /** The id of the key that encrypts new values; one of the listed ids. */
  PASSWORD_FIELD_ACTIVE_KEY_ID: string;
}

interface PasswordKeySet {
  keys: Map<string, Buffer>;
  activeKeyId: string;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;

export function isEncryptedPassword(value: unknown): value is EncryptedPassword {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["key_id", "iv", "tag", "data"].every((k) => typeof v[k] === "string");
}

/** The Password fields an entity stores: its own and those of its Table rows, as `<field>` or `<table>.<field>`. */
export function passwordFieldPaths(entity: EntityDefinition): string[] {
  const paths: string[] = [];
  for (const field of entity.fields) {
    if (field.fieldtype === "Password") paths.push(field.fieldname);
    for (const child of childPasswordFields(field)) paths.push(`${field.fieldname}.${child.fieldname}`);
  }
  return paths;
}

export function childPasswordFields(field: FieldDefinition): FieldDefinition[] {
  return field.fieldtype === "Table" ? (field.child_fields ?? []).filter((f) => f.fieldtype === "Password") : [];
}

/**
 * The path of a Password value in `input` that is in the stored form but is not
 * the value `stored` holds at that path: a value the engine never encrypted, or
 * one moved from another record or field. A Password value is sent as text; the
 * stored form comes back only as read, as a Table row does on a whole-table save.
 */
export function foreignPasswordValue(
  entity: EntityDefinition,
  input: Record<string, unknown>,
  stored: Record<string, unknown> = {},
): string | undefined {
  const same = (value: unknown, storedValue: unknown): boolean =>
    isEncryptedPassword(storedValue) &&
    (["key_id", "iv", "tag", "data"] as const).every((k) => (value as EncryptedPassword)[k] === storedValue[k]);
  for (const field of entity.fields) {
    const value = input[field.fieldname];
    if (field.fieldtype === "Password" && isEncryptedPassword(value) && !same(value, stored[field.fieldname])) {
      return field.fieldname;
    }
    const secrets = childPasswordFields(field);
    if (secrets.length === 0 || !Array.isArray(value)) continue;
    const storedRows = (Array.isArray(stored[field.fieldname]) ? stored[field.fieldname] : []) as Record<string, unknown>[];
    for (const row of value as Record<string, unknown>[]) {
      if (!row || typeof row !== "object") continue;
      const rowId = row[ROW_ID_FIELD];
      const storedRow = typeof rowId === "string" ? storedRows.find((r) => r && typeof r === "object" && r[ROW_ID_FIELD] === rowId) : undefined;
      for (const f of secrets) {
        if (isEncryptedPassword(row[f.fieldname]) && !same(row[f.fieldname], storedRow?.[f.fieldname])) {
          return `${field.fieldname}.${f.fieldname}`;
        }
      }
    }
  }
  return undefined;
}

/**
 * `data` with each Password field a read left out holding the value `stored` holds, so a required
 * one counts as set while the record keeps it. A Table row keeps its stored cells on a read, so it
 * needs none.
 */
export function withStoredPasswords(
  entity: EntityDefinition,
  data: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const filled = { ...data };
  for (const field of entity.fields) {
    if (field.fieldtype === "Password" && filled[field.fieldname] === undefined && isEncryptedPassword(stored[field.fieldname])) {
      filled[field.fieldname] = stored[field.fieldname];
    }
  }
  return filled;
}

let settings: PasswordFieldKeySettings | null = null;

/** Takes the key set into use; the engine's start-up passes its env module, read lazily so a rotated setting is seen. */
export function configurePasswordFieldKeys(keySettings: PasswordFieldKeySettings): void {
  settings = keySettings;
}

/**
 * Fails start-up when an entity stores a Password field and the key set is
 * missing or malformed, naming the setting, so no engine runs with a Password
 * field it cannot encrypt.
 */
export function assertPasswordFieldKeys(entities: EntityDefinition[]): void {
  const first = entities.find((e) => !e.is_virtual && passwordFieldPaths(e).length > 0);
  if (!first) return;
  if (!settings?.PASSWORD_FIELD_KEYS) {
    throw new Error(
      `Missing required environment variable: PASSWORD_FIELD_KEYS (${first.name}.${passwordFieldPaths(first)[0]} is a Password field)`,
    );
  }
  passwordKeySet();
}

let parsed: { raw: string; activeKeyId: string; set: PasswordKeySet } | null = null;

function passwordKeySet(): PasswordKeySet {
  const raw = settings?.PASSWORD_FIELD_KEYS ?? "";
  const activeKeyId = settings?.PASSWORD_FIELD_ACTIVE_KEY_ID ?? "";
  if (parsed && parsed.raw === raw && parsed.activeKeyId === activeKeyId) return parsed.set;
  if (!raw) throw new Error("Missing required environment variable: PASSWORD_FIELD_KEYS");
  const keys = new Map<string, Buffer>();
  for (const pair of raw.split(",")) {
    const at = pair.indexOf("=");
    const id = at < 0 ? "" : pair.slice(0, at).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`PASSWORD_FIELD_KEYS: expected <id>=<base64 key> pairs, got "${pair.trim()}"`);
    }
    if (keys.has(id)) throw new Error(`PASSWORD_FIELD_KEYS: key id "${id}" is listed twice`);
    const key = Buffer.from(pair.slice(at + 1).trim(), "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(`PASSWORD_FIELD_KEYS: key "${id}" is not ${KEY_BYTES} bytes of base64`);
    }
    keys.set(id, key);
  }
  if (!activeKeyId) throw new Error("Missing required environment variable: PASSWORD_FIELD_ACTIVE_KEY_ID");
  if (!keys.has(activeKeyId)) {
    throw new Error(`PASSWORD_FIELD_ACTIVE_KEY_ID: "${activeKeyId}" is not a key id of PASSWORD_FIELD_KEYS`);
  }
  parsed = { raw, activeKeyId, set: { keys, activeKeyId } };
  return parsed.set;
}

export function encryptPassword(clear: string): EncryptedPassword {
  const set = passwordKeySet();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", set.keys.get(set.activeKeyId)!, iv);
  const data = Buffer.concat([cipher.update(clear, "utf8"), cipher.final()]);
  return {
    key_id: set.activeKeyId,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

/** A stored Password value names a key id PASSWORD_FIELD_KEYS no longer lists, so
 *  it cannot be read back; a copy or an amendment that must carry it stops here. */
export class PasswordKeyNotListedError extends Error {
  constructor(public readonly keyId: string) {
    super(`A stored Password value uses key "${keyId}", which PASSWORD_FIELD_KEYS no longer lists; list it again to copy or amend this document`);
    this.name = "PasswordKeyNotListedError";
  }
}

export function decryptPassword(stored: unknown): string {
  if (!isEncryptedPassword(stored)) throw new Error("decryptPassword: the value is not an encrypted Password value");
  const key = passwordKeySet().keys.get(stored.key_id);
  if (!key) throw new PasswordKeyNotListedError(stored.key_id);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(stored.iv, "base64"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(stored.data, "base64")), decipher.final()]).toString("utf8");
}
