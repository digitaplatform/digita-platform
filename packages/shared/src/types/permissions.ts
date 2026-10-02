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

export const SYSTEM_ROLES = {
  ADMINISTRATOR: "Administrator",
  SYSTEM_USER: "System User",
  WEBSITE_USER: "Website User",
  GUEST: "Guest",
} as const;
