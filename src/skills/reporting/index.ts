/**
 * Reporting Skill — Tool Registry
 */

import { withTracing } from '../../tracing/langsmith.js';
import { generateChartConfigHandler, generateChartConfigSpec } from './generate-chart-config.js';
import { generateReportHandler, generateReportSpec } from './generate-report.js';
import { exportDataHandler, exportDataSpec } from './export-data.js';
import type { SkillDefinition } from '../../types/tools.js';

export const reportingSkill: SkillDefinition = {
  name: 'reporting',
  displayName: 'Reporting',
  description:
    'Transform query results into charts, formatted reports, and exportable data files.',
  version: '1.0.0',
  tools: [
    {
      spec: generateChartConfigSpec,
      skill: 'reporting',
      handler: withTracing('generate_chart_config', 'reporting', generateChartConfigHandler),
    },
    {
      spec: generateReportSpec,
      skill: 'reporting',
      handler: withTracing('generate_report', 'reporting', generateReportHandler),
    },
    {
      spec: exportDataSpec,
      skill: 'reporting',
      handler: withTracing('export_data', 'reporting', exportDataHandler),
    },
  ],
};
