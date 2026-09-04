// Knowledge search tool (spec §10, §17).
//
// Wraps the RAG retriever. The tool boundary is where §18's guarantee gets
// its teeth: the caller's role and the request's classification ceiling are
// taken from ToolContext — never from the model's arguments — so a model
// cannot widen its own access by asking for it.

import { z } from 'zod';

import { retrieve } from '../../rag/retrieve.js';
import { KnowledgeUnavailableError } from '../../rag/types.js';
import { registerTool } from '../registry.js';

registerTool({
  name: 'search_documents',
  description:
    'Search indexed operational knowledge — SOPs, policies, manuals, procedures, route ' +
    'documentation and past reports. Use this for questions about how something should ' +
    'be done or what the organisation has documented, not for live operational state. ' +
    'Returns excerpts with their source document so answers can be cited.',
  action_level: 'read',
  required_role: 'analyst',
  source: 'database',
  input_schema: z.object({
    query: z.string().min(1).max(1000).describe('What to search for, in natural language'),
    doc_types: z
      .array(
        z.enum([
          'sop',
          'policy',
          'manual',
          'report',
          'incident',
          'procedure',
          'route_doc',
          'other',
        ]),
      )
      .optional()
      .describe('Restrict to particular document types'),
    limit: z.number().optional().describe('Maximum excerpts to return (default 8, max 50)'),
    include_expired: z
      .boolean()
      .optional()
      .describe(
        'Include superseded or expired documents. Only set this when the user explicitly ' +
          'asks about historical or previous guidance.',
      ),
  }),
  handler: async (args, ctx, client) => {
    try {
      const chunks = await retrieve(
        {
          query: args.query,
          // From the authenticated context, not the model's arguments.
          role: ctx.role,
          // Tool output re-enters the model's context, so this request's
          // ceiling governs what may be retrieved into it.
          max_classification: 'operational',
          ...(args.doc_types ? { doc_types: args.doc_types } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.include_expired !== undefined ? { include_expired: args.include_expired } : {}),
        },
        client,
      );

      return {
        count: chunks.length,
        // Rule 4: an empty result means nothing matched what this caller is
        // allowed to see — it does not mean the organisation has no such
        // document, and the model must not report it that way.
        note:
          chunks.length === 0
            ? 'No indexed document matched this query within the caller’s permissions. ' +
              'This does not establish that no such document exists.'
            : undefined,
        excerpts: chunks.map((c) => ({
          title: c.title,
          doc_type: c.doc_type,
          content: c.content,
          similarity: Number(c.similarity.toFixed(3)),
          uri: c.uri,
          source: c.source_table ? `${c.source_table}:${c.source_id ?? ''}` : null,
          valid_until: c.valid_until,
          stale: c.stale,
        })),
      };
    } catch (err) {
      // Surfaced as a tool failure so Commander can say retrieval is
      // unavailable (§62) rather than answering from parametric memory.
      if (err instanceof KnowledgeUnavailableError) {
        throw new Error(
          `Document search is unavailable (${err.message}). Operational knowledge could ` +
            'not be consulted for this answer.',
        );
      }
      throw err;
    }
  },
});
