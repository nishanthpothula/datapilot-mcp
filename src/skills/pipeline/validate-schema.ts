/**
 * Tool: validate_schema
 * Skill: pipeline
 *
 * Validate a sample of dataset rows against a JSON Schema definition.
 * Returns row-level errors and a summary of validation failures.
 */

import { z } from 'zod';
import Ajv from 'ajv';
import { parseInput } from '../../utils/validators.js';
import { runQuery, listTables } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { ValidationResult } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { DatasetNotFoundError, isDataPilotError } from '../../utils/errors.js';

const ajv = new Ajv({ allErrors: true });

const InputSchema = z.object({
  dataset: z.string().min(1).describe('Dataset to validate'),
  schema: z
    .record(z.unknown())
    .describe('JSON Schema (draft-07) to validate rows against'),
  sample_size: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .default(500)
    .describe('Number of rows to validate (default 500)'),
  fail_fast: z
    .boolean()
    .default(false)
    .describe('Stop after first invalid row (default false)'),
});

export const validateSchemaHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    const allTables = listTables();
    if (!allTables.includes(params.dataset)) {
      throw new DatasetNotFoundError(params.dataset);
    }

    // Compile JSON Schema
    let validate: ReturnType<typeof ajv.compile>;
    try {
      validate = ajv.compile(params.schema);
    } catch (e) {
      return errorResponse(
        'INVALID_SCHEMA',
        `JSON Schema is invalid: ${e instanceof Error ? e.message : String(e)}`,
        {
          tool: 'validate_schema',
          skill: 'pipeline',
          durationMs: Date.now() - start,
          traceId: context.traceRunId,
        },
      );
    }

    const rows = runQuery(
      `SELECT * FROM "${params.dataset}" ORDER BY RANDOM() LIMIT ${params.sample_size}`,
    );

    const errors: ValidationResult['errors'] = [];

    for (let i = 0; i < rows.length; i++) {
      const valid = validate(rows[i]);
      if (!valid && validate.errors) {
        for (const err of validate.errors) {
          errors.push({
            rowIndex: i,
            field: err.instancePath.replace(/^\//, '') || (err.params as Record<string, string>)['missingProperty'] || 'root',
            message: err.message ?? 'Validation failed',
            value: err.instancePath ? rows[i][err.instancePath.replace(/^\//, '')] : rows[i],
          });
        }
        if (params.fail_fast) break;
      }
    }

    const invalidRows = new Set(errors.map((e) => e.rowIndex)).size;
    const result: ValidationResult = {
      valid: errors.length === 0,
      errorCount: errors.length,
      errors: errors.slice(0, 200), // cap output
    };

    return successResponse(
      {
        ...result,
        dataset: params.dataset,
        rowsValidated: rows.length,
        invalidRows,
        validRows: rows.length - invalidRows,
        passRate: parseFloat(((rows.length - invalidRows) / rows.length).toFixed(4)),
      },
      {
        tool: 'validate_schema',
        skill: 'pipeline',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      },
    );
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'VALIDATE_FAILED';
    const message = err instanceof Error ? err.message : 'Validation failed';
    return errorResponse(code, message, {
      tool: 'validate_schema',
      skill: 'pipeline',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const validateSchemaSpec = {
  name: 'validate_schema',
  description:
    'Validate dataset rows against a JSON Schema definition. ' +
    'Returns a pass rate, row-level errors, and a validity summary. ' +
    'Use this to check data quality before ingestion or reporting.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dataset: { type: 'string', description: 'Dataset to validate' },
      schema: {
        type: 'object',
        description: 'JSON Schema (draft-07) each row must conform to',
        example: {
          type: 'object',
          required: ['id', 'email'],
          properties: {
            id: { type: 'integer' },
            email: { type: 'string', format: 'email' },
          },
        },
      },
      sample_size: {
        type: 'number',
        default: 500,
        description: 'Rows to validate (1–5000)',
      },
      fail_fast: {
        type: 'boolean',
        default: false,
        description: 'Stop after first invalid row',
      },
    },
    required: ['dataset', 'schema'],
  },
};
