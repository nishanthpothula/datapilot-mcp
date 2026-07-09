/**
 * DataPilot MCP — Dynamic Client Registration (DCR)
 *
 * Implements RFC 7591 — OAuth 2.0 Dynamic Client Registration Protocol.
 *
 * Flow:
 *   POST /oauth/register
 *     Body: { client_name, redirect_uris?, grant_types?, scope? }
 *     Headers: Authorization: Bearer <dcr-registration-secret>
 *   Response: { client_id, client_secret, client_name, ... }
 *
 * Under the hood, this creates a Machine-to-Machine app in Auth0
 * via the Management API. The returned client_id + client_secret
 * can then be used to obtain tokens via client_credentials flow.
 */

import { z } from 'zod';
import { parseInput } from '../utils/validators.js';
import { DcrError, AuthenticationError } from '../utils/errors.js';

// ─── Schema ───────────────────────────────────────────────────────────────────

const DcrRequestSchema = z.object({
  client_name: z.string().min(1).max(100),
  redirect_uris: z.array(z.string().url()).optional().default([]),
  grant_types: z
    .array(z.enum(['client_credentials', 'authorization_code', 'refresh_token']))
    .optional()
    .default(['client_credentials']),
  scope: z.string().optional().default('datapilot:read'),
  token_endpoint_auth_method: z
    .enum(['client_secret_basic', 'client_secret_post', 'none'])
    .optional()
    .default('client_secret_basic'),
  contacts: z.array(z.string().email()).optional(),
  logo_uri: z.string().url().optional(),
  client_uri: z.string().url().optional(),
  description: z.string().max(500).optional(),
});

export type DcrRequest = z.infer<typeof DcrRequestSchema>;

export interface DcrResponse {
  client_id: string;
  client_secret: string;
  client_name: string;
  grant_types: string[];
  redirect_uris: string[];
  scope: string;
  token_endpoint: string;
  registration_client_uri: string;
  client_id_issued_at: number;
  client_secret_expires_at: number;
}

// ─── Auth0 Management API ─────────────────────────────────────────────────────

interface Auth0ClientResponse {
  client_id: string;
  client_secret: string;
  name: string;
  grant_types: string[];
  redirect_uris: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

async function getManagementApiToken(): Promise<string> {
  const domain = process.env['AUTH0_DOMAIN'];
  const clientId = process.env['AUTH0_CLIENT_ID'];
  const clientSecret = process.env['AUTH0_CLIENT_SECRET'];

  if (!domain || !clientId || !clientSecret) {
    throw new DcrError('Auth0 Management API not configured');
  }

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${domain}/api/v2/`,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new DcrError(`Failed to get management token: ${body}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function createAuth0Client(
  request: DcrRequest,
  mgmtToken: string,
): Promise<Auth0ClientResponse> {
  const domain = process.env['AUTH0_DOMAIN'];

  // Interactive (browser login) vs machine-to-machine. mcp-remote requests
  // authorization_code for the browser OAuth flow; CLI/M2M clients request
  // client_credentials. Auth0's app_type governs which flows are permitted:
  //   non_interactive → client_credentials only (M2M, confidential)
  //   spa             → authorization_code + PKCE, public (no secret)
  //   regular_web     → authorization_code, confidential (uses client_secret)
  const isInteractive = request.grant_types.includes('authorization_code');
  const isPublic = request.token_endpoint_auth_method === 'none';
  const appType = !isInteractive
    ? 'non_interactive'
    : isPublic
      ? 'spa'
      : 'regular_web';

  const res = await fetch(`https://${domain}/api/v2/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgmtToken}`,
    },
    body: JSON.stringify({
      name: request.client_name,
      description: request.description ?? `Registered via DataPilot DCR`,
      app_type: appType,
      grant_types: request.grant_types,
      callbacks: request.redirect_uris,
      token_endpoint_auth_method: request.token_endpoint_auth_method,
      oidc_conformant: true,
      logo_uri: request.logo_uri,
      // Interactive clients must be first-party so Auth0 will mint a JWT for our
      // custom API audience during the browser login flow. Third-party (tpc_)
      // clients are restricted to OIDC scopes and would be denied the audience.
      // M2M clients get API access via a client-grant instead, so first-party
      // is unnecessary there.
      is_first_party: isInteractive,
    }),
  });

