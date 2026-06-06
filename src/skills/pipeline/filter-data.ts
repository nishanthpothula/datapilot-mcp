/**
 * Tool: filter_data
 * Skill: pipeline
 *
 * Apply filter conditions to a dataset and return matching rows.
 * Conditions are expressed as a structured filter spec — no raw SQL needed.
 * Safe alternative to query_sql for non-technical callers.
 */

import { z } from 'zod';
import { parseInput } from '../../utils/validators.js';
import { runQuery, listTables } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { DatasetNotFoundError, isDataPilotError } from '../../utils/errors.js';

const ConditionSchema = z.object({
  field: z.string().min(1).describe('Column name'),
  operator: z
    .enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'in', 'is_null', 'is_not_null'])
    .describe('Comparison operator'),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
    .optional()
    .describe('Value to compare against (not needed for is_null/is_not_null)'),
});

const InputSchema = z.object({
  dataset: z.string().min(1).describe('Dataset name'),
  filters: z
    .array(ConditionSchema)
    .min(1)
    .max(20)
    .describe('Filter conditions (all must match — AND logic)'),
  logic: z
    .enum(['and', 'or'])
    .default('and')
    .describe('Combine filters with AND (all must match) or OR (any must match)'),
  columns: z
    .array(z.string())
    .optional()
    .describe('Columns to return (all if omitted)'),
  limit: z.number().int().min(1).max(1000).default(200),
  offset: z.number().int().min(0).default(0),
});

type Condition = z.infer<typeof ConditionSchema>;

function conditionToSql(c: Condition, params: unknown[]): string {
  const field = `"${c.field}"`;

  switch (c.operator) {
    case 'eq':
      params.push(c.value);
      return `${field} = ?`;
    case 'neq':
      params.push(c.value);
      return `${field} != ?`;
    case 'gt':
      params.push(c.value);
      return `${field} > ?`;
    case 'gte':
      params.push(c.value);
      return `${field} >= ?`;
    case 'lt':
      params.push(c.value);
      return `${field} < ?`;
    case 'lte':
      params.push(c.value);
      return `${field} <= ?`;
    case 'contains':
      params.push(`%${String(c.value)}%`);
      return `${field} LIKE ?`;
    case 'starts_with':
      params.push(`${String(c.value)}%`);
      return `${field} LIKE ?`;
    case 'ends_with':
      params.push(`%${String(c.value)}`);
      return `${field} LIKE ?`;
    case 'in': {
      const vals = Array.isArray(c.value) ? c.value : [c.value];
      vals.forEach((v) => params.push(v));
      return `${field} IN (${vals.map(() => '?').join(', ')})`;
    }
    case 'is_null':
      return `${field} IS NULL`;
    case 'is_not_null':
      return `${field} IS NOT NULL`;
  }
}

export const filterDataHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    const allTables = listTables();
    if (!allTables.includes(params.dataset)) {
      throw new DatasetNotFoundError(params.dataset);
    }

    const sqlParams: unknown[] = [];
    const conditions = params.filters.map((f) => conditionToSql(f, sqlParams));
    const whereClause = conditions.join((params.logic ?? 'and') === 'or' ? ' OR ' : ' AND ');

    const selectClause =
      params.columns && params.columns.length > 0
        ? params.columns.map((c) => `"${c}"`).join(', ')
        : '*';

    const limit = params.limit ?? 200;
    const offset = params.offset ?? 0;

    const sql = `
      SELECT ${selectClause}
      FROM "${params.dataset}"
      WHERE ${whereClause}
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const rawRows = runQuery(sql, sqlParams);
    const truncated = rawRows.length > limit;
    const rows = truncated ? rawRows.slice(0, limit) : rawRows;

    return successResponse(
      {
        dataset: params.dataset,
        rows,
        rowCount: rows.length,
        truncated,
        filtersApplied: params.filters.length,
        logic: params.logic,
      },
      {
        tool: 'filter_data',
        skill: 'pipeline',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
        pagination: {
          limit,
          offset,
          hasMore: truncated,
        },
      },
    );
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'FILTER_FAILED';
    const message = err instanceof Error ? err.message : 'Filter operation failed';
    return errorResponse(code, message, {
      tool: 'filter_data',
      skill: 'pipeline',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const filterDataSpec = {
  name: 'filter_data',
  description:
    'Filter a dataset by applying structured conditions without writing SQL. ' +
    'Supports equality, comparison, string matching, null checks, and IN list operators. ' +
    'Conditions are combined with AND or OR logic.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dataset: { type: 'string', description: 'Dataset name' },
      filters: {
        type: 'array',
        description: 'Filter conditions',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Column name' },
            operator: {
              type: 'string',
              enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'in', 'is_null', 'is_not_null'],
              description: 'Comparison operator',
            },
            value: {
              description: 'Comparison value (omit for is_null/is_not_null)',
            },
          },
          required: ['field', 'operator'],
        },
      },
      logic: {
        type: 'string',
        enum: ['and', 'or'],
        default: 'and',
        description: 'Combine filters with AND or OR',
      },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to return (all if omitted)',
      },
      limit: { type: 'number', default: 200, description: 'Max rows to return' },
      offset: { type: 'number', default: 0, description: 'Row offset for pagination' },
    },
    required: ['dataset', 'filters'],
  },
};
