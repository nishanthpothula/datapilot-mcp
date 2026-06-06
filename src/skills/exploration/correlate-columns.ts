/**
 * Tool: correlate_columns
 * Skill: exploration
 *
 * Compute Pearson correlation coefficients between numeric column pairs
 * in a dataset. Identifies strong, moderate, and weak correlations.
 */

import { z } from 'zod';
import { parseInput, isNumericColumn, toNumber } from '../../utils/validators.js';
import { runQuery, listTables } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { CorrelationResult } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { DatasetNotFoundError, isDataPilotError } from '../../utils/errors.js';

const InputSchema = z.object({
  dataset: z.string().min(1).describe('Dataset name'),
  columns: z
    .array(z.string())
    .min(2)
    .max(20)
    .optional()
    .describe('Columns to correlate. If omitted, all numeric columns are used (max 20).'),
  sample_size: z
    .number()
    .int()
    .min(100)
    .max(10000)
    .default(5000)
    .describe('Max rows to sample'),
  min_absolute_r: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe('Only return pairs with |r| >= this value (0 = all pairs)'),
});

function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function strengthLabel(r: number): CorrelationResult['pairs'][0]['strength'] {
  const abs = Math.abs(r);
  if (abs >= 0.7) return 'strong';
  if (abs >= 0.4) return 'moderate';
  if (abs >= 0.1) return 'weak';
  return 'negligible';
}

function directionLabel(r: number): CorrelationResult['pairs'][0]['direction'] {
  if (r > 0.05) return 'positive';
  if (r < -0.05) return 'negative';
  return 'none';
}

export const correlateColumnsHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    const allTables = listTables();
    if (!allTables.includes(params.dataset)) {
      throw new DatasetNotFoundError(params.dataset);
    }

    const rows = runQuery(
      `SELECT * FROM "${params.dataset}" ORDER BY RANDOM() LIMIT ${params.sample_size}`,
    );

    if (rows.length === 0) {
      return successResponse(
        { dataset: params.dataset, pairs: [], numericColumns: [] },
        {
          tool: 'correlate_columns',
          skill: 'exploration',
          durationMs: Date.now() - start,
          traceId: context.traceRunId,
        },
      );
    }

    const allColumns = Object.keys(rows[0]);

    // Determine which columns to use
    const candidateColumns = params.columns
      ? params.columns.filter((c) => allColumns.includes(c))
      : allColumns.slice(0, 20);

    // Filter to numeric only
    const numericColumns = candidateColumns.filter((col) => {
      const vals = rows.map((r) => r[col]).filter((v) => v !== null);
      return isNumericColumn(vals);
    });

    if (numericColumns.length < 2) {
      return errorResponse('INSUFFICIENT_NUMERIC_COLUMNS', 'Need at least 2 numeric columns to correlate', {
        tool: 'correlate_columns',
        skill: 'exploration',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      });
    }

    // Build numeric value arrays (only rows where both are non-null)
    const pairs: CorrelationResult['pairs'] = [];

    for (let i = 0; i < numericColumns.length; i++) {
      for (let j = i + 1; j < numericColumns.length; j++) {
        const colA = numericColumns[i];
        const colB = numericColumns[j];

        const paired = rows
          .map((r) => ({ a: toNumber(r[colA]), b: toNumber(r[colB]) }))
          .filter((p): p is { a: number; b: number } => p.a !== null && p.b !== null);

        if (paired.length < 10) continue;

        const r = parseFloat(
          pearsonR(
            paired.map((p) => p.a),
            paired.map((p) => p.b),
          ).toFixed(4),
        );

        if (Math.abs(r) < (params.min_absolute_r ?? 0)) continue;

        pairs.push({
          columnA: colA,
          columnB: colB,
          pearsonR: r,
          strength: strengthLabel(r),
          direction: directionLabel(r),
        });
      }
    }

    // Sort by absolute correlation descending
    pairs.sort((a, b) => Math.abs(b.pearsonR) - Math.abs(a.pearsonR));

    const result: CorrelationResult = { pairs };

    return successResponse(
      { dataset: params.dataset, numericColumns, ...result },
      {
        tool: 'correlate_columns',
        skill: 'exploration',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      },
    );
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'CORRELATION_FAILED';
    const message = err instanceof Error ? err.message : 'Correlation analysis failed';
    return errorResponse(code, message, {
      tool: 'correlate_columns',
      skill: 'exploration',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const correlateColumnsSpec = {
  name: 'correlate_columns',
  description:
    'Compute Pearson correlation coefficients between numeric columns in a dataset. ' +
    'Returns all column pairs with correlation strength and direction. ' +
    'Useful for understanding relationships between variables before modeling.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dataset: { type: 'string', description: 'Dataset name' },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to include (all numeric if omitted, max 20)',
      },
      sample_size: {
        type: 'number',
        description: 'Max rows to sample',
        default: 5000,
      },
      min_absolute_r: {
        type: 'number',
        description: 'Minimum |r| to include in results (0 = all)',
        default: 0,
      },
    },
    required: ['dataset'],
  },
};
