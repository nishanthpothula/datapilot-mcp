/**
 * Pipeline Skill — Tool Registry
 */

import { withTracing } from '../../tracing/langsmith.js';
import { filterDataHandler, filterDataSpec } from './filter-data.js';
import { aggregateDataHandler, aggregateDataSpec } from './aggregate-data.js';
import { validateSchemaHandler, validateSchemaSpec } from './validate-schema.js';
import type { SkillDefinition } from '../../types/tools.js';

export const pipelineSkill: SkillDefinition = {
  name: 'pipeline',
  displayName: 'Data Pipeline',
  description:
    'Transform and validate data without writing SQL. Filter rows, aggregate groups, and validate data quality.',
  version: '1.0.0',
  tools: [
    {
      spec: filterDataSpec,
      skill: 'pipeline',
      handler: withTracing('filter_data', 'pipeline', filterDataHandler),
    },
    {
      spec: aggregateDataSpec,
      skill: 'pipeline',
      handler: withTracing('aggregate_data', 'pipeline', aggregateDataHandler),
    },
    {
      spec: validateSchemaSpec,
      skill: 'pipeline',
      handler: withTracing('validate_schema', 'pipeline', validateSchemaHandler),
    },
  ],
};
