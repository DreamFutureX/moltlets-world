// ============================================================
// GET /api/conversations - List conversations
// ============================================================

import { NextResponse } from 'next/server';
import '@/engine/init';
import { db } from '@/db';
import { conversations, messages, agents } from '@/db/schema';
import { eq, or, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get('agentId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);

  let convos;

  if (agentId) {
    convos = db.select().from(conversations)
      .where(or(
        eq(conversations.agent1Id, agentId),
        eq(conversations.agent2Id, agentId),
      ))
      .all()
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  } else {
    convos = db.select().from(conversations)
      .all()
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  // Enrich with agent names and message counts
  const enriched = convos.map(c => {
    const agent1 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, c.agent1Id)).get();
    const agent2 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, c.agent2Id)).get();
    const msgCount = db.select().from(messages).where(eq(messages.conversationId, c.id)).all().length;

    return {
      ...c,
      agent1Name: agent1?.name || 'Unknown',
      agent2Name: agent2?.name || 'Unknown',
      messageCount: msgCount,
    };
  });

  return NextResponse.json({ conversations: enriched });
}
