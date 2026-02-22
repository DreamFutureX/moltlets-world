// ============================================================
// Moltlets Town - Agent Diary (4-Hour Story Summaries)
// Generates short narrative paragraphs from game events
// ============================================================

import { db, safeDbOperation } from '@/db';
import { events, agents, agentDiary } from '@/db/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

const DIARY_PERIOD_MS = 4 * 60 * 60 * 1000;

interface DiaryEntry {
  text: string;
  icon: string;
}

interface DiaryStats {
  treesChopped: number;
  fishCaught: number;
  goldEarned: number;
  conversationsHad: number;
  buildActions: number;
  itemsCrafted: number;
}

/**
 * Generate diary entries for all active agents.
 * Called every 4 hours by GameLoop.
 */
export function generateDiaries(): void {
  const now = Date.now();
  const periodEnd = now;
  const periodStart = now - DIARY_PERIOD_MS;

  console.log('[Diary] Generating 4-hour summaries...');

  const allAgents = safeDbOperation(() => {
    return db.select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(gte(agents.lastActiveAt, periodStart))
      .all();
  }, []);

  if (allAgents.length === 0) {
    console.log('[Diary] No active agents, skipping');
    return;
  }

  let generated = 0;

  for (const agent of allAgents) {
    // Check if diary already exists for this period
    const existing = safeDbOperation(() => {
      return db.select({ id: agentDiary.id })
        .from(agentDiary)
        .where(and(
          eq(agentDiary.agentId, agent.id),
          gte(agentDiary.periodEnd, periodStart),
        ))
        .get();
    }, undefined);

    if (existing) continue;

    const { entries, stats } = buildDiaryForAgent(agent.id, agent.name, periodStart, periodEnd);

    safeDbOperation(() => {
      db.insert(agentDiary).values({
        agentId: agent.id,
        periodStart,
        periodEnd,
        summary: JSON.stringify(entries),
        stats: JSON.stringify(stats),
        createdAt: now,
      }).run();
    }, undefined);

    generated++;
  }

  console.log(`[Diary] Generated ${generated} diary entries for ${allAgents.length} agents`);
}

/**
 * Build diary entries for a single agent from events in a time period.
 */
