// Re-export shared types and add backend-specific types
export type {
  EntityDefinition,
  FieldDefinition,
  FieldType,
  NamingConfig,
  NamingStrategy,
  IndexDefinition,
  ActionDefinition,
  LinkDefinition,
  StateDefinition,
  HookDefinitions,
} from "@digitaplatform/shared";

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  params?: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
