export type ViewParamType = "string" | "number" | "boolean" | "date" | "duration" | "enum";

export interface ViewParamDefinition {
  name: string;
  type: ViewParamType;
  required?: boolean;
  default?: string | number | boolean;
  enum_values?: string[];
}

export interface ViewSourceDefinition {
  entity: string;
  param: string;
}

export type ViewPermissionFallback = "warn" | "silent" | "error";

export interface ViewSectionBase {
  key: string;
  entity: string;
  permission_fallback?: ViewPermissionFallback;
}

export interface LinkSection extends ViewSectionBase {
  kind: "link";
  target: string;
  fields?: string[];
}

export interface ExpandDefinition {
  field: string;
  entity: string;
  as?: string;
  fields?: string[];
}

export type ViewFilterTuple = [string, string, unknown];

export interface ListSection extends ViewSectionBase {
  kind: "list";
  filter?: ViewFilterTuple[];
  or_filter?: ViewFilterTuple[];
  order_by?: string;
  limit?: number;
  offset?: number;
  fields?: string[];
  search?: string;
  expand?: ExpandDefinition;
  deep_link?: string;
}

export interface AggregateSection extends ViewSectionBase {
  kind: "aggregate";
  pipeline: Array<Record<string, unknown>>;
}

export type ViewSection = LinkSection | ListSection | AggregateSection;

export interface ViewDefinition {
  _id: string;
  name: string;
  source?: ViewSourceDefinition;
  anchored?: boolean;
  params?: ViewParamDefinition[];
  default_limit?: number;
  max_limit?: number;
  sections: ViewSection[];
  enabled?: boolean;
  overridden?: boolean;
  description?: string;
}
