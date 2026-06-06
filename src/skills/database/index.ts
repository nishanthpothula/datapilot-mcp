/**
 * Database Skill — Tool Registry
 */

import { withTracing } from '../../tracing/langsmith.js';
import { querySqlHandler, querySqlSpec } from './query-sql.js';
import { listDatasetsHandler, listDatasetsSpec } from './list-datasets.js';
import { describeSchemaHandler, describeSchemaSpec } from './describe-schema.js';
import { getSampleDataHandler, getSampleDataSpec } from './get-sample-data.js';
import type { SkillDefinition } from '../../types/tools.js';

export const databaseSkill: SkillDefinition = {
  name: 'database',
  displayName: 'Database',
  description:
    'Query, explore, and understand your analytics database. ' +
    'List available datasets, inspect schemas, run SQL queries, and preview data.',
  version: '1.0.0',
  tools: [
    {
      spec: querySqlSpec,
      skill: 'database',
      handler: withTracing('query_sql', 'database', querySqlHandler),
    },
    {
      spec: listDatasetsSpec,
      skill: 'database',
      handler: withTracing('list_datasets', 'database', listDatasetsHandler),
    },
    {
      spec: describeSchemaSpec,
      skill: 'database',
      handler: withTracing('describe_schema', 'database', describeSchemaHandler),
    },
    {
      spec: getSampleDataSpec,
      skill: 'database',
      handler: withTracing('get_sample_data', 'database', getSampleDataHandler),
    },
  ],
};
