import type { EntityDefinition, FieldDefinition, FieldType } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES } from "@digitaplatform/shared";
import type { EntityRegistry } from "../entity/entity-registry.js";

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, unknown>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  security: Array<Record<string, unknown[]>>;
}

/**
 * Generate OpenAPI 3.1 spec from entity definitions.
 */
export function generateOpenAPISpec(registry: EntityRegistry, apiPrefix: string): OpenAPISpec {
  const spec: OpenAPISpec = {
    openapi: "3.1.0",
    info: {
      title: "Digita Platform API",
      version: "1.0.0",
      description: "Auto-generated API from entity definitions",
    },
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [{ BearerAuth: [] }],
  };

  // Add ApiResponse schema
  spec.components.schemas["ApiResponse"] = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      status_code: { type: "integer" },
      data: {},
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            type: { type: "string", enum: ["success", "info", "warning", "error"] },
            show: { type: "boolean" },
          },
        },
      },
      meta: {
        type: "object",
        properties: {
          total: { type: "integer" },
          page: { type: "integer" },
          page_size: { type: "integer" },
          total_pages: { type: "integer" },
        },
      },
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          detail: { type: "string" },
          trace_id: { type: "string" },
        },
      },
    },
  };

  for (const entity of registry.getAll()) {
    if (entity.is_virtual) continue;

    // Generate schema for entity
    spec.components.schemas[entity.name] = entityToSchema(entity);

    const resourcePath = `${apiPrefix}/resource/${entity.name}`;

    // List + Create
    spec.paths[resourcePath] = {
      get: {
        tags: [entity.module],
        summary: `List ${entity.label_plural ?? entity.name}`,
        parameters: [
          {
            name: "fields",
            in: "query",
            schema: { type: "string" },
            description: 'JSON array of field names, e.g. ["name","status"]',
          },
          {
            name: "filters",
            in: "query",
            schema: { type: "string" },
            description: 'JSON array of filter tuples, e.g. [["status","=","Active"]]',
          },
          {
            name: "order_by",
            in: "query",
            schema: { type: "string" },
            description: "Sort order, e.g. creation desc",
          },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "page_size", in: "query", schema: { type: "integer" } },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "List of documents" } },
      },
      post: {
        tags: [entity.module],
        summary: `Create ${entity.label ?? entity.name}`,
        requestBody: {
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${entity.name}` } },
          },
        },
        responses: { "201": { description: "Document created" } },
      },
    };

    // Read + Update + Delete
    spec.paths[`${resourcePath}/{name}`] = {
      get: {
        tags: [entity.module],
        summary: `Get ${entity.label ?? entity.name}`,
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Document data" } },
      },
      put: {
        tags: [entity.module],
        summary: `Update ${entity.label ?? entity.name}`,
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${entity.name}` } },
          },
        },
        responses: { "200": { description: "Document updated" } },
      },
      delete: {
        tags: [entity.module],
        summary: `Delete ${entity.label ?? entity.name}`,
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Document deleted" } },
      },
    };

    // Submit / Cancel (if submittable)
    if (entity.is_submittable) {
      spec.paths[`${resourcePath}/{name}/submit`] = {
        post: {
          tags: [entity.module],
          summary: `Submit ${entity.label ?? entity.name}`,
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Document submitted" } },
        },
      };
      spec.paths[`${resourcePath}/{name}/cancel`] = {
        post: {
          tags: [entity.module],
          summary: `Cancel ${entity.label ?? entity.name}`,
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Document cancelled" } },
        },
      };
    }
  }

  return spec;
}

function entityToSchema(entity: EntityDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    _id: { type: "string", description: "Document ID" },
  };
  const required: string[] = [];

  for (const field of entity.fields) {
    if (LAYOUT_FIELD_TYPES.includes(field.fieldtype)) continue;

    properties[field.fieldname] = fieldToProperty(field);
    if (field.required) required.push(field.fieldname);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function fieldToProperty(field: FieldDefinition): Record<string, unknown> {
  const prop: Record<string, unknown> = {
    description: field.label,
  };

  const typeMap: Partial<Record<FieldType, () => Record<string, unknown>>> = {
    Data: () => ({ type: "string", maxLength: field.max_length }),
    Text: () => ({ type: "string" }),
    TextEditor: () => ({ type: "string" }),
    Code: () => ({ type: "string" }),
    Markdown: () => ({ type: "string" }),
    Int: () => ({ type: "integer", minimum: field.min_value, maximum: field.max_value }),
    Float: () => ({ type: "number" }),
    Currency: () => ({ type: "number" }),
    Percent: () => ({ type: "number", minimum: 0, maximum: 100 }),
    Check: () => ({ type: "boolean" }),
    Date: () => ({ type: "string", format: "date" }),
    Datetime: () => ({ type: "string", format: "date-time" }),
    Time: () => ({ type: "string", format: "time" }),
    Duration: () => ({ type: "integer", description: "Duration in seconds" }),
    Select: () => ({
      type: "string",
      ...(Array.isArray(field.options) ? { enum: field.options } : {}),
    }),
    Link: () => ({ type: "string", description: `Reference to ${field.target}` }),
    Table: () => ({
      type: "array",
      items: field.child_fields
        ? {
            type: "object",
            properties: Object.fromEntries(
              field.child_fields
                .filter((f) => !LAYOUT_FIELD_TYPES.includes(f.fieldtype))
                .map((f) => [f.fieldname, fieldToProperty(f)]),
            ),
          }
        : { type: "object" },
    }),
    Attach: () => ({ type: "string", format: "uri" }),
    AttachImage: () => ({ type: "string", format: "uri" }),
    Image: () => ({ type: "string", format: "uri" }),
    Password: () => ({ type: "string", writeOnly: true }),
    JSON: () => ({}),
    Geolocation: () => ({ type: "object" }),
    Signature: () => ({ type: "string" }),
    Rating: () => ({ type: "number", minimum: 0, maximum: 1 }),
    Barcode: () => ({ type: "string" }),
    Color: () => ({ type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }),
    Tag: () => ({ type: "array", items: { type: "string" } }),
    Phone: () => ({ type: "string" }),
    ReadOnly: () => ({ type: "string", readOnly: true }),
  };

  const builder = typeMap[field.fieldtype];
  if (builder) {
    Object.assign(prop, builder());
  } else {
    prop["type"] = "string";
  }

  if (field.default !== undefined) {
    prop["default"] = field.default;
  }

  return prop;
}
