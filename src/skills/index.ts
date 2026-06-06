/**
 * DataPilot MCP — Skill & Tool Registry
 *
 * Aggregates all skills and provides a unified lookup interface
 * for the MCP server to dispatch tool calls.
 */

import { databaseSkill } from './database/index.js';
import { explorationSkill } from './exploration/index.js';
import { reportingSkill } from './reporting/index.js';
import { pipelineSkill } from './pipeline/index.js';
import type { ToolRegistry, SkillDefinition, ToolDefinition, SkillName } from '../types/tools.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const ALL_SKILLS: SkillDefinition[] = [
  databaseSkill,
  explorationSkill,
  reportingSkill,
  pipelineSkill,
];

function buildRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();
  const skills = new Map<SkillName, SkillDefinition>();

  for (const skill of ALL_SKILLS) {
	console.log(`[Registry] Registering skill: ${skill.name} with tools: ${skill.tools.map(t => t.spec.name).join(', ')}`);
    skills.set(skill.name, skill);
    for (const tool of skill.tools) {
      tools.set(tool.spec.name, tool);
    }
  }

  return {
    tools,
    skills,
    getToolSpec(name: string): Tool | undefined {
      return tools.get(name)?.spec;
    },
    getHandler(name: string) {
      return tools.get(name)?.handler;
    },
    getSkill(name: SkillName) {
      return skills.get(name);
    },
    listTools(): Tool[] {
      return Array.from(tools.values()).map((t) => t.spec);
    },
  };
}

export const registry = buildRegistry();

export { ALL_SKILLS };
