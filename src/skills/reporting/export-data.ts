/**
 * Tool: export_data
 * Skill: reporting
 *
 * Export query results as CSV or JSON strings.
 * Clients can write the output to a file or stream it.
 */

import { z } from 'zod';
import { parseInput, assertSafeQuery } from '../../utils/validators.js';
import { runQuery } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { isDataPilotError } from '../../utils/errors.js';

const InputSchema = z.object({
  sql: z.string().min(1).describe('SQL SELECT query to export'),
  format: z
    .enum(['csv', 'json', 'jsonl'])
    .default('csv')
    .describe('"csv" = comma-separated, "json" = JSON array, "jsonl" = JSON Lines (one object per line)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1000)
    .describe('Maximum rows to export (default 1000, max 10000)'),
  include_header: z
    .boolean()
    .default(true)
    .describe('Include header row (CSV only)'),
  filename_hint: z
    .string()
    .optional()
    .describe('Suggested filename (without extension) for the export'),
});

function toCsv(rows: Record<string, unknown>[], includeHeader: boolean): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);

  const escapeCsv = (val: unknown): string => {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines: string[] = [];
  if (includeHeader) lines.push(cols.map(escapeCsv).join(','));
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCsv(row[c])).join(','));
  }
  return lines.join('\n');
}

export const exportDataHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);
    assertSafeQuery(params.sql);

    const rows = runQuery(`
      SELECT * FROM (${params.sql.replace(/;+\s*$/, '')}) AS __export
      LIMIT ${params.limit}
    `);

    let content: string;
    let mimeType: string;
    const extension = params.format === 'jsonl' ? 'jsonl' : params.format;

    if (params.format === 'csv') {
      content = toCsv(rows, params.include_header ?? true);
      mimeType = 'text/csv';
    } else if (params.format === 'jsonl') {
      content = rows.map((r) => JSON.stringify(r)).join('\n');
      mimeType = 'application/x-ndjson';
    } else {
      content = JSON.stringify(rows, null, 2);
      mimeType = 'application/json';
    }

    const suggestedFilename = `${params.filename_hint ?? 'export'}.${extension}`;
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    return successResponse(
      {
        content,
        format: params.format,
        mimeType,
        rowCount: rows.length,
        columnCount: rows.length > 0 ? Object.keys(rows[0]).length : 0,
        sizeBytes,
        suggestedFilename,
        truncated: rows.length === params.limit,
      },
      {
        tool: 'export_data',
        skill: 'reporting',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      },
    );
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'EXPORT_FAILED';
    const message = err instanceof Error ? err.message : 'Export failed';
    return errorResponse(code, message, {
      tool: 'export_data',
      skill: 'reporting',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const exportDataSpec = {
  name: 'export_data',
  description:
    'Export SQL query results as CSV, JSON, or JSON Lines (JSONL). ' +
    'Returns the formatted content as a string along with metadata. ' +
    'Clients can save the content to a file or pipe it to another system.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sql: { type: 'string', description: 'Read-only SQL query to export' },
      format: {
        type: 'string',
        enum: ['csv', 'json', 'jsonl'],
        default: 'csv',
        description: 'Export format',
      },
      limit: {
        type: 'number',
        description: 'Max rows to export (1–10000)',
        default: 1000,
      },
      include_header: {
        type: 'boolean',
        default: true,
        description: 'Include CSV header row',
      },
      filename_hint: {
        type: 'string',
        description: 'Suggested filename without extension',
      },
    },
    required: ['sql'],
  },
};
