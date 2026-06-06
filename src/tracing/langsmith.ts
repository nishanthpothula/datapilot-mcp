/**
 * DataPilot MCP — LangSmith Tracing Layer
 *
 * Wraps every tool handler with a LangSmith traced run.
 * Captures: tool name, skill, inputs, outputs, latency, errors.
 *
 * Set LANGSMITH_TRACING=true + LANGSMITH_API_KEY in .env to enable.
 */

import { Client, RunTree } from 'langsmith';
import type { ToolHandler, ToolContext, SkillName } from '../types/tools.js';
import type { DataPilotResponse } from '../types/responses.js';

// ─── Singleton client ─────────────────────────────────────────────────────────

let _client: Client | null = null;

function getClient(): Client | null {
  if (!process.env['LANGSMITH_API_KEY']) return null;
  if (process.env['LANGSMITH_TRACING'] !== 'true') return null;

  if (!_client) {
    _client = new Client({
      apiKey: process.env['LANGSMITH_API_KEY'],
    });
  }
  return _client;
}

// ─── Tracer ───────────────────────────────────────────────────────────────────

export interface TracedRunMeta {
  traceId: string;
  runId: string;
}

/**
 * Wrap a tool handler with LangSmith tracing.
 *
 * If tracing is disabled (no API key or LANGSMITH_TRACING != true),
 * the original handler is returned unchanged.
 */
export function withTracing(
  toolName: string,
  skill: SkillName,
  handler: ToolHandler,
): ToolHandler {
  const client = getClient();
  if (!client) return handler;

  return async (
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<DataPilotResponse<unknown>> => {
    const projectName = process.env['LANGSMITH_PROJECT'] ?? 'datapilot-mcp';

    const run = new RunTree({
      name: `${skill}/${toolName}`,
      run_type: 'tool',
      project_name: projectName,
      inputs: {
        tool: toolName,
        skill,
        userId: context.userId,
        clientId: context.clientId,
        ...input,
      },
      tags: ['datapilot', `skill:${skill}`, `tool:${toolName}`],
      metadata: {
        userId: context.userId,
        clientId: context.clientId,
        skill,
        tool: toolName,
      },
      client,
    });

    await run.postRun();

    const start = Date.now();
    let result: DataPilotResponse<unknown>;

    try {
      // Inject the trace run ID so tool can embed it in response meta
      const enrichedContext: ToolContext = {
        ...context,
        traceRunId: run.id,
      };

      result = await handler(input, enrichedContext);

      const durationMs = Date.now() - start;

      await run.end({
        outputs: {
          status: result.status,
          durationMs,
          traceId: run.id,
          ...(result.status === 'error' ? { error: result.error } : {}),
        },
      });
      await run.patchRun();

      // Embed trace ID in response meta
      if (result.meta) {
        result.meta.traceId = run.id;
      }

      return result;
    } catch (err) {
      await run.end({
        error: err instanceof Error ? err.message : String(err),
        outputs: {
          durationMs: Date.now() - start,
        },
      });
      await run.patchRun();
      throw err;
    }
  };
}

/**
 * Create a child span inside an existing trace.
 * Used for sub-operations within a single tool call.
 */
export async function withChildSpan<T>(
  parentRunId: string,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const client = getClient();
  if (!client) return operation();

  const projectName = process.env['LANGSMITH_PROJECT'] ?? 'datapilot-mcp';

  const child = new RunTree({
    name,
    run_type: 'chain',
    project_name: projectName,
    parent_run_id: parentRunId,
    client,
  });

  await child.postRun();

  try {
    const result = await operation();
    await child.end({ outputs: { result: typeof result === 'object' ? '[object]' : result } });
    await child.patchRun();
    return result;
  } catch (err) {
    await child.end({ error: err instanceof Error ? err.message : String(err) });
    await child.patchRun();
    throw err;
  }
}

/**
 * Log feedback on a completed run.
 * Useful for tools that return quality metrics.
 */
export async function logFeedback(
  runId: string,
  key: string,
  score: number,
  comment?: string,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  await client.createFeedback(runId, key, { score, comment });
}

export function isTracingEnabled(): boolean {
  return !!(process.env['LANGSMITH_API_KEY'] && process.env['LANGSMITH_TRACING'] === 'true');
}
