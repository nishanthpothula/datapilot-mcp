/**
 * Tool: compute_statistics
 * Skill: exploration
 *
 * Compute descriptive statistics for columns in a dataset:
 * count, nulls, min, max, mean, median, stddev, percentiles, top values.
 */

import { z } from 'zod';
import { parseInput, isNumericColumn, toNumber } from '../../utils/validators.js';
import { runQuery, listTables } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { StatisticsResult } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { DatasetNotFoundError, isDataPilotError } from '../../utils/errors.js';

const InputSchema = z.object({
  dataset: z.string().min(1).describe('Dataset name'),
  columns: z
    .array(z.string())
    .optional()
    .describe('Columns to analyze. If omitted, all columns are analyzed.'),
  sample_size: z
    .number()
    .int()
    .min(100)
    .max(10000)
    .default(5000)
    .describe('Max rows to sample for statistics (default 5000)'),
  include_top_values: z
    .boolean()
    .default(true)
    .describe('Include top 5 most frequent values per column'),
});

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - idx) + sorted[upper] * (idx - lower);
}

function computeColumnStats(
  columnName: string,
  rows: Record<string, unknown>[],
  includeTopValues: boolean,
): StatisticsResult {
  const allValues = rows.map((r) => r[columnName]);
  const nonNull = allValues.filter((v) => v !== null && v !== undefined);
  const nullCount = allValues.length - nonNull.length;
  const unique = new Set(nonNull.map(String)).size;

  const numeric = isNumericColumn(nonNull);
  let mean: number | undefined;
  let median: number | undefined;
  let stdDev: number | undefined;
  let percentiles: StatisticsResult['percentiles'];
  let min: number | string | undefined;
  let max: number | string | undefined;

  if (numeric && nonNull.length > 0) {
    const nums = nonNull.map((v) => toNumber(v)!).filter((v) => v !== null);
    nums.sort((a, b) => a - b);
    min = nums[0];
    max = nums[nums.length - 1];
    mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    median = percentile(nums, 50);
    const variance =
      nums.reduce((sum, v) => sum + Math.pow(v - mean!, 2), 0) / nums.length;
    stdDev = Math.sqrt(variance);
    percentiles = {
      p25: percentile(nums, 25),
      p75: percentile(nums, 75),
      p95: percentile(nums, 95),
    };
  } else if (nonNull.length > 0) {
    const strs = nonNull.map(String).sort();
    min = strs[0];
    max = strs[strs.length - 1];
  }

  let topValues: StatisticsResult['topValues'];
  if (includeTopValues) {
    const freq = new Map<string, number>();
    for (const v of nonNull) {
      const key = String(v);
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    topValues = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  }

  return {
    column: columnName,
    dataType: numeric ? 'numeric' : 'text',
    count: nonNull.length,
    nullCount,
    uniqueCount: unique,
    min,
    max,
    mean: mean !== undefined ? parseFloat(mean.toFixed(4)) : undefined,
    median: median !== undefined ? parseFloat(median.toFixed(4)) : undefined,
    stdDev: stdDev !== undefined ? parseFloat(stdDev.toFixed(4)) : undefined,
    percentiles,
    topValues,
  };
}

export const computeStatisticsHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    const allTables = listTables();
    if (!allTables.includes(params.dataset)) {
      throw new DatasetNotFoundError(params.dataset);
    }

    const sampleSql = `SELECT * FROM "${params.dataset}" ORDER BY RANDOM() LIMIT ${params.sample_size}`;
    const rows = runQuery(sampleSql);

    if (rows.length === 0) {
      return successResponse(
        { dataset: params.dataset, statistics: [], rowsSampled: 0 },
        { tool: 'compute_statistics', skill: 'exploration', durationMs: Date.now() - start, traceId: context.traceRunId },
      );
    }

    const allColumns = Object.keys(rows[0]);
    const targetColumns = params.columns
      ? params.columns.filter((c) => allColumns.includes(c))
      : allColumns;

    const statistics: StatisticsResult[] = [];
    for (let i = 0; i < targetColumns.length; i++) {
      await context.sendProgress?.(i, targetColumns.length, `Analyzing column: ${targetColumns[i]}`);
      statistics.push(computeColumnStats(targetColumns[i], rows, params.include_top_values ?? true));
    }
    await context.sendProgress?.(targetColumns.length, targetColumns.length, 'Statistics complete');

    return successResponse(
      {
        dataset: params.dataset,
        statistics,
		rows: statistics,
        rowsSampled: rows.length,
        columnsAnalyzed: targetColumns.length,
      },
      {
        tool: 'compute_statistics',
        skill: 'exploration',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      },
    );
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'STATISTICS_FAILED';
    const message = err instanceof Error ? err.message : 'Failed to compute statistics';
    return errorResponse(code, message, {
      tool: 'compute_statistics',
      skill: 'exploration',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const computeStatisticsSpec = {
  name: 'compute_statistics',
  description:
    'Compute descriptive statistics for columns in a dataset: count, null rate, min, max, mean, median, ' +
    'standard deviation, percentiles, and top values. Works on numeric and categorical columns.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dataset: { type: 'string', description: 'Dataset name' },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to analyze (all if omitted)',
      },
      sample_size: {
        type: 'number',
        description: 'Max rows to sample (100–10000)',
        default: 5000,
      },
      include_top_values: {
        type: 'boolean',
        description: 'Include top 5 most frequent values',
        default: true,
      },
    },
    required: ['dataset'],
  },
};
