// ============================================================
// Moltlets World - Database Connection (SQLite)
// Uses better-sqlite3 for synchronous operations
// LAZY INITIALIZATION - only connects at runtime, not build time
// ============================================================

import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';

// Use /data for Railway volume mount, fallback to local for dev
const DB_DIR = process.env.DATABASE_DIR || process.cwd();
const DB_PATH = path.join(DB_DIR, 'moltlets-world.db');

// Singleton storage
let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: Database.Database | null = null;

function initializeDb(): BetterSQLite3Database<typeof schema> | null {
  // Skip during build time
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    console.log('[DB] Skipping initialization during build');
    return null;
  }

  if (_db) return _db;

  console.log(`[DB] Connecting to: ${DB_PATH}`);
  const sqlite = new Database(DB_PATH);

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -64000');
  sqlite.pragma('mmap_size = 268435456');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('busy_timeout = 30000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('wal_autocheckpoint = 1000');

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
        energy INTEGER NOT NULL DEFAULT 200,
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

      CREATE TABLE IF NOT EXISTS agent_diary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT '[]',
        stats TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_claims (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        agent_name TEXT NOT NULL,
        twitter_handle TEXT,
        tweet_url TEXT,
        tweet_id TEXT,
        claimed_by TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        verified_at INTEGER
      );
    `);

    // Migrations for existing DBs
    try { sqlite.exec(`ALTER TABLE agents ADD COLUMN inventory TEXT NOT NULL DEFAULT '{}'`); } catch { /* exists */ }
    try { sqlite.exec(`ALTER TABLE agents ADD COLUMN wallet_address TEXT`); } catch { /* exists */ }
    try { sqlite.exec(`ALTER TABLE agent_claims ADD COLUMN claimed_by TEXT`); } catch { /* exists */ }
    try { sqlite.exec(`ALTER TABLE agent_claims ADD COLUMN tweet_id TEXT`); } catch { /* exists */ }
    try { sqlite.exec(`ALTER TABLE agent_claims ADD COLUMN claimed_at INTEGER`); } catch { /* exists */ }

    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_last_active ON agents(last_active_at)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS rel_pair_idx ON relationships(agent1_id, agent2_id)`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations(state)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_convo_created ON messages(conversation_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`,
      `CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_buildings_owner ON buildings(owner_agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tree_states_coords ON tree_states(x, y)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_diary_agent_period ON agent_diary(agent_id, period_end)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_claims_status ON agent_claims(status)`,
    ];

    for (const idx of indexes) {
      try { sqlite.exec(idx); } catch { /* ignore */ }
    }

    console.log('[DB] Schema initialized successfully');
  } catch (err) {
    console.error('[DB] Error creating tables:', err);
  }

  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

// Check if we're in build phase
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

// Deep no-op proxy that returns itself for any property/method chain
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createNoOpProxy(): any {
  const handler: ProxyHandler<object> = {
    get: (_, prop) => {
      // Handle primitive conversions
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'valueOf') return () => 0;
      if (prop === 'toString') return () => '';
      if (prop === 'toJSON') return () => null;
      if (prop === 'then') return undefined; // Not a promise
      if (prop === 'length') return 0;
      if (prop === Symbol.iterator) return function* () {};
      return createNoOpProxy();
    },
    apply: () => createNoOpProxy(),
    has: () => false,
  };
  return new Proxy(function() {}, handler);
}

// Getters
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (isBuildPhase()) {
    return createNoOpProxy();
  }
  if (!_db) {
    initializeDb();
  }
  return _db!;
}

export function getSqlite(): Database.Database {
  if (isBuildPhase()) {
    return createNoOpProxy();
  }
  if (!_sqlite) {
    initializeDb();
  }
  return _sqlite!;
}

// For backward compatibility - use getDb() and getSqlite() instead
export const db = {
  get select() { return getDb().select.bind(getDb()); },
  get insert() { return getDb().insert.bind(getDb()); },
  get update() { return getDb().update.bind(getDb()); },
  get delete() { return getDb().delete.bind(getDb()); },
  get query() { return getDb().query; },
};

export const sqlite = {
  get exec() { return getSqlite().exec.bind(getSqlite()); },
  get prepare() { return getSqlite().prepare.bind(getSqlite()); },
  get pragma() { return getSqlite().pragma.bind(getSqlite()); },
  get transaction() { return getSqlite().transaction.bind(getSqlite()); },
};

export type DbType = BetterSQLite3Database<typeof schema>;

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
  try {
    const realSqlite = getSqlite();
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
  try { getSqlite().pragma('wal_checkpoint(PASSIVE)'); } catch { /* ignore */ }
}

export function cleanupOldEvents(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  try {
    const cutoff = Date.now() - maxAgeMs;
    const result = getSqlite().prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
    return result.changes;
  } catch (err) {
    console.error('[DB] Event cleanup failed:', err);
    return 0;
  }
}
