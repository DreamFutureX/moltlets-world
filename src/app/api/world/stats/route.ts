// ============================================================
// GET /api/world/stats - Lightweight stats for header/homepage
// No conversations, no messages, no map tiles, no relationships
// ============================================================

import { NextResponse } from 'next/server';
import { world } from '@/engine/init';
import { db } from '@/db';
import { conversations } from '@/db/schema';
import { eq, or } from 'drizzle-orm';
import { getAllTreeStates } from '@/engine/Resources';
import { getWorldTime } from '@/engine/WorldTime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const allAgents = world.getAllAgents();

  // Count active conversations (just count, no messages)
  const activeConvoCount = db.select({ id: conversations.id }).from(conversations)
    .where(or(
      eq(conversations.state, 'active'),
      eq(conversations.state, 'invited'),
    ))
    .all().length;

  const treeStates = getAllTreeStates();
  const treeStatesArray = Array.from(treeStates.values());
  const worldTimeData = getWorldTime();

  const totalMoney = allAgents.reduce((sum, a) => sum + (a.money || 0), 0);
  const totalFish = allAgents.reduce((sum, a) => {
    const fish = a.inventory?.fish || {};
    return sum + Object.values(fish).reduce((f, c) => f + (c as number), 0);
  }, 0);
  const totalWood = allAgents.reduce((sum, a) => sum + (a.inventory?.wood || 0), 0);

  return NextResponse.json({
    agentCount: allAgents.length,
    time: worldTimeData,
    stats: {
      treesGrown: treeStatesArray.filter(s => s === 'full').length,
      treesTotal: treeStatesArray.length,
      totalMoney,
      totalFish,
      totalWood,
      activeConversations: activeConvoCount,
    },
  });
}
