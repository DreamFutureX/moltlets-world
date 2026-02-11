// ============================================================
// GET /api/relationships - Relationship data
// ============================================================

import { NextResponse } from 'next/server';
import '@/engine/init';
import { db } from '@/db';
import { relationships, agents } from '@/db/schema';
import { eq, or } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get('agentId');

  let rels;

  if (agentId) {
    rels = db.select().from(relationships)
      .where(or(
        eq(relationships.agent1Id, agentId),
        eq(relationships.agent2Id, agentId),
      ))
      .all();
  } else {
    rels = db.select().from(relationships).all();
  }

  const enriched = rels.map(r => {
    const agent1 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, r.agent1Id)).get();
    const agent2 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, r.agent2Id)).get();
    return {
      ...r,
      agent1Name: agent1?.name || 'Unknown',
      agent2Name: agent2?.name || 'Unknown',
    };
  });

  return NextResponse.json({ relationships: enriched });
}
