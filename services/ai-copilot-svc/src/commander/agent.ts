// Commander agent loop (spec §9, §13-16, §33, §44).
//
// A bounded tool-use loop. Bounded is the operative word: §9 requires
// explicit ceilings on tool calls, turns and wall-clock time, because an
// agent that can loop indefinitely will eventually do so — against a
// production database, on someone's behalf.
//
// The loop deliberately does NOT trust the model for anything structural:
//
//  * which tools exist        — from the registry, filtered by role
//  * whether a call is allowed — checked by executeTool, not the prompt
//  * how evidence is labelled  — derived from each tool's declared source
//  * the confidence figure     — derived from evidence, never model-stated
//
// The model chooses which tools to call and writes the prose. Everything
// that a wrong answer would turn into a wrong ACTION is decided in code.

import { newRequestId, recordAudit, type AuditOutcome } from '../ai/audit.js';
import { infer } from '../ai/router.js';
import {
  AllModelsFailedError,
  NoEligibleModelError,
  type InferenceMessage,
  type ToolCall,
} from '../ai/types.js';
import { executeTool, toolsForContext } from '../tools/index.js';

import { COMMANDER_SYSTEM_PROMPT, PROMPT_VERSION, buildContextPreamble } from './prompt.js';
import {
  DEFAULT_BUDGET,
  deriveConfidence,
  evidenceKindForSource,
  type CommanderBudget,
  type CommanderContext,
  type CommanderResponse,
  type CompletionReason,
  type Evidence,
} from './types.js';

import type { ToolContext } from '../tools/types.js';

export interface RunOptions {
  message: string;
  ctx: ToolContext;
  context?: CommanderContext;
  conversationId?: string;
  budget?: Partial<CommanderBudget>;
  /**
   * Authorises the UI context (§14). Given the caller and the entity they
   * claim to be viewing, returns whether they may actually see it.
   *
   * Injected rather than assumed: only the caller knows how to check a
   * given entity type, and defaulting to "authorised" would let a client
   * confirm the existence of entities it cannot read.
   */
  authoriseContext?: (ctx: ToolContext, context: CommanderContext) => Promise<boolean>;
}

/** Tool output as the model sees it: a JSON payload, explicitly framed as data. */
function renderToolResult(result: {
  success: boolean;
  data: unknown;
  error?: string;
  warnings: string[];
}): string {
  if (!result.success) {
    return JSON.stringify({
      status: 'failed',
      error: result.error ?? 'unknown error',
      // Rule 4 — the model must not read a failure as "nothing found".
      note: 'This tool failed. Its data is unavailable; do not treat this as an empty result.',
    });
  }
  return JSON.stringify({
    status: 'ok',
    data: result.data,
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  });
}

