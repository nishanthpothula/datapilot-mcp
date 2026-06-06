/**
 * Tool: query_sql
 * Skill: database
 *
 * Execute a read-only SQL SELECT query against the DataPilot database.
 * Results are paginated and capped for safety.
 */

import { z } from 'zod';
import { parseInput, assertSafeQuery } from '../../utils/validators.js';
import { runQuery } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { QueryResult } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { isDataPilotError } from '../../utils/errors.js';

const MAX_ROWS = 500;

const InputSchema = z.object({
  sql: z
    .string()
    .min(1)
    .max(4000)
    .describe('A read-only SQL SELECT (or WITH...SELECT) query to execute'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_ROWS)
    .default(100)
    .describe('Maximum number of rows to return (1–500, default 100)'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Row offset for pagination (default 0)'),
  timeout_ms: z
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(10_000)
    .describe('Query timeout in milliseconds (default 10000)'),
});

export const querySqlHandler: ToolHandler = async (input, context) => {
  const start = Date.now();
  const meta = {
    tool: 'query_sql',
    skill: 'database' as const,
    traceId: context.traceRunId,
  };

  try {
    const params = parseInput(InputSchema, input);
    assertSafeQuery(params.sql);

    // Inject LIMIT/OFFSET safely into the query
    const paginatedSql = `
      SELECT * FROM (
        ${params.sql.replace(/;+\s*$/, '')}
      ) AS __datapilot_result
      LIMIT ${(params.limit ?? 100) + 1}
      OFFSET ${params.offset ?? 0}
    `;

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const rawRows = runQuery(paginatedSql, [], params.timeout_ms);
    const truncated = rawRows.length > limit;
    const rows = truncated ? rawRows.slice(0, limit) : rawRows;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    const result: QueryResult = {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
    };

    return successResponse(result, {
      tool: 'query_sql',
      skill: 'database',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
      pagination: {
        limit,
        offset,
        hasMore: truncated,
      },
    });
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'QUERY_FAILED';
    const message = err instanceof Error ? err.message : 'Query execution failed';
    return errorResponse(code, message, { ...meta, durationMs: Date.now() - start });
  }
};

export const querySqlSpec = {
  name: 'query_sql',
  description:
    'Execute a read-only SQL SELECT query against the DataPilot analytics database. ' +
    'Supports standard SQLite SQL including JOINs, CTEs, window functions, and aggregates. ' +
    'Only SELECT and WITH...SELECT queries are permitted. Results are paginated.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sql: {
        type: 'string',
        description: 'A read-only SQL SELECT (or WITH...SELECT) query',
        examples: [
          'SELECT * FROM sales_orders LIMIT 10',
          'SELECT category, SUM(total_amount) as revenue FROM sales_orders JOIN products ON product_id = products.id GROUP BY category',
        ],
      },
      limit: {
        type: 'number',
        description: 'Maximum rows to return (1–500)',
        default: 100,
      },
      offset: {
        type: 'number',
        description: 'Row offset for pagination',
        default: 0,
      },
      timeout_ms: {
        type: 'number',
        description: 'Query timeout in milliseconds',
        default: 10000,
      },
    },
    required: ['sql'],
  },
};
