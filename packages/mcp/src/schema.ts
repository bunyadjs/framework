/** The JSON Schema subset tools use to describe their arguments. */
export type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  additionalProperties?: boolean;
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function check(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
    return;
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") errors.push(`${path} must be a string`);
      return;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
      return;
    case "number":
    case "integer": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push(`${path} must be a ${schema.type}`);
        return;
      }
      if (schema.type === "integer" && !Number.isInteger(value)) errors.push(`${path} must be an integer`);
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
      return;
    }
    case "array":
      if (!Array.isArray(value)) {
        errors.push(`${path} must be an array`);
        return;
      }
      if (schema.items) value.forEach((item, i) => check(schema.items!, item, `${path}[${i}]`, errors));
      return;
    case "object": {
      if (typeOf(value) !== "object") {
        errors.push(`${path} must be an object`);
        return;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (record[key] === undefined) errors.push(`${path}.${key} is required`);
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (record[key] !== undefined) check(sub, record[key], `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in (schema.properties ?? {}))) errors.push(`${path}.${key} is not allowed`);
        }
      }
      return;
    }
    default:
      return;
  }
}

/** Human-readable problems with `args`, empty when valid. Agents see these and can retry. */
export function validateArguments(schema: JsonSchema | undefined, args: unknown): string[] {
  if (!schema) return [];
  const errors: string[] = [];
  check({ ...schema, type: schema.type ?? "object" }, args, "arguments", errors);
  return errors;
}
