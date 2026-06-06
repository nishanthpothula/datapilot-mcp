/**
 * Tool: list_datasets
 * Skill: database
 *
 * List all available datasets (tables) in the DataPilot database,
 * along with row counts and brief descriptions.
 */

import { listTables, getRowCount } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { isDataPilotError } from '../../utils/errors.js';

// Built-in dataset documentation
const DATASET_DOCS: Record<string, { description: string; tags: string[] }> = {
  products: {
    description: 'Product catalog with pricing, categories, inventory, and status.',
    tags: ['catalog', 'ecommerce', 'inventory'],
  },
  customers: {
    description: 'Customer profiles with location, segment, lifetime value, and join dates.',
    tags: ['crm', 'users', 'segments'],
  },
  sales_orders: {
    description: 'E-commerce order records including product, quantity, pricing, status, and channel.',
    tags: ['orders', 'revenue', 'ecommerce'],
  },
  web_events: {
    description: 'Clickstream and analytics events tracking page views, sessions, device, and referrer.',
    tags: ['analytics', 'clickstream', 'sessions'],
  },
  support_tickets: {
    description: 'Customer support ticket data with category, priority, SLA metrics, and satisfaction.',
    tags: ['support', 'crm', 'sla'],
  },
};

export const listDatasetsHandler: ToolHandler = async (_input, context) => {
  const start = Date.now();

  try {
    await context.sendLog?.('info', 'Scanning available datasets...');
    const tableNames = listTables();
    await context.sendLog?.('info', `Found ${tableNames.length} dataset(s): ${tableNames.join(', ')}`);

    const datasets = tableNames.map((name) => {
      let rowCount: number | undefined;
      try {
        rowCount = getRowCount(name);
      } catch {
        rowCount = undefined;
      }

      const doc = DATASET_DOCS[name];

      return {
        name,
        rowCount,
        description: doc?.description ?? 'User dataset',
        tags: doc?.tags ?? [],
        documented: !!doc,
      };
    });

    return successResponse(
      { datasets, datasetCount: datasets.length, rows: datasets },
      {
        tool: 'list_datasets',
        skill: 'database',
        durationMs: Date.now() - start,
        traceId: context.traceRunId,
      },
    );
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'LIST_FAILED';
    const message = err instanceof Error ? err.message : 'Failed to list datasets';
    return errorResponse(code, message, {
      tool: 'list_datasets',
      skill: 'database',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const listDatasetsSpec = {
  name: 'list_datasets',
  description:
    'List all available datasets (tables) in the DataPilot analytics database. ' +
    'Returns dataset names, row counts, descriptions, and tags. ' +
    'Use this to discover what data is available before writing queries.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};
