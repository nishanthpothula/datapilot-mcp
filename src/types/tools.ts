/**
 * DataPilot MCP — Tool & Skill Type Definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DataPilotResponse } from './responses.js';

// ─── Skill metadata ───────────────────────────────────────────────────────────

export type SkillName = 'database' | 'exploration' | 'reporting' | 'pipeline';

export interface SkillDefinition {
  name: SkillName;
  displayName: string;
  description: string;
  version: string;
  tools: ToolDefinition[];
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export interface ToolDefinition {
  /** MCP tool spec (name, description, inputSchema) */
  spec: Tool;
  /** Skill this tool belongs to */
  skill: SkillName;
  /** Handler function */
  handler: ToolHandler;
}

// ─── Handler contract ─────────────────────────────────────────────────────────

export type ToolInput = Record<string, unknown>;

export interface ToolCallRecord {
  tool: string;
  skill: SkillName;
  timestamp: string;
  durationMs: number;
  status: string;
}

export interface ToolContext {
  /** Authenticated user subject (from JWT) */
  userId: string;
  /** Auth0 client ID that made the request */
  clientId: string;
  /** LangSmith parent run ID (if tracing) */
  traceRunId?: string;
  /** Send an MCP progress notification to the client (only available when client sent progressToken) */
  sendProgress?: (progress: number, total: number, message?: string) => Promise<void>;
  /** Send an MCP logging notification to the client */
  sendLog?: (level: 'debug' | 'info' | 'warning' | 'error', message: string, logger?: string) => Promise<void>;
  /** Record a completed tool invocation into the session's conversation history */
  recordToolCall?: (tool: string, skill: SkillName, durationMs: number, status: string) => void;
}

export type ToolHandler = (
  input: ToolInput,
  context: ToolContext,
) => Promise<DataPilotResponse<unknown>>;

// ─── Registry ─────────────────────────────────────────────────────────────────

export interface ToolRegistry {
  tools: Map<string, ToolDefinition>;
  skills: Map<SkillName, SkillDefinition>;
  getToolSpec: (name: string) => Tool | undefined;
  getHandler: (name: string) => ToolHandler | undefined;
  getSkill: (name: SkillName) => SkillDefinition | undefined;
  listTools: () => Tool[];
}
