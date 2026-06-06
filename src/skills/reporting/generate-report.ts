/**
 * Tool: generate_report
 * Skill: reporting
 *
 * Generate a formatted markdown or HTML analytics report from multiple
 * SQL queries, with an optional AI-generated narrative summary.
 */

import { z } from 'zod';
import { parseInput, assertSafeQuery } from '../../utils/validators.js';
import { runQuery } from '../../db/connection.js';
import { successResponse, errorResponse } from '../../types/responses.js';
import type { Report, ReportSection } from '../../types/responses.js';
import type { ToolHandler } from '../../types/tools.js';
import { isDataPilotError } from '../../utils/errors.js';

const SectionSchema = z.object({
  title: z.string().min(1).max(200),
  sql: z.string().min(1).max(4000),
  description: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

const InputSchema = z.object({
  title: z.string().min(1).max(200).describe('Report title'),
  sections: z
    .array(SectionSchema)
    .min(1)
    .max(10)
    .describe('Report sections, each with a title and SQL query'),
  format: z.enum(['markdown', 'html']).default('markdown').describe('Output format'),
  include_summary: z
    .boolean()
    .default(true)
    .describe('Include a text summary for each section'),
  author: z.string().optional().describe('Report author name'),
});

function rowsToMarkdownTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '_No results_\n';
  const cols = Object.keys(rows[0]);
  const header = `| ${cols.join(' | ')} |`;
  const separator = `| ${cols.map(() => '---').join(' | ')} |`;
  const dataRows = rows
    .map((r) => `| ${cols.map((c) => String(r[c] ?? '')).join(' | ')} |`)
    .join('\n');
  return `${header}\n${separator}\n${dataRows}\n`;
}

function rowsToHtmlTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '<p><em>No results</em></p>';
  const cols = Object.keys(rows[0]);
  const headerRow = `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  const dataRows = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${String(r[c] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead>${headerRow}</thead><tbody>${dataRows}</tbody></table>`;
}

function generateSummary(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return 'This section returned no data.';
  const cols = Object.keys(rows[0]);
  return `This section shows **${rows.length} records** across **${cols.length} columns** (${cols.slice(0, 5).join(', ')}${cols.length > 5 ? '...' : ''}).`;
}

export const generateReportHandler: ToolHandler = async (input, context) => {
  const start = Date.now();

  try {
    const params = parseInput(InputSchema, input);

    const sections: ReportSection[] = [];
    let fullContent = '';

    const generatedAt = new Date().toISOString();

    if (params.format === 'markdown') {
      fullContent += `# ${params.title}\n\n`;
      fullContent += `> Generated at: ${generatedAt}`;
      if (params.author) fullContent += `  |  Author: ${params.author}`;
      fullContent += '\n\n---\n\n';
    } else {
      fullContent += `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${params.title}</title>`;
      fullContent += `<style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:2rem;color:#1a1a1a}h1,h2{color:#0f172a}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #e2e8f0;padding:.5rem .75rem;text-align:left}th{background:#f8fafc;font-weight:600}tr:nth-child(even){background:#f8fafc}.summary{background:#f0f9ff;border-left:4px solid #0ea5e9;padding:.75rem 1rem;margin:1rem 0;border-radius:0 .5rem .5rem 0}footer{margin-top:3rem;font-size:.85rem;color:#64748b;border-top:1px solid #e2e8f0;padding-top:1rem}</style></head><body>`;
      fullContent += `<h1>${params.title}</h1>`;
      fullContent += `<p style="color:#64748b">Generated: ${generatedAt}${params.author ? ` &nbsp;|&nbsp; Author: ${params.author}` : ''}</p><hr>`;
    }

    for (let i = 0; i < params.sections.length; i++) {
      const sectionDef = params.sections[i];
      await context.sendProgress?.(i, params.sections.length, `Generating section: ${sectionDef.title}`);

      assertSafeQuery(sectionDef.sql);
      const rows = runQuery(`
        SELECT * FROM (${sectionDef.sql.replace(/;+\s*$/, '')}) AS __section
        LIMIT ${sectionDef.limit}
      `);

      const summary = (params.include_summary ?? true)
        ? generateSummary(rows)
        : undefined;

      let sectionContent = '';
      if (params.format === 'markdown') {
        sectionContent += `## ${sectionDef.title}\n\n`;
        if (sectionDef.description) sectionContent += `${sectionDef.description}\n\n`;
        if (summary) sectionContent += `${summary}\n\n`;
        sectionContent += rowsToMarkdownTable(rows);
        sectionContent += '\n\n';
      } else {
        sectionContent += `<section><h2>${sectionDef.title}</h2>`;
        if (sectionDef.description) sectionContent += `<p>${sectionDef.description}</p>`;
        if (summary) sectionContent += `<div class="summary">${summary}</div>`;
        sectionContent += rowsToHtmlTable(rows);
        sectionContent += '</section>';
      }

      fullContent += sectionContent;
      sections.push({
        title: sectionDef.title,
        content: sectionContent,
        type: 'table',
      });
    }
    await context.sendProgress?.(params.sections.length, params.sections.length, 'Report complete');

    if (params.format === 'html') {
      fullContent += `<footer>DataPilot MCP &mdash; ${params.title} &mdash; ${generatedAt}</footer></body></html>`;
    }

    const result: Report = {
      title: params.title,
      generatedAt,
      sections,
      format: params.format ?? 'markdown',
      rawContent: fullContent,
    };

    return successResponse(result, {
      tool: 'generate_report',
      skill: 'reporting',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  } catch (err) {
    const code = isDataPilotError(err) ? err.code : 'REPORT_FAILED';
    const message = err instanceof Error ? err.message : 'Report generation failed';
    return errorResponse(code, message, {
      tool: 'generate_report',
      skill: 'reporting',
      durationMs: Date.now() - start,
      traceId: context.traceRunId,
    });
  }
};

export const generateReportSpec = {
  name: 'generate_report',
  description:
    'Generate a formatted analytics report (Markdown or HTML) from multiple SQL query sections. ' +
    'Each section has a title, SQL query, and optional description. ' +
    'Returns the full report content ready to save or display.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Report title' },
      sections: {
        type: 'array',
        description: 'Report sections',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Section title' },
            sql: { type: 'string', description: 'SQL query for section data' },
            description: { type: 'string', description: 'Section description (optional)' },
            limit: { type: 'number', description: 'Max rows (default 50)', default: 50 },
          },
          required: ['title', 'sql'],
        },
      },
      format: {
        type: 'string',
        enum: ['markdown', 'html'],
        default: 'markdown',
        description: 'Output format',
      },
      include_summary: {
        type: 'boolean',
        default: true,
        description: 'Include auto-generated text summary per section',
      },
      author: { type: 'string', description: 'Report author (optional)' },
    },
    required: ['title', 'sections'],
  },
};
