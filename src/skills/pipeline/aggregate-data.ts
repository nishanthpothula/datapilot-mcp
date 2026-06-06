/**
 * Tool: aggregate_data
 * Skill: pipeline
 *
 * Group and aggregate dataset columns without writing SQL.
 * Structured alternative to query_sql for aggregation use cases.
 */

import { z } from 'zod';
import { parseInput } from '../../utils/validators.js';
import { runQuery, listTables } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { DatasetNotFoundError, isDataPilotError } from '../../utils/errors.js';

const AggregateSchema = z.object({
  field: z.string().min(1).describe('Column to aggregate'),
  function: z
    .enum(['sum', 'avg', 'count', 'count_distinct', 'min', 'max'])
    .describe('Aggregation function'),
  alias: z.string().optional().describe('Output column name alias'),
});

const InputSchema = z.object({
  dataset: z.string().min(1).describe('Dataset name'),
  group_by: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe('Columns to group by'),
  aggregations: z
    .array(AggregateSchema)
    .min(1)
    .max(10)
    .describe('Aggregations to compute'),
  having: z
    .object({
      field: z.string(),
      operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
      value: z.number(),
    })
    .optional()
    .describe('Filter groups after aggregation (HAVING clause)'),
  order_by: z
    .string()
    .optional()
    .describe('Column to sort by (use alias if defined)'),
  order_direction: z
    .enum(['asc', 'desc'])
    .default('desc')
    .describe('Sort direction'),
  limit: z.number().int().min(1).max(1000).default(100),
});

const OP_MAP: Record<string, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  eq: '=',
};

export const aggregateDataHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    const allTables = listTables();
    if (!allTables.includes(params.dataset)) {
      throw new DatasetNotFoundError(params.dataset);
    }

    // Build SELECT clause
    const groupCols = params.group_by.map((c) => `"${c}"`).join(', ');
    const aggCols = params.aggregations.map((a) => {
      const fn =
        a.function === 'count_distinct'
          ? `COUNT(DISTINCT "${a.field}")`
          : `${a.function.toUpperCase()}("${a.field}")`;
      const alias = a.alias ?? `${a.function}_${a.field}`;
      return `${fn} AS "${alias}"`;
    });

    const selectClause = `${groupCols}, ${aggCols.join(', ')}`;

    // HAVING clause
    let havingClause = '';
    const havingParams: unknown[] = [];
    if (params.having) {
      const h = params.having;
      const op = OP_MAP[h.operator];
      havingClause = `HAVING "${h.field}" ${op} ?`;
      havingParams.push(h.value);
    }

    // ORDER BY
    const orderDir = (params.order_direction ?? 'desc').toUpperCase();
    const orderByClause = params.order_by
      ? `ORDER BY "${params.order_by}" ${orderDir}`
      : `ORDER BY ${aggCols[0].split(' AS ')[1].replace(/"/g, '')} ${orderDir}`;

    const sql = `
      SELECT ${selectClause}
      FROM "${params.dataset}"
      GROUP BY ${groupCols}
      ${havingClause}
      ${orderByClause}
      LIMIT ${params.limit}
    `;

    const rows = runQuery(sql, havingParams);

    return successResponse(
      {
        dataset: params.dataset,
        rows,
        rowCount: rows.length,
        groupBy: params.group_by,
        aggregations: params.aggregations.map((a) => ({
          ...a,
          alias: a.alias ?? `${a.function}_${a.field}`,
        })),
      },
      {
        tool: 'aggregate_data',
        skill: 'pipeline',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      },
    );
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'AGGREGATE_FAILED';
    const message = err instanceof Error ? err.message : 'Aggregation failed';
    return errorResponse(code, message, {
      tool: 'aggregate_data',
      skill: 'pipeline',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const aggregateDataSpec = {
  name: 'aggregate_data',
  description:
    'Group and aggregate dataset columns using sum, avg, count, min, max, or count_distinct — without writing SQL. ' +
    'Supports HAVING filters on aggregate results and custom ordering.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dataset: { type: 'string', description: 'Dataset name' },
      group_by: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to group by (1–10)',
      },
      aggregations: {
        type: 'array',
        description: 'Aggregations to compute',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Column to aggregate' },
            function: {
              type: 'string',
              enum: ['sum', 'avg', 'count', 'count_distinct', 'min', 'max'],
            },
            alias: { type: 'string', description: 'Output column alias' },
          },
          required: ['field', 'function'],
        },
      },
      having: {
        type: 'object',
        description: 'Post-aggregation filter',
        properties: {
          field: { type: 'string', description: 'Aggregate column to filter (use alias)' },
          operator: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq'] },
          value: { type: 'number' },
        },
        required: ['field', 'operator', 'value'],
      },
      order_by: { type: 'string', description: 'Column to sort by' },
      order_direction: {
        type: 'string',
        enum: ['asc', 'desc'],
        default: 'desc',
        description: 'Sort direction',
      },
      limit: { type: 'number', default: 100, description: 'Max rows to return' },
    },
    required: ['dataset', 'group_by', 'aggregations'],
  },
};
