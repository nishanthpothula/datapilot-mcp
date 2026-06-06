/**
 * Exploration Skill — Tool Registry
 */

import { withTracing } from '../../tracing/langsmith.js';
import { computeStatisticsHandler, computeStatisticsSpec } from './compute-statistics.js';
import { detectAnomaliesHandler, detectAnomaliesSpec } from './detect-anomalies.js';
import { correlateColumnsHandler, correlateColumnsSpec } from './correlate-columns.js';
import type { SkillDefinition } from '../../types/tools.js';

export const explorationSkill: SkillDefinition = {
  name: 'exploration',
  displayName: 'Data Exploration',
  description:
    'Explore and understand your data with statistical profiling, anomaly detection, and correlation analysis.',
  version: '1.0.0',
  tools: [
    {
      spec: computeStatisticsSpec,
      skill: 'exploration',
      handler: withTracing('compute_statistics', 'exploration', computeStatisticsHandler),
    },
    {
      spec: detectAnomaliesSpec,
      skill: 'exploration',
      handler: withTracing('detect_anomalies', 'exploration', detectAnomaliesHandler),
    },
    {
      spec: correlateColumnsSpec,
      skill: 'exploration',
      handler: withTracing('correlate_columns', 'exploration', correlateColumnsHandler),
    },
  ],
};
