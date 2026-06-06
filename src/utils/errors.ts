/**
 * DataPilot MCP — Error Classes
 *
 * Structured error hierarchy for consistent error handling
 * across all tools and middleware layers.
 */

export class DataPilotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'DataPilotError';
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DataPilotError);
    }
  }
}

// ─── Auth Errors ──────────────────────────────────────────────────────────────

export class AuthenticationError extends DataPilotError {
  constructor(message = 'Authentication required') {
    super('AUTHENTICATION_REQUIRED', message, undefined, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends DataPilotError {
  constructor(message = 'Insufficient permissions') {
    super('AUTHORIZATION_FAILED', message, undefined, 403);
    this.name = 'AuthorizationError';
  }
}

export class InvalidTokenError extends DataPilotError {
  constructor(message = 'Invalid or expired token') {
    super('INVALID_TOKEN', message, undefined, 401);
    this.name = 'InvalidTokenError';
  }
}

export class DcrError extends DataPilotError {
  constructor(message: string, details?: Record<string, string[]>) {
    super('DCR_ERROR', message, details, 400);
    this.name = 'DcrError';
  }
}

// ─── Tool Errors ──────────────────────────────────────────────────────────────

export class ToolNotFoundError extends DataPilotError {
  constructor(toolName: string) {
    super('TOOL_NOT_FOUND', `Tool "${toolName}" is not registered`, undefined, 404);
    this.name = 'ToolNotFoundError';
  }
}

export class ValidationError extends DataPilotError {
  constructor(message: string, details?: Record<string, string[]>) {
    super('VALIDATION_ERROR', message, details, 400);
    this.name = 'ValidationError';
  }
}

// ─── Database Errors ──────────────────────────────────────────────────────────

export class QueryError extends DataPilotError {
  constructor(message: string) {
    super('QUERY_FAILED', message, undefined, 400);
    this.name = 'QueryError';
  }
}

export class DatasetNotFoundError extends DataPilotError {
  constructor(datasetName: string) {
    super('DATASET_NOT_FOUND', `Dataset "${datasetName}" does not exist`, undefined, 404);
    this.name = 'DatasetNotFoundError';
  }
}

export class QueryTimeoutError extends DataPilotError {
  constructor(timeoutMs: number) {
    super('QUERY_TIMEOUT', `Query exceeded the ${timeoutMs}ms timeout limit`, undefined, 408);
    this.name = 'QueryTimeoutError';
  }
}

export class UnsafeQueryError extends DataPilotError {
  constructor(reason: string) {
    super(
      'UNSAFE_QUERY',
      `Query rejected for safety: ${reason}`,
      undefined,
      400,
    );
    this.name = 'UnsafeQueryError';
  }
}

// ─── Type guard ───────────────────────────────────────────────────────────────

export function isDataPilotError(err: unknown): err is DataPilotError {
  return err instanceof DataPilotError;
}
