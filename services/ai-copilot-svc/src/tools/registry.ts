// Tool Registry (spec §10) and the execution path (§11, §12).

import { withOrgContext } from '../db.js';

import { zodToJsonSchema } from './json-schema.js';
import {
  roleSatisfies,
  type AnyToolDefinition,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from './types.js';

import type { ToolDefinition as ModelToolDefinition } from '../ai/types.js';
import type { z } from 'zod';

const tools = new Map<string, AnyToolDefinition>();

export function registerTool<TArgs, TData>(def: ToolDefinition<TArgs, TData>): void {
  if (tools.has(def.name)) {
    throw new Error(`Tool '${def.name}' is already registered`);
  }
  tools.set(def.name, def as unknown as AnyToolDefinition);
}

export function getTool(name: string): AnyToolDefinition | undefined {
  return tools.get(name);
}

/** Test seam. Production registration happens once, at module load. */
export function clearRegistry(): void {
  tools.clear();
}

/**
 * The tools a given caller may use, as model-facing definitions.
 *
 * Filtering happens HERE, before the model is told what exists — the same
 * principle as §18's rule for RAG. A tool the caller cannot invoke is never
 * described to the model, so it cannot be attempted, and its existence
 * does not leak through a refusal message.
 */
export function toolsForContext(ctx: ToolContext): ModelToolDefinition[] {
  return [...tools.values()]
    .filter((t) => roleSatisfies(ctx.role, t.required_role))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.input_schema),
    }));
}

function result<T>(
  partial: Partial<ToolResult<T>> & Pick<ToolResult<T>, 'success' | 'source'>,
): ToolResult<T> {
  return {
    data: null,
    timestamp: new Date().toISOString(),
    freshness_seconds: null,
    confidence: partial.success ? 1 : 0,
    permitted: true,
    warnings: [],
    ...partial,
  };
}

/**
 * Runs one tool call on behalf of a caller.
 *
 * Never throws for an expected failure — an unknown tool, invalid
 * arguments, or a denied permission all come back as a `ToolResult` with
 * `success: false`. That is deliberate: these results are fed back to the
 * model as tool output, and a structured refusal it can read and explain
 * is far better than an exception that aborts the whole turn.
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return result({
      success: false,
      source: 'database',
      error: `Unknown tool '${name}'`,
      warnings: ['The model requested a tool that does not exist.'],
    });
  }

  if (!roleSatisfies(ctx.role, tool.required_role)) {
    return result({
      success: false,
      source: tool.source,
      permitted: false,
      error: `Role '${ctx.role}' is not permitted to use '${name}'`,
    });
  }

  // §11 — arguments are validated before the handler sees them. Models
  // routinely emit plausible-looking but wrong argument shapes, and an
  // open-weight model does so more often than a frontier one.
  const parsed = (tool.input_schema as z.ZodType<unknown>).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return result({
      success: false,
      source: tool.source,
      error: `Invalid arguments for '${name}': ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    });
  }

  try {
    // The handler only ever receives an org-scoped client. There is no
    // route from inside a handler to an unscoped connection, which is what
    // makes tenant isolation structural rather than a convention (§59).
    const data = await withOrgContext(ctx.org_id, (client) =>
      tool.handler(parsed.data as never, ctx, client),
    );

    // A tool that can determine its data's age reports it here; without an
    // extractor freshness stays null, meaning unknown — which is never
    // treated as "fresh" downstream (§48).
    return {
      ...result({ success: true, source: tool.source, data }),
      freshness_seconds: tool.freshness ? tool.freshness(data) : null,
      // Lifted into the contract so callers see them without having to
      // know each tool's payload shape.
      warnings: tool.warnings ? tool.warnings(data) : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return result({
      success: false,
      source: tool.source,
      error: message,
      // Rule 4: the model must not read a failed lookup as "none exist".
      warnings: [`Tool '${name}' failed; its data is unavailable, not empty.`],
    });
  }
}
