/**
 * Tool: detect_anomalies
 * Skill: exploration
 *
 * Detect outliers in numeric columns using IQR or Z-score methods.
 */

import { z } from 'zod';
import { parseInput, isNumericColumn, toNumber } from '../../utils/validators.js';
import { runQuery, listTables } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { AnomalyResult } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { DatasetNotFoundError, isDataPilotError } from '../../utils/errors.js';

const InputSchema = z.object({
  dataset: z.string().min(1).describe('Dataset name'),
  column: z.string().min(1).describe('Numeric column to check for anomalies'),
  method: z
    .enum(['iqr', 'zscore'])
    .default('iqr')
    .describe('"iqr" = interquartile range (robust), "zscore" = Z-score (assumes normal distribution)'),
  threshold: z
    .number()
    .optional()
    .describe('IQR multiplier (default 1.5) or Z-score cutoff (default 3.0)'),
  sample_size: z
    .number()
    .int()
    .min(100)
    .max(10000)
    .default(5000)
    .describe('Max rows to analyze'),
});

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - idx) + sorted[upper] * (idx - lower);
}

export const detectAnomaliesHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    const allTables = listTables();
    if (!allTables.includes(params.dataset)) {
      throw new DatasetNotFoundError(params.dataset);
    }

    await context.sendLog?.('info', `Running ${(params.method ?? 'iqr').toUpperCase()} anomaly detection on "${params.dataset}.${params.column}"...`);
    await context.sendProgress?.(1, 4, 'Loading data...');
    const rows = runQuery(
      `SELECT rowid, "${params.column}" FROM "${params.dataset}" ORDER BY RANDOM() LIMIT ${params.sample_size}`,
    );

    await context.sendProgress?.(2, 4, 'Validating column type...');
    const values = rows.map((r, i) => ({ index: i, raw: r[params.column], rowid: r['rowid'] }));
    const nonNull = values.filter((v) => v.raw !== null && v.raw !== undefined);

    if (!isNumericColumn(nonNull.map((v) => v.raw))) {
      return errorResponse('NON_NUMERIC_COLUMN', `Column "${params.column}" is not numeric`, {
        tool: 'detect_anomalies',
        skill: 'exploration',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      });
    }

    await context.sendProgress?.(3, 4, `Detecting anomalies (${params.method ?? 'iqr'})...`);
    const nums = nonNull.map((v) => ({ ...v, num: toNumber(v.raw)! }));
    const sorted = [...nums].sort((a, b) => a.num - b.num);
    const sortedNums = sorted.map((v) => v.num);

    let anomalies: AnomalyResult['anomalies'] = [];

    if (params.method === 'iqr') {
      const q1 = percentile(sortedNums, 25);
      const q3 = percentile(sortedNums, 75);
      const iqr = q3 - q1;
      const multiplier = params.threshold ?? 1.5;
      const lower = q1 - multiplier * iqr;
      const upper = q3 + multiplier * iqr;

      anomalies = nums
        .filter((v) => v.num < lower || v.num > upper)
        .map((v) => ({
          rowIndex: v.index,
          value: v.raw,
          score: v.num < lower
            ? parseFloat(((lower - v.num) / iqr).toFixed(3))
            : parseFloat(((v.num - upper) / iqr).toFixed(3)),
          reason: v.num < lower
            ? `Below lower fence (Q1 - ${multiplier}×IQR = ${lower.toFixed(2)})`
            : `Above upper fence (Q3 + ${multiplier}×IQR = ${upper.toFixed(2)})`,
        }));
    } else {
      // Z-score
      const mean = nums.reduce((s, v) => s + v.num, 0) / nums.length;
      const variance = nums.reduce((s, v) => s + Math.pow(v.num - mean, 2), 0) / nums.length;
      const stdDev = Math.sqrt(variance);
      const cutoff = params.threshold ?? 3.0;

      anomalies = nums
        .filter((v) => Math.abs((v.num - mean) / stdDev) > cutoff)
        .map((v) => {
          const z = (v.num - mean) / stdDev;
          return {
            rowIndex: v.index,
            value: v.raw,
            score: parseFloat(Math.abs(z).toFixed(3)),
            reason: `Z-score = ${z.toFixed(3)} (threshold ±${cutoff})`,
          };
        });
    }

    await context.sendProgress?.(4, 4, 'Complete');
    const result: AnomalyResult = {
      column: params.column,
      method: (params.method ?? 'iqr') as 'iqr' | 'zscore' | 'isolation_forest',
      anomalies: anomalies.slice(0, 100), // cap output
      anomalyCount: anomalies.length,
      totalRows: nums.length,
      anomalyRate: parseFloat((anomalies.length / nums.length).toFixed(4)),
    };

    return successResponse(result, {
      tool: 'detect_anomalies',
      skill: 'exploration',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'ANOMALY_FAILED';
    const message = err instanceof Error ? err.message : 'Anomaly detection failed';
    return errorResponse(code, message, {
      tool: 'detect_anomalies',
      skill: 'exploration',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const detectAnomaliesSpec = {
  name: 'detect_anomalies',
  description:
    'Detect outliers and anomalies in a numeric column using IQR or Z-score methods. ' +
    'Returns each anomalous value with its row index, score, and reason.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dataset: { type: 'string', description: 'Dataset name' },
      column: { type: 'string', description: 'Numeric column to analyze' },
      method: {
        type: 'string',
        enum: ['iqr', 'zscore'],
        description: 'Detection method',
        default: 'iqr',
      },
      threshold: {
        type: 'number',
        description: 'IQR multiplier (default 1.5) or Z-score cutoff (default 3.0)',
      },
      sample_size: {
        type: 'number',
        description: 'Max rows to analyze',
        default: 5000,
      },
    },
    required: ['dataset', 'column'],
  },
};
