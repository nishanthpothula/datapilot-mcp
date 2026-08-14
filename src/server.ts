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
} from '@modelcontextprotocol/sdk/types.js';
import { registry } from './skills/index.js';
import { isDataPilotError } from './utils/errors.js';
import { errorResponse } from './types/responses.js';
import type { ToolContext, UIResource } from './types/tools.js';

// MCP content block: JSON text, plus an optional embedded UI resource (MCP Apps).
type TextBlock = { type: 'text'; text: string };
type ResourceBlock = { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };
type ContentBlock = TextBlock | ResourceBlock;

function buildServer(context: ToolContext): Server {
  const server = new Server(
    { name: 'datapilot-mcp', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  // ── List tools ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(registry.tools.values()).map((t) => ({
      name: t.spec.name,
      description: t.spec.description ?? t.spec.name,
      inputSchema: t.spec.inputSchema,
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

    // A tool may attach one interactive UI resource (MCP Apps) via context.attachUI.
    let uiResource: UIResource | undefined;
    const attachUI = (resource: UIResource): void => { uiResource = resource; };

    const enrichedContext: ToolContext = { ...context, sendProgress, sendLog, attachUI };
    const start = Date.now();

    try {
      const result = await toolDef.handler(
        (request.params.arguments ?? {}),
        enrichedContext,
      );

      context.recordToolCall?.(toolName, toolDef.skill, Date.now() - start, result.status);

      // Text block carries the structured JSON; the optional resource block carries
      // the inline UI. Clients that don't support the mcp-app profile ignore it.
      const content: ContentBlock[] = [
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ];
      if (uiResource) {
        content.push({
          type: 'resource',
          resource: {
            uri: uiResource.uri,
            mimeType: uiResource.mimeType,
            text: uiResource.text,
          },
        });
      }

      return {
        content,
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
