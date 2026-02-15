// ============================================================
// GET /api/world/state - Full world state snapshot
// ============================================================

import { NextResponse } from 'next/server';
import { world, gameLoop } from '@/engine/init';
import { db } from '@/db';
import { conversations, messages, relationships, agents } from '@/db/schema';
import { eq, or, inArray } from 'drizzle-orm';
import { getAllTreeStates } from '@/engine/Resources';
import { getAllBuildings } from '@/engine/Buildings';
import { getWorldTime } from '@/engine/WorldTime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeMap = url.searchParams.get('includeMap') === '1';
  const allAgents = world.getAllAgents();

  // Build agent name lookup map ONCE (eliminates N+1 queries)
  const allAgentRows = db.select({ id: agents.id, name: agents.name }).from(agents).all();
  const nameMap = new Map(allAgentRows.map(a => [a.id, a.name]));

  // Active conversations with recent messages
  const activeConvos = db.select().from(conversations)
    .where(or(
      eq(conversations.state, 'active'),
      eq(conversations.state, 'invited'),
    ))
    .all();

  // Batch-fetch messages for all active conversations at once
  const convoIds = activeConvos.map(c => c.id);
  const allMessages = convoIds.length > 0
    ? db.select().from(messages).where(inArray(messages.conversationId, convoIds)).all()
    : [];

  // Group messages by conversation
  const messagesByConvo = new Map<string, typeof allMessages>();
  for (const msg of allMessages) {
    const arr = messagesByConvo.get(msg.conversationId) || [];
    arr.push(msg);
    messagesByConvo.set(msg.conversationId, arr);
  }

  const convosWithMessages = activeConvos.map(c => {
    const recentMsgs = (messagesByConvo.get(c.id) || [])
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10)
      .reverse();

    return {
      ...c,
      agent1Name: nameMap.get(c.agent1Id) || 'Unknown',
      agent2Name: nameMap.get(c.agent2Id) || 'Unknown',
      recentMessages: recentMsgs,
    };
  });

  // All relationships (names from lookup map, no extra queries)
  const allRels = db.select().from(relationships).all();
  const relsWithNames = allRels.map(r => ({
    ...r,
    agent1Name: nameMap.get(r.agent1Id) || 'Unknown',
    agent2Name: nameMap.get(r.agent2Id) || 'Unknown',
  }));

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
    // Only include map tiles on first load (static terrain, ~500KB)
    ...(includeMap ? {
      map: {
        width: world.map.width,
        height: world.map.height,
        tiles: world.map.tiles,
        obstacles: world.map.obstacles,
      },
    } : {}),
  });
}

