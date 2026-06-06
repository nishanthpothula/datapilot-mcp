/**
 * DataPilot MCP — Input Validators
 *
 * Reusable validation helpers for tool inputs.
 * All tools use Zod schemas, but these utilities
 * handle common cross-cutting concerns.
 */

import { z } from 'zod';
import { ValidationError } from './errors.js';

// ─── Parse & validate with Zod ────────────────────────────────────────────────

/**
 * Parse and validate tool input using a Zod schema.
 * Throws a structured ValidationError on failure.
 */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || 'root';
      if (!details[path]) details[path] = [];
      details[path].push(issue.message);
    }
    throw new ValidationError('Input validation failed', details);
  }
  return result.data;
}

// ─── Common schema fragments ──────────────────────────────────────────────────

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
});

export const datasetNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.\-]+$/, 'Dataset name may only contain letters, numbers, underscores, dots, and hyphens');

export const columnNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Column name must be a valid identifier');

// ─── SQL Safety ───────────────────────────────────────────────────────────────

const BLOCKED_SQL_PATTERNS = [
  /\bDROP\b/i,
  /\bDELETE\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bREPLACE\b/i,
  /\bATTACH\b/i,
  /\bDETACH\b/i,
  /\bPRAGMA\s+(?!table_info|index_list|foreign_key_list)/i,
  /\bLOAD_EXTENSION\b/i,
  /;\s*\S/,                // Semicolon-terminated statements (multi-statement)
];

/**
 * Validate that a SQL string is a read-only SELECT query.
 * Throws UnsafeQueryError if any write or DDL patterns are found.
 */
export function assertSafeQuery(sql: string): void {
  const trimmed = sql.trim();

  if (!/^SELECT\s/i.test(trimmed) && !/^WITH\s/i.test(trimmed)) {
    const { UnsafeQueryError } = require('./errors.js') as typeof import('./errors.js');
    throw new UnsafeQueryError('Only SELECT and WITH...SELECT queries are allowed');
  }

  for (const pattern of BLOCKED_SQL_PATTERNS) {
    if (pattern.test(trimmed)) {
      const { UnsafeQueryError } = require('./errors.js') as typeof import('./errors.js');
      throw new UnsafeQueryError(`Blocked pattern detected: ${pattern.source}`);
    }
  }
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isNumericColumn(values: unknown[]): boolean {
  const sample = values.filter((v) => v !== null && v !== undefined).slice(0, 100);
  if (sample.length === 0) return false;
  return sample.every((v) => typeof v === 'number' || !isNaN(Number(v)));
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return isNaN(n) ? null : n;
  }
  return null;
}
