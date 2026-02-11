// ============================================================
// GET /api/world/state - Full world state snapshot
// ============================================================

import { NextResponse } from 'next/server';
import { world, gameLoop } from '@/engine/init';
import { db } from '@/db';
import { conversations, messages, relationships, agents } from '@/db/schema';
import { eq, or } from 'drizzle-orm';
import { getAllTreeStates } from '@/engine/Resources';
import { getAllBuildings } from '@/engine/Buildings';
import { getWorldTime } from '@/engine/WorldTime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const allAgents = world.getAllAgents();

  // Active conversations with recent messages
  const activeConvos = db.select().from(conversations)
    .where(or(
      eq(conversations.state, 'active'),
      eq(conversations.state, 'invited'),
    ))
    .all();

  const convosWithMessages = activeConvos.map(c => {
    const agent1 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, c.agent1Id)).get();
    const agent2 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, c.agent2Id)).get();

    const recentMsgs = db.select().from(messages)
      .where(eq(messages.conversationId, c.id))
      .all()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10)
      .reverse();

    return {
      ...c,
      agent1Name: agent1?.name || 'Unknown',
      agent2Name: agent2?.name || 'Unknown',
      recentMessages: recentMsgs,
    };
  });

  // All relationships
  const allRels = db.select().from(relationships).all();
  const relsWithNames = allRels.map(r => {
    const agent1 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, r.agent1Id)).get();
    const agent2 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, r.agent2Id)).get();
    return {
      ...r,
      agent1Name: agent1?.name || 'Unknown',
      agent2Name: agent2?.name || 'Unknown',
    };
  });

  // Get tree states for rendering
  const treeStates = getAllTreeStates();
  const treeStatesObj: Record<string, string> = {};
  for (const [key, state] of treeStates.entries()) {
    treeStatesObj[key] = state;
  }

  // Get buildings
  const buildings = getAllBuildings();

  // Get world time and weather
  const worldTimeData = getWorldTime();

  // Calculate town stats
  const treeStatesArray = Array.from(treeStates.values());
  const treesGrown = treeStatesArray.filter(s => s === 'full').length;
  const treesSaplings = treeStatesArray.filter(s => s === 'sapling').length;
  const treesTotal = treeStatesArray.length;

  // Calculate total economy (sum of all agent money)
  const totalMoney = allAgents.reduce((sum, a) => sum + (a.money || 0), 0);

  // Calculate total fish in all inventories
  const totalFish = allAgents.reduce((sum, a) => {
    const fish = a.inventory?.fish || {};
    return sum + Object.values(fish).reduce((f, c) => f + (c as number), 0);
  }, 0);

  // Calculate total wood in all inventories
  const totalWood = allAgents.reduce((sum, a) => sum + (a.inventory?.wood || 0), 0);

  // Count active agents by state
  const stateCount = {
    idle: allAgents.filter(a => a.state === 'idle').length,
    walking: allAgents.filter(a => a.state === 'walking').length,
    talking: allAgents.filter(a => a.state === 'talking').length,
    sleeping: allAgents.filter(a => a.state === 'sleeping').length,
  };

  return NextResponse.json({
    agents: allAgents,
    conversations: convosWithMessages,
    relationships: relsWithNames,
    treeStates: treeStatesObj,
    buildings,
    time: worldTimeData,
    worldTime: Date.now(),
    tickCount: gameLoop.ticks,
    stats: {
      treesGrown,
      treesSaplings,
      treesTotal,
      totalMoney,
      totalFish,
      totalWood,
      activeConversations: activeConvos.length,
      totalRelationships: allRels.length,
      stateCount,
    },
    map: {
      width: world.map.width,
      height: world.map.height,
      tiles: world.map.tiles,
      obstacles: world.map.obstacles,
    },
  });
}

