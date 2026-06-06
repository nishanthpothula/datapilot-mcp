/**
 * DataPilot MCP — Auth Middleware
 *
 * Express middleware that validates Bearer tokens on every
 * MCP request and populates req.toolContext with the verified identity.
 */

import type { Request, Response, NextFunction } from 'express';
import { extractBearerToken, verifyToken, type VerifiedToken } from './oidc.js';
import { AuthenticationError, isDataPilotError } from '../utils/errors.js';
import type { ToolContext } from '../types/tools.js';

// ─── Augment Express request ──────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      toolContext?: ToolContext;
      verifiedToken?: VerifiedToken;
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Require a valid Bearer token. Attaches toolContext to req on success.
 *
 * Dev-mode bypass: when AUTH0_DOMAIN is not set and NODE_ENV === 'development',
 * auth is skipped entirely and a synthetic dev identity is injected. This prevents
 * MCP clients (e.g. VS Code) from seeing 401s and triggering unwanted OAuth discovery.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // ── Dev bypass ───────────────────────────────────────────────────────────────
  if (!process.env['AUTH0_DOMAIN'] && process.env['NODE_ENV'] === 'development') {
    req.toolContext = { userId: 'dev-user', clientId: 'dev-client' };
    next();
    return;
  }

  const token = extractBearerToken(req.headers['authorization']);

  if (!token) {
    res.status(401).json({
      error: 'authentication_required',
      error_description: 'Bearer token required. Obtain a token from Auth0 and include it as Authorization: Bearer <token>',
      token_endpoint: process.env['AUTH0_DOMAIN']
        ? `https://${process.env['AUTH0_DOMAIN']}/oauth/token`
        : null,
    });
    return;
  }

  verifyToken(token)
    .then((verified) => {
      req.verifiedToken = verified;
      req.toolContext = {
        userId: verified.sub,
        clientId: verified.clientId,
      };
      next();
    })
    .catch((err: unknown) => {
      if (isDataPilotError(err)) {
        res.status(err.statusCode).json({
          error: 'invalid_token',
          error_description: err.message,
        });
      } else {
        res.status(401).json({
          error: 'invalid_token',
          error_description: 'Token validation failed',
        });
      }
    });
}

/**
 * Optional auth — attaches toolContext if token is present but doesn't fail
 * if no token is provided (useful for public health/meta endpoints).
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers['authorization']);

  if (!token) {
    req.toolContext = {
      userId: 'anonymous',
      clientId: 'anonymous',
    };
    next();
    return;
  }

  verifyToken(token)
    .then((verified) => {
      req.verifiedToken = verified;
      req.toolContext = {
        userId: verified.sub,
        clientId: verified.clientId,
      };
      next();
    })
    .catch(() => {
      // Invalid token = treat as anonymous
      req.toolContext = {
        userId: 'anonymous',
        clientId: 'anonymous',
      };
      next();
    });
}

// ─── Error handler for auth errors ───────────────────────────────────────────

export function authErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof AuthenticationError) {
    res.status(401).json({
      error: 'authentication_required',
      error_description: err.message,
    });
    return;
  }
  next(err);
}
