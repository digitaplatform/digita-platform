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
  scope?: {
    field: string;
    user_field: string;
  };
}

export const SYSTEM_ROLES = {
  ADMINISTRATOR: "Administrator",
  SYSTEM_USER: "System User",
  WEBSITE_USER: "Website User",
  GUEST: "Guest",
} as const;
