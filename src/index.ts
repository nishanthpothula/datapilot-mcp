/* eslint-disable no-console */
/**
 * DataPilot MCP — Entry Point
 *
 * Loads config, seeds the database if needed, starts the HTTP server.
 */

import 'dotenv/config';
import { createApp } from './transport/http.js';
import { getDb, closeDb, listTables } from './db/connection.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

function main(): void {
  console.log(`
╔══════════════════════════════════════════════╗
║           DataPilot MCP Server               ║
║     Enterprise Data & Analytics Platform     ║
╚══════════════════════════════════════════════╝
  `);

  // Ensure database is initialized
  try {
    const db = getDb();
    const tables = listTables();

    if (tables.length === 0) {
      console.log('⚠️  Database is empty. Run "npm run seed" to populate sample data.');
    } else {
      console.log(`✓ Database ready — ${tables.length} datasets: ${tables.join(', ')}`);
    }

    // Verify DB is writable (fail fast)
    db.prepare('SELECT 1').get();
  } catch (err) {
    console.error('✗ Database initialization failed:', err);
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(PORT, HOST, () => {
    console.log(`\n✓ Server running on http://${HOST}:${PORT}`);
    console.log(`  ENV:       ${NODE_ENV}`);
    console.log(`  Health:    http://${HOST}:${PORT}/health`);
    console.log(`  Metadata:  http://${HOST}:${PORT}/meta`);
    console.log(`  MCP:       http://${HOST}:${PORT}/mcp`);
    console.log(`  DCR:       POST http://${HOST}:${PORT}/oauth/register`);

    if (process.env['AUTH0_DOMAIN']) {
      console.log(`  Auth0:     https://${process.env['AUTH0_DOMAIN']}`);
    } else {
      console.log(`  Auth0:     ⚠️  Not configured (dev mode — auth skipped)`);
    }

    if (process.env['LANGSMITH_TRACING'] === 'true') {
      console.log(`  LangSmith: ✓ Tracing enabled (project: ${process.env['LANGSMITH_PROJECT'] ?? 'datapilot-mcp'})`);
    } else {
      console.log(`  LangSmith: Disabled (set LANGSMITH_TRACING=true to enable)`);
    }

    console.log('');
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  const shutdown = (signal: string): void => {
    console.log(`\n${signal} received — shutting down gracefully...`);
    server.close(() => {
      console.log('✓ HTTP server closed');
      closeDb();
      console.log('✓ Database connection closed');
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error('⚠️  Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    shutdown('unhandledRejection');
  });
}

try {
  main();
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}
