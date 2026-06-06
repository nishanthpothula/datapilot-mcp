/* eslint-disable no-console */
/**
 * DataPilot MCP — STDIO Entry Point
 *
 * Connects the MCP server directly to Claude Desktop via STDIO transport.
 * Use this instead of mcp-remote for local development — it has no HTTP
 * layer and no undici/ReadableStream dependency.
 *
 * Claude Desktop config:
 *   "command": "node",
 *   "args": ["/absolute/path/to/datapilot-mcp/dist/stdio.js"]
 */

import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServerWithContext } from './server.js';
import { getDb, listTables } from './db/connection.js';

async function main(): Promise<void> {
  // Ensure DB is ready before accepting tool calls
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    const tables = listTables();
    console.error(`[datapilot] DB ready — ${tables.length} dataset(s): ${tables.join(', ')}`);
  } catch (err) {
    console.error('[datapilot] DB init failed:', err);
    process.exit(1);
  }

  const server = createMcpServerWithContext({
    userId: 'stdio-local',
    clientId: 'claude-desktop',
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[datapilot] MCP server ready on STDIO');
}

main().catch((err) => {
  console.error('[datapilot] Fatal error:', err);
  process.exit(1);
});
