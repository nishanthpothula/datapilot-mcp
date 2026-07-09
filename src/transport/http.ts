/**
 * DataPilot MCP — HTTP/SSE Transport Layer
 *
 * Exposes the MCP server over HTTP using the Streamable HTTP transport,
 * which is the recommended production transport for hosted MCP servers.
 *
 * Endpoints:
 *   POST /mcp          — Main MCP JSON-RPC endpoint (authenticated)
 *   GET  /mcp          — SSE stream for server-to-client notifications
 *   DELETE /mcp        — Close a session
 *
 *   POST /oauth/register  — Dynamic Client Registration (DCR)
 *   GET  /health          — Health check (unauthenticated)
 *   GET  /meta            — Server metadata (unauthenticated)
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { requireAuth } from '../auth/middleware.js';
import { registerClient } from '../auth/dcr.js';
import { createMcpServerWithContext } from '../server.js';
import { registry } from '../skills/index.js';
import { isDataPilotError } from '../utils/errors.js';
import { isTracingEnabled } from '../tracing/langsmith.js';
import type { ToolContext, ToolCallRecord, SkillName } from '../types/tools.js';

// ─── Session store (in-memory; replace with Redis for multi-instance) ─────────

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  context: ToolContext;
  createdAt: Date;
  toolCallHistory: ToolCallRecord[];
}

const sessions = new Map<string, SessionEntry>();

// ─── App factory ─────────────────────────────────────────────────────────────

export function createApp(): express.Application {
  const app = express();

  // ─── Middleware ──────────────────────────────────────────────────────────

  app.use(
    helmet({
      contentSecurityPolicy: false, // SSE doesn't work with strict CSP
    }),
  );

  app.use(
    cors({
      origin: process.env['CORS_ORIGINS'] === '*'
        ? '*'
        : (process.env['CORS_ORIGINS'] ?? '').split(',').map((o) => o.trim()),
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id'],
      exposedHeaders: ['mcp-session-id'],
    }),
  );

  if (process.env['NODE_ENV'] !== 'test') {
    app.use(morgan('combined'));
  }

  // Normalize double slashes that mcp-remote produces when joining URLs
  app.use((req, _res, next) => {
    req.url = req.url.replace(/\/\/+/g, '/');
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  // ─── OAuth discovery (RFC 8414) ──────────────────────────────────────────
  // mcp-remote reads this to know where to send the user for login

  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    const domain = process.env['AUTH0_DOMAIN'];
    const publicUrl = process.env['PUBLIC_URL'] ?? 'http://localhost:3000';

    if (!domain) {
      res.status(404).json({ error: 'Auth not configured' });
      return;
    }

    // Embed the API audience in the authorize URL. Without it, Auth0 issues an
    // opaque token that our JWKS verifier can't validate; with it, Auth0 mints a
    // JWT access token for our API. mcp-remote preserves this query param when it
    // appends its own OAuth params.
    const audience = process.env['AUTH0_AUDIENCE'];
    const authorizeUrl = new URL(`https://${domain}/authorize`);
    if (audience) authorizeUrl.searchParams.set('audience', audience);

    res.json({
      issuer: `https://${domain}/`,
      authorization_endpoint: authorizeUrl.toString(),
      token_endpoint: `https://${domain}/oauth/token`,
      jwks_uri: `https://${domain}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      registration_endpoint: `${publicUrl}/oauth/register`,
    });
  });

  // ─── Health check ────────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'datapilot-mcp',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      tracing: isTracingEnabled(),
      activeSessions: sessions.size,
    });
  });

  // ─── Server metadata ─────────────────────────────────────────────────────

  app.get('/meta', (_req, res) => {
    res.json({
      name: 'DataPilot MCP',
      version: '1.0.0',
      description: 'Enterprise Data & Analytics MCP Server',
      skills: Array.from(registry.skills.values()).map((s) => ({
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        version: s.version,
        tools: s.tools.map((t) => ({
          name: t.spec.name,
          description: t.spec.description,
        })),
      })),
      totalTools: registry.tools.size,
      auth: {
        type: 'Bearer',
        tokenEndpoint: process.env['AUTH0_DOMAIN']
          ? `https://${process.env['AUTH0_DOMAIN']}/oauth/token`
          : null,
        audience: process.env['AUTH0_AUDIENCE'] ?? null,
        registrationEndpoint: '/oauth/register',
      },
      transport: 'streamable-http',
    });
  });

  // ─── Dynamic Client Registration ─────────────────────────────────────────

  app.post('/oauth/register', (req: Request, res: Response) => {
    registerClient(req.body)
      .then((result) => {
        res.status(201).json(result);
      })
      .catch((err: unknown) => {
        if (isDataPilotError(err)) {
          res.status(err.statusCode).json({
            error: 'invalid_client_metadata',
            error_description: err.message,
            details: err.details,
          });
        } else {
          res.status(500).json({ error: 'server_error' });
        }
      });
  });

  // ─── MCP Streamable HTTP Transport ───────────────────────────────────────

  // POST /mcp — Handle JSON-RPC messages
  app.post('/mcp', requireAuth, (async (req: Request, res: Response): Promise<void> => {
    const context = req.toolContext!;
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      // ── Resume existing session (normal tool call on a live session) ──────────
      if (sessionId && sessions.has(sessionId) && !isInitializeRequest(req.body)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // ── Reconnect: client re-sends initialize on an existing session ──────────
      // Claude Desktop does not re-send initialize after a network blip; it re-uses
      // the old session ID. However, if it does re-send initialize (e.g. on app
      // foreground), the existing transport would reject it with 400 "already
      // initialized". Tear down the old session transparently and fall through to
      // create a fresh one — reusing the same session ID so the client sees no change.
      if (sessionId && sessions.has(sessionId) && isInitializeRequest(req.body)) {
        sessions.delete(sessionId);
      }

      // ── Stale session + non-initialize (server restarted, session lost) ───────
      if (sessionId && !sessions.has(sessionId) && !isInitializeRequest(req.body)) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found — please reinitialize' },
          id: null,
        });
        return;
      }

      // ── Gate: first request to a new session must be initialize ───────────────
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Bad Request: First request must be initialize' },
          id: null,
        });
        return;
      }

      // ── Create session (new, or replacement after a reconnect) ────────────────
      // Reuse the client's own session ID when reconnecting so it sees continuity.
      const assignedSessionId = sessionId ?? randomUUID();
      const toolCallHistory: ToolCallRecord[] = [];
      const sessionContext: ToolContext = {
        ...context,
        recordToolCall: (tool: string, skill: SkillName, durationMs: number, status: string): void => {
          toolCallHistory.push({ tool, skill, timestamp: new Date().toISOString(), durationMs, status });
        },
      };
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: (): string => assignedSessionId,
        onsessioninitialized: (sid: string): void => {
          sessions.set(sid, {
            transport,
            context: sessionContext,
            createdAt: new Date(),
            toolCallHistory,
          });
        },
      });

      // Only delete our own session entry — guard against a replacement transport
      // (same session ID, new transport) accidentally removing the new session.
      transport.onclose = (): void => {
        const current = sessions.get(assignedSessionId);
        if (current?.transport === transport) {
          sessions.delete(assignedSessionId);
        }
      };

      const mcpServer = createMcpServerWithContext(sessionContext);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
      // eslint-disable-next-line no-console
      console.error('[MCP] Error handling request:', err);
    }
  }) as express.RequestHandler);

  // GET /mcp — SSE stream for server-to-client notifications
  app.get('/mcp', requireAuth, (async (req: Request, res: Response): Promise<void> => {
	console.log('[SSE] Client connected to /mcp SSE stream');
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Unknown or missing session ID' });
      return;
    }

    const session = sessions.get(sessionId)!;

    try {
      await session.transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).end();
      }
      // eslint-disable-next-line no-console
      console.error('[SSE] Error:', err);
    }
  }) as express.RequestHandler);

  // DELETE /mcp — Close a session
  app.delete('/mcp', requireAuth, (async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const session = sessions.get(sessionId)!;

    try {
      await session.transport.handleRequest(req, res);
      sessions.delete(sessionId);
    } catch (err) {
      res.status(500).json({ error: 'Failed to close session' });
      // eslint-disable-next-line no-console
      console.error('[DELETE] Error:', err);
    }
  }) as express.RequestHandler);

  // GET /sessions/:sessionId/tools — Tool call history for a conversation
  app.get('/sessions/:sessionId/tools', requireAuth, (req: Request, res: Response): void => {
    const session = sessions.get(req.params['sessionId']);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({
      sessionId: req.params['sessionId'],
      createdAt: session.createdAt.toISOString(),
      toolCallCount: session.toolCallHistory.length,
      tools: session.toolCallHistory,
    });
  });

  // ─── Global error handler ─────────────────────────────────────────────────

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isDataPilotError(err)) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.error('[HTTP] Unhandled error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  return app;
}
