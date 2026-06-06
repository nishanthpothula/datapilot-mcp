/**
 * Tool: get_sample_data
 * Skill: database
 *
 * Return a sample of rows from a dataset, with optional column filtering.
 * Supports random sampling and head/tail modes.
 */

import { z } from 'zod';
import { parseInput } from '../../utils/validators.js';
import { runQuery, listTables } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { DatasetNotFoundError, isDataPilotError } from '../../utils/errors.js';

const InputSchema = z.object({
  dataset: z.string().min(1).describe('Name of the dataset to sample'),
  n: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(10)
    .describe('Number of rows to return (default 10, max 200)'),
  mode: z
    .enum(['head', 'tail', 'random'])
    .default('head')
    .describe('"head" = first N rows, "tail" = last N rows, "random" = random sample'),
  columns: z
    .array(z.string())
    .optional()
    .describe('Specific columns to include. If omitted, all columns are returned.'),
});

export const getSampleDataHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    const allTables = listTables();
    if (!allTables.includes(params.dataset)) {
      throw new DatasetNotFoundError(params.dataset);
    }

    // Build the SELECT clause
    const selectClause =
      params.columns && params.columns.length > 0
        ? params.columns.map((c) => `"${c}"`).join(', ')
        : '*';

    let sql: string;
    if (params.mode === 'random') {
      sql = `SELECT ${selectClause} FROM "${params.dataset}" ORDER BY RANDOM() LIMIT ${params.n}`;
    } else if (params.mode === 'tail') {
      sql = `SELECT ${selectClause} FROM "${params.dataset}" ORDER BY rowid DESC LIMIT ${params.n}`;
    } else {
      sql = `SELECT ${selectClause} FROM "${params.dataset}" LIMIT ${params.n}`;
    }

    const rows = runQuery(sql);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : (params.columns ?? []);

    return successResponse(
      {
        dataset: params.dataset,
        columns,
        rows,
        rowCount: rows.length,
        mode: params.mode,
      },
      {
        tool: 'get_sample_data',
        skill: 'database',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      },
    );
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'SAMPLE_FAILED';
    const message = err instanceof Error ? err.message : 'Failed to sample data';
    return errorResponse(code, message, {
      tool: 'get_sample_data',
      skill: 'database',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const getSampleDataSpec = {
  name: 'get_sample_data',
  description:
    'Return a sample of rows from a dataset. ' +
    'Supports head (first N), tail (last N), or random sampling modes. ' +
    'Use this to quickly preview data before analysis.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dataset: {
        type: 'string',
        description: 'Dataset name',
      },
      n: {
        type: 'number',
        description: 'Number of rows to return (1–200)',
        default: 10,
      },
      mode: {
        type: 'string',
        enum: ['head', 'tail', 'random'],
        description: 'Sampling mode',
        default: 'head',
      },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to include (all if omitted)',
      },
    },
    required: ['dataset'],
  },
};
