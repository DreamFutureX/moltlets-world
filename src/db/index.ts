// ============================================================
// Moltlets World - Database Connection (SQLite)
// Uses better-sqlite3 for synchronous operations
// LAZY INITIALIZATION - only connects at runtime, not build time
// ============================================================

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';

// Use /data for Railway volume mount, fallback to local for dev
const DB_DIR = process.env.DATABASE_DIR || process.cwd();
const DB_PATH = path.join(DB_DIR, 'moltlets-world.db');

// Singleton pattern for Next.js hot reload
const globalForDb = globalThis as unknown as {
  __db?: ReturnType<typeof drizzle>;
  __sqlite?: Database.Database;
  __initialized?: boolean;
};

function initializeDb() {
  // Skip during build time
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE === 'phase-production-build') {
    console.log('[DB] Skipping initialization during build');
    return null;
  }

  if (globalForDb.__db && globalForDb.__initialized) {
    return globalForDb.__db;
  }

  console.log(`[DB] Connecting to: ${DB_PATH}`);
  const sqlite = new Database(DB_PATH);

  // ═══════════════════════════════════════════════════════════
  // PERFORMANCE OPTIMIZATIONS
  // ═══════════════════════════════════════════════════════════

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -64000');
  sqlite.pragma('mmap_size = 268435456');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('busy_timeout = 30000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('wal_autocheckpoint = 1000');

  // Create tables
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
        wallet_address TEXT,
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

      CREATE TABLE IF NOT EXISTS agent_claims (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        agent_name TEXT NOT NULL,
        twitter_handle TEXT,
        tweet_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        verified_at INTEGER
      );
    `);

    // Add columns for existing DBs (migrations)
    try { sqlite.exec(`ALTER TABLE agents ADD COLUMN inventory TEXT NOT NULL DEFAULT '{}'`); } catch { /* exists */ }
    try { sqlite.exec(`ALTER TABLE agents ADD COLUMN wallet_address TEXT`); } catch { /* exists */ }

    // Create indexes
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
      `CREATE INDEX IF NOT EXISTS idx_agent_claims_status ON agent_claims(status)`,
    ];

    for (const idx of indexes) {
      try { sqlite.exec(idx); } catch { /* ignore */ }
    }

    console.log('[DB] Schema initialized successfully');
  } catch (err) {
    console.error('[DB] Error creating tables:', err);
  }

  globalForDb.__sqlite = sqlite;
  globalForDb.__db = drizzle(sqlite, { schema });
  globalForDb.__initialized = true;
  return globalForDb.__db;
}

// Lazy getter - only initializes on first access
function getDb() {
  if (!globalForDb.__initialized) {
    initializeDb();
  }
  return globalForDb.__db!;
}

function getSqlite() {
  if (!globalForDb.__initialized) {
    initializeDb();
  }
  return globalForDb.__sqlite!;
}

// Export as getters to ensure lazy initialization
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_, prop) {
    const realDb = getDb();
    if (!realDb) {
      throw new Error('Database not initialized - this should not happen at runtime');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (realDb as any)[prop];
    return typeof value === 'function' ? value.bind(realDb) : value;
  }
});

export const sqlite = new Proxy({} as Database.Database, {
  get(_, prop) {
    const realSqlite = getSqlite();
    if (!realSqlite) {
      throw new Error('SQLite not initialized - this should not happen at runtime');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (realSqlite as any)[prop];
    return typeof value === 'function' ? value.bind(realSqlite) : value;
  }
});

export type DbType = ReturnType<typeof drizzle>;

// ═══════════════════════════════════════════════════════════
// SAFE DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════

export function safeDbOperation<T>(operation: () => T, fallback: T, retries = 2): T {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return operation();
    } catch (err) {
      console.error(`[DB] Operation failed (attempt ${attempt + 1}/${retries + 1}):`, err);
      if (attempt === retries) {
        return fallback;
      }
      const delay = Math.min(100 * Math.pow(2, attempt), 1000);
      const start = Date.now();
      while (Date.now() - start < delay) { /* busy wait */ }
    }
  }
  return fallback;
}

export function batchUpdate(operations: (() => void)[]): boolean {
  if (operations.length === 0) return true;
  const realSqlite = getSqlite();
  if (!realSqlite) return false;
  try {
    const transaction = realSqlite.transaction(() => {
      for (const op of operations) op();
    });
    transaction();
    return true;
  } catch (err) {
    console.error('[DB] Batch update failed:', err);
    return false;
  }
}

export function runCheckpoint(): void {
  const realSqlite = getSqlite();
  if (!realSqlite) return;
  try { realSqlite.pragma('wal_checkpoint(PASSIVE)'); } catch { /* ignore */ }
}

export function cleanupOldEvents(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const realSqlite = getSqlite();
  if (!realSqlite) return 0;
  try {
    const cutoff = Date.now() - maxAgeMs;
    const result = realSqlite.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
    return result.changes;
  } catch (err) {
    console.error('[DB] Event cleanup failed:', err);
    return 0;
  }
}
