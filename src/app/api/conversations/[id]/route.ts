// ============================================================
// GET /api/conversations/:id - Conversation detail with messages
// ============================================================

import { NextResponse } from 'next/server';
import '@/engine/init';
import { db } from '@/db';
import { conversations, messages, agents } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const convo = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!convo) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const agent1 = db.select({ id: agents.id, name: agents.name })
    .from(agents).where(eq(agents.id, convo.agent1Id)).get();
  const agent2 = db.select({ id: agents.id, name: agents.name })
    .from(agents).where(eq(agents.id, convo.agent2Id)).get();

  const allMessages = db.select().from(messages)
    .where(eq(messages.conversationId, id))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);

  // Build agent name lookup
  const nameMap = new Map<string, string>();
  if (agent1) nameMap.set(agent1.id, agent1.name);
  if (agent2) nameMap.set(agent2.id, agent2.name);

  return NextResponse.json({
    conversation: {
      ...convo,
      agent1Name: agent1?.name || 'Unknown',
      agent2Name: agent2?.name || 'Unknown',
    },
    messages: allMessages.map(m => ({
      ...m,
      agentName: nameMap.get(m.agentId) || 'Unknown',
    })),
  });
}
