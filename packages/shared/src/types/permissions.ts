export enum PermissionAction {
  Select = "select",
  Read = "read",
  Write = "write",
  Create = "create",
  Delete = "delete",
  Submit = "submit",
  Cancel = "cancel",
  Amend = "amend",
  Print = "print",
  Email = "email",
  Export = "export",
  Import = "import",
  Share = "share",
  Report = "report",
}

export interface EntityPermission {
  role: string;
  level: number;
  select?: 0 | 1;
  read?: 0 | 1;
  write?: 0 | 1;
  create?: 0 | 1;
  delete?: 0 | 1;
  submit?: 0 | 1;
  cancel?: 0 | 1;
  amend?: 0 | 1;
  print?: 0 | 1;
  email?: 0 | 1;
  export?: 0 | 1;
  import?: 0 | 1;
  share?: 0 | 1;
  report?: 0 | 1;
  if_owner?: boolean;
  condition?: string;
  /**
   * The fields this row opens for reading, filtering, sorting and search. Without it the row
   * opens every field of its `level`; with it only the named fields of that level, and a named
   * Table opens its children of that level. A row with `fields` never opens `owner` or
   * `modified_by`.
   */
  fields?: string[];
  scope?: {
    field: string;
    user_field: string;
  };
}

/**
 * Whether a user with `roles` holds `permission` as a row that can grant an action
 * (create, delete, submit, …). Only a level-0 row can; a row at a higher level opens
 * the fields of that `perm_level` and grants no action. The engine checks an action
 * through this rule, and the app offers one through it.
 */
export function canGrantActionTo(permission: EntityPermission, roles: readonly string[]): boolean {
  return permission.level === 0 && roles.includes(permission.role);
}

/** The part of a read row that decides which fields it opens. */
export type ReadRow = Pick<EntityPermission, "level" | "fields">;

/**
 * Whether a read row opens the field `fieldname` of `level`, or a child of `level` of the Table
 * `fieldname`: the row's level, and its `fields`, when it has them, name the field. The engine
 * decides every field a read answers through this rule, and so does whatever else answers
 * stored rows, such as the report service.
 */
export function opensField(row: ReadRow, fieldname: string, level: number): boolean {
  return row.level === level && (!row.fields || row.fields.includes(fieldname));
}

/** Whether a user's read rows open `owner` and `modified_by`: unless every one of them carries `fields`. */
export function opensOperatorFields(rows: readonly ReadRow[]): boolean {
  return rows.length === 0 || rows.some((row) => !row.fields);
}

/** The stored fields every readable row shows: what the row is and when it changed. */
export const IDENTITY_FIELDS: readonly string[] = ["_id", "doctype", "docstatus", "creation", "modified"];
/** The stored fields that name the people who wrote a row. A read row with `fields` hides them. */
export const OPERATOR_FIELDS: readonly string[] = ["owner", "modified_by"];

/** The part of a field definition that decides who reads it, a Table's child fields included. */
export interface ReadField {
  fieldname: string;
  perm_level?: number;
  child_fields?: readonly { fieldname: string; perm_level?: number }[];
}

/**
 * The fields a read answers to a reader whose read rows are `rows`: the identity fields, every
 * field one of the rows opens, and the operator fields where the rows open them. A key that starts
 * with `_` is not a field and passes on its own. The engine answers its reads by this rule, and so
 * does whatever else answers stored rows, such as the report service.
 */
export function readableFields(fields: readonly ReadField[], rows: readonly ReadRow[]): Set<string> {
  const readable = new Set<string>(IDENTITY_FIELDS);
  for (const field of fields) {
    if (rows.some((row) => opensField(row, field.fieldname, field.perm_level ?? 0))) readable.add(field.fieldname);
  }
  if (opensOperatorFields(rows)) for (const field of OPERATOR_FIELDS) readable.add(field);
  return readable;
}

/**
 * The child fields of the Table `table` that `rows` open, with the row keys `_row_id` and `idx`.
 * `null` when no child field is gated: then the Table field itself decides, as any field does.
 */
export function readableChildFields(table: ReadField, rows: readonly ReadRow[]): Set<string> | null {
  const children = table.child_fields ?? [];
  if (!children.some((child) => (child.perm_level ?? 0) > 0)) return null;
  const readable = new Set<string>(["_row_id", "idx"]);
  for (const child of children) {
    if (rows.some((row) => opensField(row, table.fieldname, child.perm_level ?? 0))) readable.add(child.fieldname);
  }
  return readable;
}

export const SYSTEM_ROLES = {
  ADMINISTRATOR: "Administrator",
  SYSTEM_USER: "System User",
  GUEST: "Guest",
} as const;

/**
 * Tenant-global super-roles every engine honors regardless of app scope. They are deliberately
 * cross-app (platform administration), so they ride the token unprefixed and are never namespaced
 * to a single app. digita-auth's seed keeps exactly these unprefixed too.
 */
export const TENANT_GLOBAL_ROLES: readonly string[] = [SYSTEM_ROLES.ADMINISTRATOR, SYSTEM_ROLES.SYSTEM_USER];
