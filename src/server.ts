/**
 * DataPilot MCP — MCP Server Setup
 *
 * Uses the low-level Server class (not McpServer) so we can pass our
 * tool specs as raw JSON Schema objects rather than Zod schemas.
 * McpServer requires Zod; Server accepts JSON Schema directly.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { registry } from './skills/index.js';
import { isDataPilotError } from './utils/errors.js';
import { errorResponse } from './types/responses.js';
import type { ToolContext } from './types/tools.js';
import { UI_RESOURCES, getUiResource } from './ui/registry.js';

function buildServer(context: ToolContext): Server {
  const server = new Server(
    { name: 'datapilot-mcp', version: '1.0.0' },
    // `resources` capability is required so the host can read our ui:// templates
    // (MCP Apps / io.modelcontextprotocol/ui).
    { capabilities: { tools: {}, logging: {}, resources: {} } },
  );

  // ── List resources (MCP Apps UI templates) ──────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: UI_RESOURCES.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      ...(r.meta ? { _meta: r.meta } : {}),
    })),
  }));

  // ── Read resource — return the static HTML template for a ui:// URI ──────────
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const res = getUiResource(request.params.uri);
    if (!res) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    return {
      contents: [{
        uri: res.uri,
        mimeType: res.mimeType,
        text: res.html,
        ...(res.meta ? { _meta: res.meta } : {}),
      }],
    };
  });

  // ── List tools ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(registry.tools.values()).map((t) => ({
      name: t.spec.name,
      description: t.spec.description ?? t.spec.name,
      inputSchema: t.spec.inputSchema,
      // Pass through _meta so the UI linkage (_meta.ui.resourceUri) reaches the host.
      ...(t.spec._meta ? { _meta: t.spec._meta } : {}),
    })),
  }));

  // ── Call tool ──────────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const toolDef = registry.tools.get(toolName);

    if (!toolDef) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    // Wire up MCP progress notifications if the client sent a progressToken.
    //
    // We send via `extra.sendNotification` (the request-scoped sender) rather than
    // `server.notification`. The latter has no related request ID, so the Streamable
    // HTTP transport routes it to the standalone GET SSE stream — which our client
    // never opens, so every progress notification was being silently dropped.
    // `extra.sendNotification` attaches `relatedRequestId`, so progress is delivered
    // on the tool call's own POST SSE response stream, which is open for the duration
    // of the call.
    const progressToken = request.params._meta?.progressToken;
    const sendProgress = progressToken !== undefined
      ? async (progress: number, total: number, message?: string): Promise<void> => {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: { progressToken, progress, total, ...(message ? { message } : {}) },
          });
        }
      : undefined;

    const sendLog = async (level: 'debug' | 'info' | 'warning' | 'error', message: string, logger = 'datapilot'): Promise<void> => {
      await extra.sendNotification({
        method: 'notifications/message',
        params: { level, logger, data: message },
      });
    };

    // A tool linked to a ui:// resource (MCP Apps) may attach structuredContent, which
    // the host forwards to the rendered iframe (not added to the model context).
    let structuredContent: Record<string, unknown> | undefined;
    const attachStructuredContent = (data: Record<string, unknown>): void => { structuredContent = data; };

    const enrichedContext: ToolContext = { ...context, sendProgress, sendLog, attachStructuredContent };
    const start = Date.now();

    try {
      const result = await toolDef.handler(
        (request.params.arguments ?? {}),
        enrichedContext,
      );

      context.recordToolCall?.(toolName, toolDef.skill, Date.now() - start, result.status);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        ...(structuredContent ? { structuredContent } : {}),
        isError: result.status === 'error',
      };
    } catch (err) {
      const code = isDataPilotError(err) ? err.code : 'INTERNAL_ERROR';
      const message = err instanceof Error ? err.message : 'Unknown error';

      context.recordToolCall?.(toolName, toolDef.skill, Date.now() - start, 'error');

      const errResponse = errorResponse(code, message, {
        tool: toolName,
        skill: toolDef.skill,
        durationMs: Date.now() - start,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(errResponse, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}

export function createMcpServer(): Server {
  return buildServer({ userId: 'mcp-direct', clientId: 'mcp-direct' });
}

export function createMcpServerWithContext(context: ToolContext): Server {
  return buildServer(context);
}
