/**
 * Tool: generate_chart_config
 * Skill: reporting
 *
 * Generate a Vega-Lite chart specification from a SQL query result.
 * Supports bar, line, scatter, pie, and histogram chart types.
 */

import { z } from 'zod';
import { parseInput, assertSafeQuery } from '../../utils/validators.js';
import { runQuery } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { ChartConfig } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { isDataPilotError } from '../../utils/errors.js';

const InputSchema = z.object({
  sql: z.string().min(1).describe('SQL SELECT query whose results will be visualized'),
  chart_type: z
    .enum(['bar', 'line', 'scatter', 'pie', 'histogram'])
    .describe('Chart type'),
  x_field: z.string().describe('Column to use as the X axis or category'),
  y_field: z
    .string()
    .optional()
    .describe('Column to use as the Y axis (not needed for histogram)'),
  color_field: z
    .string()
    .optional()
    .describe('Column to use for color encoding (optional)'),
  title: z.string().optional().describe('Chart title'),
  description: z.string().optional().describe('Chart description'),
  width: z.number().int().min(200).max(1200).default(600),
  height: z.number().int().min(150).max(800).default(350),
  sort: z
    .enum(['ascending', 'descending', 'none'])
    .default('none')
    .describe('Sort order for categorical axis'),
  aggregate: z
    .enum(['sum', 'mean', 'count', 'min', 'max', 'none'])
    .default('none')
    .describe('Aggregation to apply to the Y field'),
  limit: z.number().int().min(1).max(500).default(200),
});

export const generateChartConfigHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);
    assertSafeQuery(params.sql);

    const rows = runQuery(`
      SELECT * FROM (${params.sql.replace(/;+\s*$/, '')}) AS __chart_data
      LIMIT ${params.limit}
    `);

    if (rows.length === 0) {
      return errorResponse('NO_DATA', 'Query returned no rows to visualize', {
        tool: 'generate_chart_config',
        skill: 'reporting',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      });
    }

    const title = params.title ?? `${params.chart_type.charAt(0).toUpperCase() + params.chart_type.slice(1)} Chart`;

    // Build Vega-Lite spec
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec: Record<string, any> = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      title: {
        text: title,
        fontSize: 16,
        fontWeight: 'bold',
      },
      description: params.description ?? '',
      width: params.width,
      height: params.height,
      data: { values: rows },
      config: {
        view: { stroke: null },
        axis: { labelFontSize: 12, titleFontSize: 13 },
      },
    };

    // Encoding helpers
    const xEncoding: Record<string, unknown> = { field: params.x_field };
    const yEncoding: Record<string, unknown> = params.y_field
      ? { field: params.y_field, type: 'quantitative' }
      : {};

    if (params.aggregate !== 'none' && params.y_field) {
      yEncoding['aggregate'] = params.aggregate;
    }

    if (params.sort !== 'none') {
      xEncoding['sort'] = params.sort === 'ascending' ? 'ascending' : 'descending';
    }

    const colorEncoding = params.color_field
      ? { field: params.color_field, type: 'nominal' }
      : undefined;

    switch (params.chart_type) {
      case 'bar':
        spec['mark'] = { type: 'bar', cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 };
        spec['encoding'] = {
          x: { ...xEncoding, type: 'ordinal' },
          y: { ...yEncoding },
          ...(colorEncoding ? { color: colorEncoding } : {}),
          tooltip: [
            { field: params.x_field },
            ...(params.y_field ? [{ field: params.y_field }] : []),
          ],
        };
        break;

      case 'line':
        spec['mark'] = { type: 'line', point: true };
        spec['encoding'] = {
          x: { ...xEncoding, type: 'temporal' },
          y: { ...yEncoding },
          ...(colorEncoding ? { color: colorEncoding } : {}),
        };
        break;

      case 'scatter':
        spec['mark'] = { type: 'point', filled: true, size: 60 };
        spec['encoding'] = {
          x: { ...xEncoding, type: 'quantitative' },
          y: { ...yEncoding },
          ...(colorEncoding ? { color: colorEncoding } : {}),
          tooltip: [
            { field: params.x_field },
            ...(params.y_field ? [{ field: params.y_field }] : []),
          ],
        };
        break;

      case 'pie':
        spec['mark'] = { type: 'arc', innerRadius: 0 };
        spec['encoding'] = {
          theta: { field: params.y_field ?? params.x_field, type: 'quantitative', aggregate: params.aggregate !== 'none' ? params.aggregate : undefined },
          color: { field: params.x_field, type: 'nominal' },
        };
        break;

      case 'histogram':
        spec['mark'] = { type: 'bar' };
        spec['encoding'] = {
          x: { field: params.x_field, type: 'quantitative', bin: true },
          y: { aggregate: 'count', type: 'quantitative' },
        };
        break;
    }

    const result: ChartConfig = {
      type: params.chart_type,
      vegaLiteSpec: spec,
      title,
      description: params.description ?? `${params.chart_type} chart of ${params.x_field}${params.y_field ? ` vs ${params.y_field}` : ''}`,
    };

    return successResponse(result, {
      tool: 'generate_chart_config',
      skill: 'reporting',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'CHART_FAILED';
    const message = err instanceof Error ? err.message : 'Chart generation failed';
    return errorResponse(code, message, {
      tool: 'generate_chart_config',
      skill: 'reporting',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const generateChartConfigSpec = {
  name: 'generate_chart_config',
  description:
    'Generate a Vega-Lite chart specification from the results of a SQL query. ' +
    'Supports bar, line, scatter, pie, and histogram charts. ' +
    'Returns a complete Vega-Lite JSON spec ready to render in any compatible viewer.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sql: { type: 'string', description: 'Read-only SQL query for chart data' },
      chart_type: {
        type: 'string',
        enum: ['bar', 'line', 'scatter', 'pie', 'histogram'],
        description: 'Chart type',
      },
      x_field: { type: 'string', description: 'X axis column' },
      y_field: { type: 'string', description: 'Y axis column (not required for histogram)' },
      color_field: { type: 'string', description: 'Color grouping column (optional)' },
      title: { type: 'string', description: 'Chart title' },
      description: { type: 'string', description: 'Chart description' },
      width: { type: 'number', default: 600, description: 'Width in pixels' },
      height: { type: 'number', default: 350, description: 'Height in pixels' },
      sort: {
        type: 'string',
        enum: ['ascending', 'descending', 'none'],
        default: 'none',
        description: 'Sort direction for categorical axis',
      },
      aggregate: {
        type: 'string',
        enum: ['sum', 'mean', 'count', 'min', 'max', 'none'],
        default: 'none',
        description: 'Aggregation to apply to Y field',
      },
      limit: { type: 'number', default: 200, description: 'Max rows to include in chart data' },
    },
    required: ['sql', 'chart_type', 'x_field'],
  },
};