export async function runCommander(options: RunOptions): Promise<CommanderResponse> {
  const budget: CommanderBudget = { ...DEFAULT_BUDGET, ...options.budget };
  const requestId = newRequestId();
  const startedAt = Date.now();

  const tools = toolsForContext(options.ctx);
  const evidence: Evidence[] = [];
  const toolsUsed: string[] = [];
  const warnings: string[] = [];
  let toolCalls = 0;

  const finish = async (
    answer: string,
    completion: CompletionReason,
    modelName: string,
    outcome: AuditOutcome,
    error?: string,
  ): Promise<CommanderResponse> => {
    const ages = evidence.map((e) => e.freshness_seconds).filter((a): a is number => a !== null);

    await recordAudit({
      org_id: options.ctx.org_id,
      user_id: options.ctx.user_id,
      conversation_id: options.conversationId ?? null,
      request_id: requestId,
      capability: 'general',
      classification: 'operational',
      prompt_version: PROMPT_VERSION,
      tools_invoked: toolsUsed,
      latency_ms: Date.now() - startedAt,
      outcome,
      error: error ?? null,
    });

    return {
      answer,
      evidence,
      tools_used: toolsUsed,
      completion_reason: completion,
      confidence: deriveConfidence(evidence, completion),
      // Oldest input governs: an answer is only as current as its stalest part.
      data_age_seconds: ages.length > 0 ? Math.max(...ages) : null,
      model_name: modelName,
      prompt_version: PROMPT_VERSION,
      request_id: requestId,
      warnings,
    };
  };

  if (tools.length === 0) {
    return finish(
      'I have no tools available for your role, so I cannot look anything up. ' +
        'Please contact an administrator about your permissions.',
      'no_tools_permitted',
      'none',
      'rejected',
    );
  }

  let contextAuthorised = false;
  if (options.context?.entity_id && options.context.entity_type) {
    // §14 — re-checked server-side. Absent an authoriser the context is
    // treated as unauthorised: a client must not be able to widen what the
    // model can reference simply by asserting a screen.
    contextAuthorised = options.authoriseContext
      ? await options.authoriseContext(options.ctx, options.context)
      : false;
    if (!contextAuthorised) {
      warnings.push('The supplied screen context was not authorised and has been ignored.');
    }
  }

  const messages: InferenceMessage[] = [
    {
      role: 'user',
      content: `${buildContextPreamble({
        role: options.ctx.role,
        ...(options.context ? { context: options.context } : {}),
        contextAuthorised,
      })}\n\n${options.message}`,
    },
  ];

  let modelName = 'unknown';

  for (let turn = 0; turn < budget.max_turns; turn += 1) {
    if (Date.now() - startedAt > budget.max_wall_clock_ms) {
      warnings.push('Ran out of time before completing the investigation.');
      return finish(
        partialAnswer(evidence, 'I ran out of time before I could finish looking into this.'),
        'time_budget_exhausted',
        modelName,
        'error',
      );
    }

    let response;
    try {
      const routed = await infer({
        capability: 'general',
        classification: 'operational',
        system: COMMANDER_SYSTEM_PROMPT,
        messages,
        tools,
        max_tokens: 2048,
        timeout_ms: Math.max(5_000, budget.max_wall_clock_ms - (Date.now() - startedAt)),
      });
      response = routed.result;
      modelName = response.model_name;
    } catch (err) {
      // §49 / §62 — with no model, Commander reports that it cannot answer.
      // It never falls back to answering from the model's own memory,
      // because there is no model.
      if (err instanceof NoEligibleModelError || err instanceof AllModelsFailedError) {
        return finish(
          'The reasoning models are currently unavailable, so I cannot answer this. ' +
            'Sonalit’s dashboards, alerts and reports are unaffected and remain accurate.',
          'model_unavailable',
          modelName,
          'all_models_failed',
          err.message,
        );
      }
      throw err;
    }

    if (response.tool_calls.length === 0) {
      return finish(response.text, 'answered', modelName, 'success');
    }

    // Budget is checked against the whole batch: a model asking for six
    // tools at once must not be able to overshoot by requesting them
    // together rather than one at a time.
    if (toolCalls + response.tool_calls.length > budget.max_tool_calls) {
      warnings.push(
        `Stopped after ${String(toolCalls)} tool calls — the investigation budget was reached.`,
      );
      return finish(
        partialAnswer(
          evidence,
          'I reached my lookup limit before I could finish investigating this.',
        ),
        'tool_budget_exhausted',
        modelName,
        'error',
      );
    }

    messages.push({
      role: 'assistant',
      content: response.text,
      tool_calls: response.tool_calls,
    });

    for (const call of response.tool_calls) {
      toolCalls += 1;
      const rendered = await runOne(call, options.ctx, evidence, toolsUsed);
      messages.push({ role: 'tool', tool_call_id: call.id, content: rendered });
    }
  }

  warnings.push('Reached the maximum number of reasoning turns.');
  return finish(
    partialAnswer(evidence, 'I could not reach a conclusion within my reasoning budget.'),
    'tool_budget_exhausted',
    modelName,
    'error',
  );
}

async function runOne(
  call: ToolCall,
  ctx: ToolContext,
  evidence: Evidence[],
  toolsUsed: string[],
): Promise<string> {
  toolsUsed.push(call.name);
  const result = await executeTool(call.name, call.input, ctx);

  // Evidence is classified from the TOOL's declared source, in code. This
  // is what stops a model presenting its own inference as an observation:
  // the label never passes through the model (§15, §47).
  evidence.push({
    kind: evidenceKindForSource(result.source),
    source: call.name,
    summary: result.success
      ? `${call.name} returned data`
      : `${call.name} failed: ${result.error ?? 'unknown error'}`,
    freshness_seconds: result.freshness_seconds,
    caveats: result.warnings,
  });

  return renderToolResult(result);
}

/**
 * What to say when the budget ran out mid-investigation.
 *
 * §62 — a truncated investigation is reported as truncated. Presenting
 * partial findings as a complete answer is the specific failure this
 * avoids; the caller also gets `completion_reason` to act on.
 */
function partialAnswer(evidence: Evidence[], reason: string): string {
  if (evidence.length === 0) {
    return `${reason} I have no findings to report.`;
  }
  const sources = [...new Set(evidence.map((e) => e.source))].join(', ');
  return (
    `${reason} What I did retrieve came from: ${sources}. ` +
    'Treat this as incomplete — ask a narrower question, or check the relevant ' +
    'dashboard directly.'
  );
}
