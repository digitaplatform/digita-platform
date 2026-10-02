import { describe, it, expect } from "vitest";
import type { EntityDefinition } from "@digitaplatform/shared";
import {
  assertPasswordFieldKeys,
  configurePasswordFieldKeys,
  decryptPassword,
  encryptPassword,
  isEncryptedPassword,
  PasswordKeyNotListedError,
} from "../src/core/entity/password-cipher.js";

const k1 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const k2 = "YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk=";
const settings = { PASSWORD_FIELD_KEYS: `k1=${k1}`, PASSWORD_FIELD_ACTIVE_KEY_ID: "k1" };

const withPassword = {
  name: "Vault", database: "app",
  fields: [{ fieldname: "secret", fieldtype: "Password" }],
} as unknown as EntityDefinition;
const withTablePassword = {
  name: "Mailer", database: "app",
  fields: [{ fieldname: "accounts", fieldtype: "Table", child_fields: [{ fieldname: "password", fieldtype: "Password" }] }],
} as unknown as EntityDefinition;
const plain = { name: "Note", database: "app", fields: [{ fieldname: "title", fieldtype: "Data" }] } as unknown as EntityDefinition;

const startUp = (entities: EntityDefinition[], keys: string, activeKeyId: string) => () => {
  configurePasswordFieldKeys({ PASSWORD_FIELD_KEYS: keys, PASSWORD_FIELD_ACTIVE_KEY_ID: activeKeyId });
  assertPasswordFieldKeys(entities);
};

describe("the Password key set at start-up", () => {
  it("is not required while no entity stores a Password field", () => {
    expect(startUp([plain], "", "")).not.toThrow();
  });

  it("is required by a Password field, and the error names the setting and the field", () => {
    expect(startUp([plain, withPassword], "", ""))
      .toThrow(expect.objectContaining({ code: "password_keys_missing_for_field", params: { setting: "PASSWORD_FIELD_KEYS", field: "Vault.secret" } }));
  });

  it("is required by a Password field inside a Table row", () => {
    expect(startUp([withTablePassword], "", ""))
      .toThrow(expect.objectContaining({ params: { setting: "PASSWORD_FIELD_KEYS", field: "Mailer.accounts.password" } }));
  });

  it("refuses a key that is not 32 bytes, a malformed pair, a duplicate id and an unlisted active id", () => {
    expect(startUp([withPassword], "k1=c2hvcnQ=", "k1")).toThrow(expect.objectContaining({ code: "password_key_wrong_length", params: { key: "k1", bytes: "32" } }));
    expect(startUp([withPassword], "k1", "k1")).toThrow(expect.objectContaining({ code: "password_key_pair_malformed", params: { position: "1" } }));
    expect(startUp([withPassword], `k1=${k1},k1=${k2}`, "k1")).toThrow(expect.objectContaining({ code: "password_key_listed_twice", params: { key: "k1" } }));
    expect(startUp([withPassword], `k1=${k1}`, "")).toThrow(expect.objectContaining({ code: "setting_missing", params: { setting: "PASSWORD_FIELD_ACTIVE_KEY_ID" } }));
    expect(startUp([withPassword], `k1=${k1}`, "k9")).toThrow(expect.objectContaining({ code: "password_active_key_not_listed", params: { key: "k9" } }));
  });
});

describe("encryptPassword and decryptPassword", () => {
  it("round-trip under the active key id, with a fresh iv each time", () => {
    configurePasswordFieldKeys(settings);
    const a = encryptPassword("hunter2");
    const b = encryptPassword("hunter2");
    expect(isEncryptedPassword(a)).toBe(true);
    expect(a.key_id).toBe("k1");
    expect(a.data).not.toBe(b.data);
    expect(decryptPassword(a)).toBe("hunter2");
    expect(decryptPassword(b)).toBe("hunter2");
  });

  it("read a value of an old key while it stays listed, and refuse it once it is gone", () => {
    configurePasswordFieldKeys(settings);
    const old = encryptPassword("hunter2");
    configurePasswordFieldKeys({ PASSWORD_FIELD_KEYS: `k1=${k1},k2=${k2}`, PASSWORD_FIELD_ACTIVE_KEY_ID: "k2" });
    expect(encryptPassword("new").key_id).toBe("k2");
    expect(decryptPassword(old)).toBe("hunter2");
    configurePasswordFieldKeys({ PASSWORD_FIELD_KEYS: `k2=${k2}`, PASSWORD_FIELD_ACTIVE_KEY_ID: "k2" });
    expect(() => decryptPassword(old)).toThrow(PasswordKeyNotListedError);
    expect(() => decryptPassword(old)).toThrow(expect.objectContaining({ code: "password_key_not_listed", params: { key: "k1" } }));
  });

  it("refuse a tampered value and a value that is no encrypted Password value", () => {
    configurePasswordFieldKeys(settings);
    const stored = encryptPassword("hunter2");
    expect(() => decryptPassword({ ...stored, data: stored.data.replace(/^./, (c) => (c === "A" ? "B" : "A")) })).toThrow();
    expect(() => decryptPassword("hunter2")).toThrow(expect.objectContaining({ code: "password_value_not_encrypted" }));
  });

  it("refuse a value whose authentication tag was cut to 12 bytes", () => {
    configurePasswordFieldKeys(settings);
    const stored = encryptPassword("hunter2");
    const cut = Buffer.from(stored.tag, "base64").subarray(0, 12).toString("base64");
    expect(() => decryptPassword({ ...stored, tag: cut })).toThrow();
  });
});
