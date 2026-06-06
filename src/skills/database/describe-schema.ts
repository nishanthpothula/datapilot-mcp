/**
 * Tool: describe_schema
 * Skill: database
 *
 * Return the full schema for one or all datasets:
 * columns, types, nullability, primary keys, and row count.
 */

import { z } from 'zod';
import { parseInput } from '../../utils/validators.js';
import { getDb, getTableInfo, getRowCount, listTables } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { TableSchema, ColumnInfo } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { DatasetNotFoundError, isDataPilotError } from '../../utils/errors.js';

const InputSchema = z.object({
  dataset: z
    .string()
    .optional()
    .describe('Dataset (table) name. If omitted, returns schema for all datasets.'),
  include_indexes: z
    .boolean()
    .default(false)
    .describe('Whether to include index definitions (default false)'),
});

function describeTable(tableName: string, includeIndexes: boolean): TableSchema {
  const allTables = listTables();
  if (!allTables.includes(tableName)) {
    throw new DatasetNotFoundError(tableName);
  }

  const rawColumns = getTableInfo(tableName);
  const columns: ColumnInfo[] = rawColumns.map((col) => ({
    name: col.name,
    type: col.type,
    nullable: col.notnull === 0,
    primaryKey: col.pk > 0,
    defaultValue: col.dflt_value ?? undefined,
  }));

  let indexes: string[] | undefined;
  if (includeIndexes) {
    const db = getDb();
    const rawIndexes = db
      .prepare(`PRAGMA index_list("${tableName}")`)
      .all() as Array<{ name: string; unique: number }>;
    indexes = rawIndexes.map((idx) => `${idx.name}${idx.unique ? ' (UNIQUE)' : ''}`);
  }

  return {
    tableName,
    columns,
    rowCount: getRowCount(tableName),
    indexes,
  };
}

export const describeSchemaHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    if (params.dataset) {
      const schema = describeTable(params.dataset, params.include_indexes ?? false);
      return successResponse(
        { schemas: [schema] },
        {
          tool: 'describe_schema',
          skill: 'database',
          durationMs: Date.now() - start,
          traceId: context.traceRunId,
        },
      );
    } else {
      const tableNames = listTables();
      const schemas = tableNames.map((name) => describeTable(name, params.include_indexes ?? false));
      return successResponse(
        { schemas },
        {
          tool: 'describe_schema',
          skill: 'database',
          durationMs: Date.now() - start,
          traceId: context.traceRunId,
        },
      );
    }
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'SCHEMA_ERROR';
    const message = err instanceof Error ? err.message : 'Failed to describe schema';
    return errorResponse(code, message, {
      tool: 'describe_schema',
      skill: 'database',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const describeSchemaSpec = {
  name: 'describe_schema',
  description:
    'Return the schema (columns, types, constraints, row count) for one or all datasets. ' +
    'Use this to understand the structure of data before querying or analyzing it.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dataset: {
        type: 'string',
        description: 'Dataset name to describe. Omit to get all schemas.',
      },
      include_indexes: {
        type: 'boolean',
        description: 'Include index definitions',
        default: false,
      },
    },
    required: [],
  },
};
