/**
 * DataPilot MCP — OIDC Token Validation
 *
 * Validates Auth0-issued JWTs using JWKS (JSON Web Key Set).
 * Implements the OAuth 2.0 Bearer Token (RFC 6750) pattern.
 *
 * Flow:
 *   1. Client obtains a token from Auth0 (client_credentials or auth code)
 *   2. Client sends: Authorization: Bearer <token>
 *   3. This module fetches Auth0's JWKS, verifies signature, checks claims
 *   4. Verified claims are attached to the request context
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const AUTH0_DOMAIN = process.env['AUTH0_DOMAIN'];
const AUTH0_AUDIENCE = process.env['AUTH0_AUDIENCE'];

if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
  console.warn('[OIDC] AUTH0_DOMAIN or AUTH0_AUDIENCE not set — auth will be skipped in dev mode');
}

// ─── JWKS cache (refreshed automatically by jose) ─────────────────────────────

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!AUTH0_DOMAIN) throw new Error('AUTH0_DOMAIN is not configured');
  if (!_jwks) {
    _jwks = createRemoteJWKSet(
      new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`),
    );
  }
  return _jwks;
}

// ─── Verified token payload ───────────────────────────────────────────────────

export interface VerifiedToken {
  /** JWT subject (user ID or client ID for M2M) */
  sub: string;
  /** Auth0 client ID */
  clientId: string;
  /** Granted scopes */
  scopes: string[];
  /** Auth0 audience */
  audience: string | string[];
  /** Expiry Unix timestamp */
  exp: number;
  /** Raw payload for advanced use */
  raw: JWTPayload;
}

// ─── Verifier ─────────────────────────────────────────────────────────────────

/**
 * Verify a raw JWT string against Auth0's JWKS.
 * Throws InvalidTokenError on any failure.
 */
export async function verifyToken(rawToken: string): Promise<VerifiedToken> {
  const { InvalidTokenError } = await import('../utils/errors.js');

  if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
    // Dev mode: skip verification, return a mock identity
    if (process.env['NODE_ENV'] === 'development') {
      return {
        sub: 'dev-user',
        clientId: 'dev-client',
        scopes: ['datapilot:read', 'datapilot:write'],
        audience: 'http://localhost:3000',
        exp: Math.floor(Date.now() / 1000) + 3600,
        raw: {},
      };
    }
    throw new InvalidTokenError('OIDC not configured');
  }

  try {
    const { payload } = await jwtVerify(rawToken, getJwks(), {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_AUDIENCE,
    });

    const scopes = typeof payload['scope'] === 'string'
      ? payload['scope'].split(' ')
      : [];

    return {
      sub: payload.sub ?? 'unknown',
      clientId: (payload['azp'] as string) ?? (payload['client_id'] as string) ?? 'unknown',
      scopes,
      audience: payload.aud ?? AUTH0_AUDIENCE,
      exp: payload.exp ?? 0,
      raw: payload,
    };
  } catch (err) {
    throw new InvalidTokenError(
      err instanceof Error ? `JWT verification failed: ${err.message}` : 'JWT verification failed',
    );
  }
}

/**
 * Extract the Bearer token from an Authorization header.
 * Returns null if not present or malformed.
 */
export function extractBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null;
  const parts = authorizationHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

/**
 * Check if a verified token has a required scope.
 */
export function hasScope(token: VerifiedToken, requiredScope: string): boolean {
  return token.scopes.includes(requiredScope);
}
