// ============================================================
// Moltlets Town - Database Schema (Drizzle ORM + SQLite)
// ============================================================

import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';

// --- Agents ---
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  apiKey: text('api_key').notNull().unique(),
  name: text('name').notNull().unique(),
  bio: text('bio').notNull().default(''),
  personality: text('personality').notNull().default('[]'),       // JSON array
  appearance: text('appearance').notNull().default('{}'),         // JSON object
  posX: real('pos_x').notNull().default(20),
  posY: real('pos_y').notNull().default(20),
  state: text('state').notNull().default('idle'),                 // idle|walking|talking|sleeping
  targetX: real('target_x'),
  targetY: real('target_y'),
  energy: integer('energy').notNull().default(100),
  happiness: integer('happiness').notNull().default(100),
  exp: integer('exp').notNull().default(0),
  money: real('money').notNull().default(0),
  inventory: text('inventory').notNull().default('{}'),           // JSON: { wood: 0, fish: {}, items: {} }
  mood: text('mood').notNull().default('neutral'),                // happy|neutral|sad|excited
  direction: text('direction').notNull().default('se'),           // ne|nw|se|sw
  walletAddress: text('wallet_address'),                          // Solana wallet public key
  lastActiveAt: integer('last_active_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

// --- Conversations ---
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  agent1Id: text('agent1_id').notNull().references(() => agents.id),
  agent2Id: text('agent2_id').notNull().references(() => agents.id),
  state: text('state').notNull().default('invited'),              // invited|active|ended
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  summary: text('summary'),
});

// --- Messages ---
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
});

// --- Relationships ---
export const relationships = sqliteTable('relationships', {
  id: text('id').primaryKey(),
  agent1Id: text('agent1_id').notNull().references(() => agents.id),
  agent2Id: text('agent2_id').notNull().references(() => agents.id),
  score: integer('score').notNull().default(0),
  interactionCount: integer('interaction_count').notNull().default(0),
  lastInteractionAt: integer('last_interaction_at').notNull(),
  status: text('status').notNull().default('stranger'),           // stranger|acquaintance|friend|close_friend|rival
}, (table) => [
  uniqueIndex('rel_pair_idx').on(table.agent1Id, table.agent2Id),
]);

// --- Game Events (for SSE replay) ---
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payload: text('payload').notNull().default('{}'),               // JSON
  createdAt: integer('created_at').notNull(),
});

// --- Tree States (for resource gathering) ---
export const treeStates = sqliteTable('tree_states', {
  id: text('id').primaryKey(),                                    // "x_y" format
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  state: text('state').notNull().default('full'),                 // full|stump|sapling
  resourceCount: integer('resource_count').notNull().default(3),  // wood remaining
  regrowsAt: integer('regrows_at'),                               // timestamp when tree regrows
});

// --- World Meta (time, weather, global state) ---
export const worldMeta = sqliteTable('world_meta', {
  id: text('id').primaryKey().default('main'),
  gameStartedAt: integer('game_started_at').notNull(),            // when game world started
  currentDay: integer('current_day').notNull().default(1),        // day of month (1-28)
  currentMonth: integer('current_month').notNull().default(1),    // month (1-12: Spring=1-3, Summer=4-6, Fall=7-9, Winter=10-12)
  currentYear: integer('current_year').notNull().default(1),      // year number
  weather: text('weather').notNull().default('sunny'),            // sunny|cloudy|rainy|stormy
  weatherChangesAt: integer('weather_changes_at'),                // when weather will change
});

// --- Buildings (player-built structures) ---
export const buildings = sqliteTable('buildings', {
  id: text('id').primaryKey(),
  ownerAgentId: text('owner_agent_id').notNull().references(() => agents.id),
  ownerName: text('owner_name').notNull(),                        // cached for display
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  buildingType: text('building_type').notNull().default('house'), // house|shop|farm
  state: text('state').notNull().default('foundation'),           // foundation|frame|walls|roof|complete
  woodUsed: integer('wood_used').notNull().default(0),            // wood contributed so far
  woodRequired: integer('wood_required').notNull().default(50),   // total wood needed
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
});

// --- Agent Claims (human verification) ---
export const agentClaims = sqliteTable('agent_claims', {
  id: text('id').primaryKey(),                                    // claim token
  agentId: text('agent_id').notNull().references(() => agents.id),
  agentName: text('agent_name').notNull(),                        // cached for display
  status: text('status').notNull().default('pending'),            // pending|claimed|verified
  claimedBy: text('claimed_by'),                                  // email or twitter handle
  twitterHandle: text('twitter_handle'),                          // @username
  tweetId: text('tweet_id'),                                      // verification tweet ID
  createdAt: integer('created_at').notNull(),
  claimedAt: integer('claimed_at'),
  verifiedAt: integer('verified_at'),
});