function buildDiaryForAgent(
  agentId: string,
  agentName: string,
  periodStart: number,
  periodEnd: number,
): { entries: DiaryEntry[]; stats: DiaryStats } {
  const entries: DiaryEntry[] = [];
  const stats: DiaryStats = {
    treesChopped: 0,
    fishCaught: 0,
    goldEarned: 0,
    conversationsHad: 0,
    buildActions: 0,
    itemsCrafted: 0,
  };

  // Query events in this period that involve this agent
  const periodEvents = safeDbOperation(() => {
    return db.select()
      .from(events)
      .where(and(
        gte(events.createdAt, periodStart),
        lte(events.createdAt, periodEnd),
      ))
      .all();
  }, []);

  // Filter events related to this agent
  const agentEvents = periodEvents.filter(e => {
    const payload = JSON.parse(e.payload);
    return payload.agentId === agentId ||
           payload.agent1Id === agentId ||
           payload.agent2Id === agentId ||
           payload.ownerId === agentId;
  });

  // Aggregate by type
  let woodGathered = 0;
  const fishCaught: Record<string, number> = {};
  let totalGoldEarned = 0;
  const conversationPartners: Map<string, { name: string; msgCount: number }> = new Map();
  const buildingNames: string[] = [];
  const relChanges: { name: string; oldStatus: string; newStatus: string }[] = [];
  let itemsCrafted = 0;

  for (const event of agentEvents) {
    const payload = JSON.parse(event.payload);

    switch (event.type) {
      case 'tree_chopped': {
        stats.treesChopped++;
        woodGathered += (payload.woodGained as number) || 1;
        break;
      }
      case 'item_collected': {
        if (payload.itemType === 'fish' || payload.fishType) {
          const fishType = (payload.fishType as string) || 'fish';
          fishCaught[fishType] = (fishCaught[fishType] || 0) + 1;
          stats.fishCaught++;
        }
        if (payload.recipeId) {
          itemsCrafted++;
          stats.itemsCrafted++;
        }
        break;
      }
      case 'money_earned': {
        const amount = (payload.amount as number) || 0;
        totalGoldEarned += amount;
        stats.goldEarned += amount;
        break;
      }
      case 'conversation_end': {
        stats.conversationsHad++;
        const partnerId = payload.agent1Id === agentId ? payload.agent2Id : payload.agent1Id;
        const partnerName = (payload.agent1Id === agentId ? payload.agent2Name : payload.agent1Name) as string || 'someone';
        const msgCount = (payload.messageCount as number) || 0;
        const existing = conversationPartners.get(partnerId as string);
        if (existing) {
          existing.msgCount += msgCount;
        } else {
          conversationPartners.set(partnerId as string, { name: partnerName, msgCount });
        }
        break;
      }
      case 'building_progress':
      case 'building_started': {
        stats.buildActions++;
        if (payload.ownerName) {
          buildingNames.push(payload.ownerName as string);
        }
        break;
      }
      case 'relationship_change': {
        const otherName = (payload.agent1Id === agentId ? payload.agent2Name : payload.agent1Name) as string || 'someone';
        if (payload.oldStatus !== payload.newStatus) {
          relChanges.push({
            name: otherName,
            oldStatus: (payload.oldStatus as string) || 'stranger',
            newStatus: (payload.newStatus as string) || 'acquaintance',
          });
        }
        break;
      }
    }
  }

  // Build a short paragraph story from aggregated activities
  const sentences: string[] = [];

  if (stats.treesChopped > 0) {
    const woodPhrases = [
      `headed into the forest and chopped down ${stats.treesChopped} tree${stats.treesChopped > 1 ? 's' : ''}, collecting ${woodGathered} wood`,
      `spent some time lumberjacking — ${woodGathered} wood richer after felling ${stats.treesChopped} tree${stats.treesChopped > 1 ? 's' : ''}`,
      `swung an axe in the woods and came back with ${woodGathered} wood`,
    ];
    sentences.push(woodPhrases[stats.treesChopped % woodPhrases.length]);
  }

  if (stats.fishCaught > 0) {
    const fishNames = Object.keys(fishCaught);
    const bestCatch = fishNames.reduce((best, f) => (fishCaught[f] > fishCaught[best] ? f : best), fishNames[0]);
    if (stats.fishCaught === 1) {
      sentences.push(`tried fishing by the water and pulled out a ${bestCatch}`);
    } else {
      sentences.push(`sat by the water and reeled in ${stats.fishCaught} fish, including a nice ${bestCatch}`);
    }
  }

  if (stats.goldEarned > 0) {
    sentences.push(`sold some goods at the market and pocketed ${totalGoldEarned} gold`);
  }

  if (conversationPartners.size > 0) {
    const names = [...conversationPartners.values()].map(p => p.name);
    const totalMsgs = [...conversationPartners.values()].reduce((s, p) => s + p.msgCount, 0);
    if (names.length === 1) {
      const depth = totalMsgs > 10 ? 'a long heart-to-heart' : totalMsgs > 5 ? 'a friendly chat' : 'a quick catch-up';
      sentences.push(`had ${depth} with ${names[0]}`);
    } else if (names.length <= 3) {
      sentences.push(`hung out and chatted with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
    } else {
      sentences.push(`hung out and chatted with ${names.slice(0, 3).join(', ')} and ${names.length - 3} others`);
    }
  }

  if (stats.buildActions > 0) {
    const uniqueOwners = [...new Set(buildingNames)];
    const ownerText = uniqueOwners.length > 0 ? uniqueOwners[0] : 'a neighbor';
    sentences.push(`pitched in to help build ${ownerText}'s house`);
  }

  if (stats.itemsCrafted > 0) {
    sentences.push(`crafted ${itemsCrafted} item${itemsCrafted > 1 ? 's' : ''} at the workbench`);
  }

  for (const rel of relChanges) {
    const verb = getRelVerb(rel.oldStatus, rel.newStatus);
    sentences.push(`felt their bond with ${rel.name} ${verb}`);
  }

  // Combine into a short paragraph story
  if (sentences.length === 0) {
    entries.push({
      text: `${agentName} had a quiet afternoon, wandering through the village and enjoying the breeze. Sometimes the best days are the slow ones.`,
      icon: '🌿',
    });
  } else {
    // Capitalize first sentence and join with natural connectors
    const connectors = ['. Then ', '. After that, ', '. Later, ', '. Also '];
    let story = `${agentName} ${sentences[0]}`;
    for (let i = 1; i < sentences.length; i++) {
      story += connectors[i % connectors.length] + sentences[i];
    }
    story += '.';
    // Pick icon based on primary activity
    const icon = stats.treesChopped > 0 ? '🪓' :
                 stats.fishCaught > 0 ? '🎣' :
                 conversationPartners.size > 0 ? '💬' :
                 stats.buildActions > 0 ? '🏗️' :
                 stats.goldEarned > 0 ? '💰' : '📝';
    entries.push({ text: story, icon });
  }

  return { entries, stats };
}

function getRelVerb(oldStatus: string, newStatus: string): string {
  const levels = ['rival', 'stranger', 'acquaintance', 'friend', 'close_friend'];
  const oldIdx = levels.indexOf(oldStatus);
  const newIdx = levels.indexOf(newStatus);
  if (newIdx > oldIdx) return 'grew stronger';
  if (newIdx < oldIdx) return 'cooled off';
  return 'changed';
}

/**
 * Get diary entries for a specific agent (for API).
 */
export function getAgentDiary(agentId: string, limit: number = 10): {
  periodStart: number;
  periodEnd: number;
  entries: DiaryEntry[];
  stats: DiaryStats;
  createdAt: number;
}[] {
  return safeDbOperation(() => {
    const rows = db.select()
      .from(agentDiary)
      .where(eq(agentDiary.agentId, agentId))
      .orderBy(desc(agentDiary.periodEnd))
      .limit(limit)
      .all();

    return rows.map(row => ({
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      entries: JSON.parse(row.summary) as DiaryEntry[],
      stats: JSON.parse(row.stats) as DiaryStats,
      createdAt: row.createdAt,
    }));
  }, []);
}
