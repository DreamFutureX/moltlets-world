/**
 * Light trim script for launch day.
 * - 50% money for all agents
 * - 50% EXP for all agents
 * - Remove incomplete buildings (not 'complete')
 *
 * Run: npx tsx scripts/trim-progress.ts
 * Or on Railway: railway run npx tsx scripts/trim-progress.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_DIR = process.env.DATABASE_DIR || process.cwd();
const DB_PATH = path.join(DB_DIR, 'moltlets-world.db');

console.log(`[Trim] Opening DB: ${DB_PATH}`);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// 1. Cut money by 50%
const moneyResult = db.prepare(`
  UPDATE agents SET money = ROUND(money * 0.5, 2)
`).run();
console.log(`[Trim] Money halved for ${moneyResult.changes} agents`);

// 2. Cut EXP by 50%
const expResult = db.prepare(`
  UPDATE agents SET exp = CAST(exp * 0.5 AS INTEGER)
`).run();
console.log(`[Trim] EXP halved for ${expResult.changes} agents`);

// 3. Show current building states
const buildingStats = db.prepare(`
  SELECT state, COUNT(*) as count FROM buildings GROUP BY state
`).all() as { state: string; count: number }[];
console.log(`[Trim] Buildings before:`);
for (const b of buildingStats) {
  console.log(`  ${b.state}: ${b.count}`);
}

// 4. Remove incomplete buildings
const removeResult = db.prepare(`
  DELETE FROM buildings WHERE state != 'complete'
`).run();
console.log(`[Trim] Removed ${removeResult.changes} incomplete buildings`);

// 5. Show final stats
const agentStats = db.prepare(`
  SELECT
    COUNT(*) as total,
    ROUND(AVG(money), 0) as avgMoney,
    ROUND(AVG(exp), 0) as avgExp,
    MIN(money) as minMoney,
    MAX(money) as maxMoney
  FROM agents
`).get() as { total: number; avgMoney: number; avgExp: number; minMoney: number; maxMoney: number };

const remainingBuildings = db.prepare(`SELECT COUNT(*) as count FROM buildings`).get() as { count: number };

console.log(`\n[Trim] ✅ Done!`);
console.log(`  Agents: ${agentStats.total}`);
console.log(`  Money: avg $${agentStats.avgMoney}, range $${agentStats.minMoney}-$${agentStats.maxMoney}`);
console.log(`  Avg EXP: ${agentStats.avgExp}`);
console.log(`  Buildings remaining: ${remainingBuildings.count} (complete only)`);

db.close();
