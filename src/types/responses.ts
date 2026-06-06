/**
 * DataPilot MCP — Standard Response Types
 *
 * All tool responses follow a consistent envelope pattern:
 * { success, data, meta, error? }
 *
 * This is returned as JSON stringified inside MCP text content,
 * giving clients a predictable contract to parse against.
 */

// ─── Status ───────────────────────────────────────────────────────────────────

export type ResponseStatus = 'success' | 'error' | 'partial';

// ─── Meta ─────────────────────────────────────────────────────────────────────

export interface ResponseMeta {
  /** ISO-8601 timestamp of when the tool executed */
  timestamp: string;
  /** Execution time in milliseconds */
  durationMs: number;
  /** The tool that produced this response */
  tool: string;
  /** The skill group this tool belongs to */
  skill: string;
  /** LangSmith trace ID (set when tracing is enabled) */
  traceId?: string;
  /** Optional pagination info */
  pagination?: {
    limit: number;
    offset: number;
    total?: number;
    hasMore: boolean;
  };
}

// ─── Error Envelope ───────────────────────────────────────────────────────────

export interface ResponseError {
  /** Machine-readable error code, e.g. "QUERY_FAILED" */
  code: string;
  /** Human-readable message */
  message: string;
  /** Optional field-level validation errors */
  details?: Record<string, string[]>;
}

// ─── Standard Envelope ────────────────────────────────────────────────────────

export interface DataPilotResponse<T = unknown> {
  status: ResponseStatus;
  data: T | null;
  meta: ResponseMeta;
  error?: ResponseError;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildResponse<T>(
  status: ResponseStatus,
  data: T | null,
  meta: Omit<ResponseMeta, 'timestamp'>,
  error?: ResponseError,
): DataPilotResponse<T> {
  return {
    status,
    data,
    meta: {
      ...meta,
      timestamp: new Date().toISOString(),
    },
    error,
  };
}

export function successResponse<T>(
  data: T,
  meta: Omit<ResponseMeta, 'timestamp' | 'durationMs'> & { durationMs: number },
): DataPilotResponse<T> {
  return buildResponse('success', data, meta);
}

export function errorResponse(
  code: string,
  message: string,
  meta: Omit<ResponseMeta, 'timestamp'>,
  details?: Record<string, string[]>,
): DataPilotResponse<null> {
  return buildResponse('error', null, meta, { code, message, details });
}

// ─── Domain-specific data shapes ──────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
  rowCount?: number;
  indexes?: string[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface StatisticsResult {
  column: string;
  dataType: string;
  count: number;
  nullCount: number;
  uniqueCount: number;
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  stdDev?: number;
  percentiles?: { p25: number; p75: number; p95: number };
  topValues?: Array<{ value: unknown; count: number }>;
}

export interface AnomalyResult {
  column: string;
  method: 'iqr' | 'zscore' | 'isolation_forest';
  anomalies: Array<{
    rowIndex: number;
    value: unknown;
    score: number;
    reason: string;
  }>;
  anomalyCount: number;
  totalRows: number;
  anomalyRate: number;
}

export interface CorrelationResult {
  pairs: Array<{
    columnA: string;
    columnB: string;
    pearsonR: number;
    strength: 'strong' | 'moderate' | 'weak' | 'negligible';
    direction: 'positive' | 'negative' | 'none';
  }>;
}

export interface ChartConfig {
  type: 'bar' | 'line' | 'scatter' | 'pie' | 'histogram' | 'heatmap';
  vegaLiteSpec: Record<string, unknown>;
  title: string;
  description: string;
}

export interface ReportSection {
  title: string;
  content: string;
  type: 'markdown' | 'table' | 'chart';
}

export interface Report {
  title: string;
  generatedAt: string;
  sections: ReportSection[];
  format: 'markdown' | 'html';
  rawContent: string;
}

export interface ValidationResult {
  valid: boolean;
  errorCount: number;
  errors: Array<{
    rowIndex: number;
    field: string;
    message: string;
    value: unknown;
  }>;
}
