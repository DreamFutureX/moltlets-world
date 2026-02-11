#!/usr/bin/env node
// ============================================================
// Agent Progress Checker - View all agent stats from database
// ============================================================

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', 'moltlets-town.db');

const db = new Database(dbPath, { readonly: true });

console.log('🏘️  Moltlets Town - Agent Progress Report\n');
console.log('═'.repeat(80));

// Get all agents
const agents = db.prepare('SELECT * FROM agents ORDER BY exp DESC').all();

if (agents.length === 0) {
    console.log('No agents found in database.');
    process.exit(0);
}

console.log(`\nTotal Agents: ${agents.length}\n`);

for (const agent of agents) {
    const inventory = JSON.parse(agent.inventory || '{}');
    const appearance = JSON.parse(agent.appearance || '{}');
    const personality = JSON.parse(agent.personality || '[]');

    const level = Math.floor(Math.sqrt(agent.exp / 100)) + 1;
    const totalWood = inventory.wood || 0;
    const totalFish = Object.values(inventory.fish || {}).reduce((a, b) => a + b, 0);
    const totalItems = totalWood + totalFish;

    console.log(`┌─ ${agent.name} (Level ${level})`);
    console.log(`│  State: ${agent.state.toUpperCase()} | Mood: ${agent.mood}`);
    const posX = agent.posX != null ? agent.posX.toFixed(1) : '?';
    const posY = agent.posY != null ? agent.posY.toFixed(1) : '?';
    console.log(`│  Position: (${posX}, ${posY})`);
    console.log(`│  Energy: ${agent.energy}/100 | Happiness: ${agent.happiness}/100`);
    console.log(`│  Experience: ${agent.exp} XP | Money: $${agent.money.toFixed(2)}`);
    console.log(`│  Inventory: ${totalItems} items (${totalWood} wood, ${totalFish} fish)`);

    if (inventory.fish && Object.keys(inventory.fish).length > 0) {
        const fishDetails = Object.entries(inventory.fish)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${count}x ${type}`)
            .join(', ');
        if (fishDetails) {
            console.log(`│    Fish: ${fishDetails}`);
        }
    }

    console.log(`│  Personality: ${personality.join(', ')}`);
    console.log(`│  Appearance: ${appearance.variant || 'unknown'} (${appearance.color})`);

    const lastActive = new Date(agent.lastActiveAt);
    const timeSince = Math.floor((Date.now() - agent.lastActiveAt) / 1000);
    const timeStr = timeSince < 60 ? `${timeSince}s ago` :
        timeSince < 3600 ? `${Math.floor(timeSince / 60)}m ago` :
            timeSince < 86400 ? `${Math.floor(timeSince / 3600)}h ago` :
                `${Math.floor(timeSince / 86400)}d ago`;
    console.log(`│  Last Active: ${timeStr}`);
    console.log(`└${'─'.repeat(78)}\n`);
}

// Get conversation stats
const convos = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
const messages = db.prepare('SELECT COUNT(*) as count FROM messages').get();
const relationships = db.prepare('SELECT COUNT(*) as count FROM relationships').get();

console.log('═'.repeat(80));
console.log('\n📊 World Statistics:');
console.log(`   Conversations: ${convos.count}`);
console.log(`   Messages: ${messages.count}`);
console.log(`   Relationships: ${relationships.count}`);

// Get top relationships
const topRels = db.prepare(`
  SELECT 
    a1.name as agent1,
    a2.name as agent2,
    r.score,
    r.status,
    r.interaction_count as interactionCount
  FROM relationships r
  JOIN agents a1 ON r.agent1_id = a1.id
  JOIN agents a2 ON r.agent2_id = a2.id
  ORDER BY r.score DESC
  LIMIT 5
`).all();

if (topRels.length > 0) {
    console.log('\n💕 Top Relationships:');
    topRels.forEach((rel, i) => {
        console.log(`   ${i + 1}. ${rel.agent1} ↔ ${rel.agent2}: ${rel.score} points (${rel.status}, ${rel.interactionCount} interactions)`);
    });
}

console.log('\n' + '═'.repeat(80));
console.log('\n✅ All agent progress is automatically saved to the database!');
console.log('   Agents will resume from their current state on server restart.\n');

db.close();
