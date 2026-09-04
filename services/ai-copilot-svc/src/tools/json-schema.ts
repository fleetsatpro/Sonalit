// Minimal Zod -> JSON Schema conversion for model-facing tool definitions.
//
// Hand-rolled rather than pulling in `zod-to-json-schema`: tool arguments
// are deliberately a narrow shape (a flat object of strings, numbers,
// booleans and enums, per §10's tool list), and the conversion needs to
// emit the plain, unadorned schema that open-weight models handle best —
// no $ref, no definitions, no allOf. A general converter emits all three.
//
// Anything outside that shape throws at registration time rather than
// silently producing a schema the model cannot follow.

import { z } from 'zod';

interface JsonSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  const description = schema.description;
  const withDescription = (js: JsonSchema): JsonSchema =>
    description === undefined ? js : { ...js, description };

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    const inner = convert(schema._def.innerType as z.ZodTypeAny);
    return description === undefined ? inner : { ...inner, description };
  }
  if (schema instanceof z.ZodString) return withDescription({ type: 'string' });
  if (schema instanceof z.ZodNumber) return withDescription({ type: 'number' });
  if (schema instanceof z.ZodBoolean) return withDescription({ type: 'boolean' });
  if (schema instanceof z.ZodEnum) {
    return withDescription({ type: 'string', enum: schema._def.values as string[] });
  }
  if (schema instanceof z.ZodArray) {
    return withDescription({
      type: 'array',
      items: convert(schema._def.type as z.ZodTypeAny),
    });
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value);
      if (!value.isOptional()) required.push(key);
    }
    return withDescription({
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    });
  }

  throw new Error(
    `Unsupported Zod type in tool schema: ${schema.constructor.name}. ` +
      'Tool arguments must be flat objects of strings, numbers, booleans, enums or arrays.',
  );
}

export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  return convert(schema as z.ZodTypeAny) as unknown as Record<string, unknown>;
}
