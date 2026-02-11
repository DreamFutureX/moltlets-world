// ============================================================
// Moltlets Town - Database Connection (Singleton)
// Optimized for high-load (500+ agents)
// ============================================================

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'moltlets-town.db');

// Singleton pattern for Next.js hot reload
const globalForDb = globalThis as unknown as {
  __db?: ReturnType<typeof drizzle>;
  __sqlite?: Database.Database;
};

function createDb() {
  if (globalForDb.__db) return globalForDb.__db;

  const sqlite = new Database(DB_PATH);

  // ═══════════════════════════════════════════════════════════
  // PERFORMANCE OPTIMIZATIONS FOR HIGH LOAD
  // ═══════════════════════════════════════════════════════════

  // WAL mode for better concurrent reads/writes
  sqlite.pragma('journal_mode = WAL');

  // Synchronous = NORMAL for better performance (still safe with WAL)
  sqlite.pragma('synchronous = NORMAL');

  // Increase cache size (default is 2MB, set to 64MB)
  sqlite.pragma('cache_size = -64000');

  // Memory-mapped I/O for faster reads (256MB)
  sqlite.pragma('mmap_size = 268435456');

  // Temp store in memory
  sqlite.pragma('temp_store = MEMORY');

  // Busy timeout - wait up to 30 seconds for locks
  sqlite.pragma('busy_timeout = 30000');

  // Foreign keys
  sqlite.pragma('foreign_keys = ON');

  // WAL checkpoint settings
  sqlite.pragma('wal_autocheckpoint = 1000');

  // Create tables - wrapped in try/catch for safety
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL UNIQUE,
        bio TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '[]',
        appearance TEXT NOT NULL DEFAULT '{}',
        pos_x REAL NOT NULL DEFAULT 20,
        pos_y REAL NOT NULL DEFAULT 20,
        state TEXT NOT NULL DEFAULT 'idle',
        target_x REAL,
        target_y REAL,
        energy INTEGER NOT NULL DEFAULT 100,
        happiness INTEGER NOT NULL DEFAULT 100,
        exp INTEGER NOT NULL DEFAULT 0,
        money REAL NOT NULL DEFAULT 0,
        inventory TEXT NOT NULL DEFAULT '{}',
        mood TEXT NOT NULL DEFAULT 'neutral',
        direction TEXT NOT NULL DEFAULT 'se',
        last_active_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        agent1_id TEXT NOT NULL REFERENCES agents(id),
        agent2_id TEXT NOT NULL REFERENCES agents(id),
        state TEXT NOT NULL DEFAULT 'invited',
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        agent_id TEXT NOT NULL REFERENCES agents(id),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        agent1_id TEXT NOT NULL REFERENCES agents(id),
        agent2_id TEXT NOT NULL REFERENCES agents(id),
        score INTEGER NOT NULL DEFAULT 0,
        interaction_count INTEGER NOT NULL DEFAULT 0,
        last_interaction_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'stranger',
        UNIQUE(agent1_id, agent2_id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tree_states (
        id TEXT PRIMARY KEY,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'full',
        resource_count INTEGER NOT NULL DEFAULT 3,
        regrows_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS world_meta (
        id TEXT PRIMARY KEY DEFAULT 'main',
        game_started_at INTEGER NOT NULL,
        current_day INTEGER NOT NULL DEFAULT 1,
        current_month INTEGER NOT NULL DEFAULT 1,
        current_year INTEGER NOT NULL DEFAULT 1,
        weather TEXT NOT NULL DEFAULT 'sunny',
        weather_changes_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS buildings (
        id TEXT PRIMARY KEY,
        owner_agent_id TEXT NOT NULL REFERENCES agents(id),
        owner_name TEXT NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        building_type TEXT NOT NULL DEFAULT 'house',
        state TEXT NOT NULL DEFAULT 'foundation',
        wood_used INTEGER NOT NULL DEFAULT 0,
        wood_required INTEGER NOT NULL DEFAULT 50,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `);

    // Add inventory column if it doesn't exist (migration for existing DBs)
    try {
      sqlite.exec(`ALTER TABLE agents ADD COLUMN inventory TEXT NOT NULL DEFAULT '{}'`);
    } catch {
      // Column already exists, ignore
    }

    // ═══════════════════════════════════════════════════════════
    // INDEXES FOR FAST QUERIES (high-load optimization)
    // ═══════════════════════════════════════════════════════════

    // Create indexes (safely - ignore if exists)
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_last_active ON agents(last_active_at)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS rel_pair_idx ON relationships(agent1_id, agent2_id)`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations(state)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`,
      `CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`,
      `CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_buildings_owner ON buildings(owner_agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tree_states_coords ON tree_states(x, y)`,
    ];

    for (const idx of indexes) {
      try { sqlite.exec(idx); } catch { /* ignore */ }
    }

  } catch (err) {
    console.error('[DB] Error creating tables:', err);
  }

  globalForDb.__sqlite = sqlite;
  globalForDb.__db = drizzle(sqlite, { schema });
  return globalForDb.__db;
}

export const db = createDb();
export const sqlite = globalForDb.__sqlite!;
export type DbType = typeof db;

// ═══════════════════════════════════════════════════════════
// SAFE DATABASE OPERATIONS (prevent crashes)
// ═══════════════════════════════════════════════════════════

/**
 * Execute a database operation safely with error handling and retry
 */
export function safeDbOperation<T>(operation: () => T, fallback: T, retries = 2): T {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return operation();
    } catch (err) {
      console.error(`[DB] Operation failed (attempt ${attempt + 1}/${retries + 1}):`, err);
      if (attempt === retries) {
        console.error('[DB] All retries exhausted, returning fallback');
        return fallback;
      }
      // Brief delay before retry
      const delay = Math.min(100 * Math.pow(2, attempt), 1000);
      const start = Date.now();
      while (Date.now() - start < delay) { /* busy wait for sync context */ }
    }
  }
  return fallback;
}

/**
 * Batch multiple updates into a single transaction
 */
export function batchUpdate(operations: (() => void)[]): boolean {
  if (operations.length === 0) return true;

  try {
    const transaction = sqlite.transaction(() => {
      for (const op of operations) {
        op();
      }
    });
    transaction();
    return true;
  } catch (err) {
    console.error('[DB] Batch update failed:', err);
    return false;
  }
}

/**
 * Run WAL checkpoint to prevent unbounded WAL growth
 */
export function runCheckpoint(): void {
  try {
    sqlite.pragma('wal_checkpoint(PASSIVE)');
  } catch (err) {
    console.error('[DB] Checkpoint failed:', err);
  }
}

/**
 * Clean up old events to prevent database bloat
 */
export function cleanupOldEvents(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  try {
    const cutoff = Date.now() - maxAgeMs;
    const result = sqlite.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
    return result.changes;
  } catch (err) {
    console.error('[DB] Event cleanup failed:', err);
    return 0;
  }
}