  if (!res.ok) {
    const body = (await res.json()) as { message?: string };
    throw new DcrError(body.message ?? 'Failed to create Auth0 client');
  }

  return res.json() as Promise<Auth0ClientResponse>;
}

async function createClientGrant(clientId: string, mgmtToken: string): Promise<void> {
  const domain = process.env['AUTH0_DOMAIN'];
  const audience = process.env['AUTH0_AUDIENCE'];

  if (!audience) throw new DcrError('AUTH0_AUDIENCE not configured');

  const res = await fetch(`https://${domain}/api/v2/client-grants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgmtToken}`,
    },
    body: JSON.stringify({
      client_id: clientId,
      audience,
      scope: [],
    }),
  });

  if (!res.ok) {
    const body = (await res.json()) as { message?: string };
    throw new DcrError(body.message ?? 'Failed to create client grant');
  }
}

// ─── Registration handler ─────────────────────────────────────────────────────

/**
 * Validate the registration secret from the Authorization header.
 * Clients must send: Authorization: Bearer <DCR_REGISTRATION_SECRET>
 */
export function validateRegistrationSecret(authHeader?: string): void {
  const secret = process.env['DCR_REGISTRATION_SECRET'];

  // In dev mode without a secret, allow open registration
  if (!secret && process.env['NODE_ENV'] === 'development') return;

  if (!authHeader) throw new AuthenticationError('Registration requires Authorization header');

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    throw new AuthenticationError('Invalid Authorization header format');
  }

  if (parts[1] !== secret) {
    throw new AuthenticationError('Invalid registration secret');
  }
}

/**
 * Register a new MCP client dynamically.
 * Creates the client in Auth0 and returns credentials.
 */
export async function registerClient(rawBody: unknown): Promise<DcrResponse> {
  const request = parseInput(DcrRequestSchema, rawBody);

  const domain = process.env['AUTH0_DOMAIN'];

  // In dev mode without Auth0 configured, return a mock response
  if (!domain && process.env['NODE_ENV'] === 'development') {
    return {
      client_id: `dev_${Math.random().toString(36).slice(2, 10)}`,
      client_secret: `dev_secret_${Math.random().toString(36).slice(2, 18)}`,
      client_name: request.client_name,
      grant_types: request.grant_types ?? ['client_credentials'],
      redirect_uris: request.redirect_uris ?? [],
      scope: request.scope ?? 'datapilot:read',
      token_endpoint: 'http://localhost:3000/oauth/token',
      registration_client_uri: 'http://localhost:3000/oauth/register',
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0, // 0 = never expires
    };
  }

  const mgmtToken = await getManagementApiToken();
  // Normalize request — apply defaults that Zod may not expose in the inferred type
  const normalizedRequest = {
    ...request,
    scope: request.scope ?? 'datapilot:read',
    redirect_uris: request.redirect_uris ?? [],
    grant_types: request.grant_types ?? (['client_credentials'] as const),
    token_endpoint_auth_method: request.token_endpoint_auth_method ?? ('client_secret_basic' as const),
  };
  const client = await createAuth0Client(normalizedRequest, mgmtToken);

  // client-grants pre-authorize an API for the client_credentials (M2M) flow.
  // Interactive authorization_code clients obtain the audience via the /authorize
  // request instead, so a client-grant is unnecessary (and rejected for SPAs).
  if (normalizedRequest.grant_types.includes('client_credentials')) {
    await createClientGrant(client.client_id, mgmtToken);
  }

  return {
    client_id: client.client_id,
    client_secret: client.client_secret,
    client_name: client.name,
    grant_types: (client.grant_types ?? request.grant_types ?? ['client_credentials']),
    redirect_uris: client.redirect_uris ?? request.redirect_uris ?? [],
    scope: request.scope ?? 'datapilot:read',
    token_endpoint: `https://${domain}/oauth/token`,
    registration_client_uri: `${process.env['PUBLIC_URL'] ?? 'http://localhost:3000'}/oauth/register`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
  };
}
