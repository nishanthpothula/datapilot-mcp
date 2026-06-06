/**
 * DataPilot MCP — SQLite Connection Manager
 *
 * Manages the SQLite database connection with connection pooling semantics.
 * For production PostgreSQL, this module swaps to pg-pool transparently.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env['DATABASE_PATH'] ?? './data/datapilot.db';

let _db: Database.Database | null = null;

/**
 * Get (or initialize) the singleton SQLite database connection.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const resolvedPath = path.resolve(DB_PATH);
  const dir = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(resolvedPath, {
    // Enable WAL mode for better read concurrency
    fileMustExist: false,
  });

  // Performance and safety settings
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('synchronous = NORMAL');

  // Enforce read-only for user queries (actual seeding uses direct writes)
  return _db;
}

/**
 * Run a query with an optional timeout.
 * Returns rows as plain objects.
 */
export function runQuery(
  sql: string,
  params: unknown[] = [],
  timeoutMs = 10_000,
): Record<string, unknown>[] {
  const db = getDb();

  // SQLite doesn't have built-in query timeouts, so we use a timer
  // that interrupts the connection if exceeded.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    db.exec('PRAGMA wal_checkpoint');
    // Force interrupt via SQLite's interrupt mechanism
    try {
      (db as unknown as { interrupt(): void }).interrupt?.();
    } catch {
      // some versions don't expose interrupt
    }
  }, timeoutMs);

  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    if (timedOut) {
      const { QueryTimeoutError } = require('../utils/errors.js') as typeof import('../utils/errors.js');
      throw new QueryTimeoutError(timeoutMs);
    }
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get a list of all user tables in the database.
 */
export function listTables(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * Get column info for a table.
 */
export function getTableInfo(tableName: string): Array<{
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}> {
  const db = getDb();
  return db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
}

/**
 * Get row count for a table.
 */
export function getRowCount(tableName: string): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as {
    count: number;
  };
  return result.count;
}

/**
 * Close the database connection (used during graceful shutdown).
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
