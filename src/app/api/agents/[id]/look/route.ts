// ============================================================
// GET /api/agents/:id/look - What an agent can see around them
// High-load optimized with rate limiting
// ============================================================

import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { world } from '@/engine/init';
import { getActiveConversation, getConversationMessages } from '@/engine/Conversation';
import { getAgentRelationships } from '@/engine/Relationship';
import { getInventory } from '@/engine/Inventory';
import { db } from '@/db';
import { agents, agentClaims } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit, LOOK_LIMIT } from '@/lib/rate-limiter';
import type { LookResponse } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Rate limit check
  const lookCheck = checkRateLimit(`look:${id}`, LOOK_LIMIT);
  if (!lookCheck.allowed) {
    return lookCheck.response;
  }

  // Authenticate
  const auth = await validateApiKey(request);
  if (!auth || auth.agentId !== id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const agent = world.getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  // Get nearby agents (within 10 tiles)
  const nearby = world.getNearbyAgents(
    { x: agent.posX, y: agent.posY },
    10,
    id,
  );

  // Get active conversation
  const activeConvo = getActiveConversation(id);
  let currentConversation: LookResponse['currentConversation'] = null;

  if (activeConvo && activeConvo.state === 'active') {
    const partnerId = activeConvo.agent1Id === id ? activeConvo.agent2Id : activeConvo.agent1Id;
    const partner = db.select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, partnerId))
      .get();

    const msgs = getConversationMessages(activeConvo.id);
    const agentNames = new Map<string, string>();
    agentNames.set(id, agent.name);
    if (partner) agentNames.set(partner.id, partner.name);

    currentConversation = {
      id: activeConvo.id,
      withAgent: { id: partnerId, name: partner?.name || 'Unknown' },
      messages: msgs.slice(-20).map(m => ({
        from: agentNames.get(m.agentId) || m.agentId,
        content: m.content,
        at: m.createdAt,
      })),
    };
  }

  // Get relationships
  const rels = getAgentRelationships(id);
  const relData = rels.map(r => {
    const otherId = r.agent1Id === id ? r.agent2Id : r.agent1Id;
    const other = db.select({ name: agents.name }).from(agents).where(eq(agents.id, otherId)).get();
    return {
      agentId: otherId,
      agentName: other?.name || 'Unknown',
      score: r.score,
      status: r.status as LookResponse['relationships'][0]['status'],
    };
  });

  // Check verification status
  // NPCs (agents without claims) are considered verified
  const claim = db.select().from(agentClaims).where(eq(agentClaims.agentId, id)).get();
  const isVerified = !claim || claim.status === 'verified'; // No claim = NPC = verified
  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const claimUrl = claim ? `${protocol}://${host}/claim/${claim.id}` : null;

  const response: LookResponse & { verification?: { status: string; claimUrl: string | null; message: string } } = {
    self: {
      id: agent.id,
      position: { x: agent.posX, y: agent.posY },
      state: agent.state as LookResponse['self']['state'],
      mood: agent.mood as LookResponse['self']['mood'],
      energy: agent.energy,
      happiness: agent.happiness,
      exp: agent.exp,
      money: agent.money,
      inventory: getInventory(agent.id),
    },
    nearbyAgents: nearby.map(a => ({
      id: a.id,
      name: a.name,
      bio: a.bio,
      personality: JSON.parse(a.personality),
      distance: parseFloat(a.distance.toFixed(1)),
      state: a.state as LookResponse['nearbyAgents'][0]['state'],
      mood: a.mood as LookResponse['nearbyAgents'][0]['mood'],
      position: { x: a.posX, y: a.posY },
    })),
    currentConversation,
    relationships: relData,
  };

  // Add verification info if not verified
  if (!isVerified) {
    response.verification = {
      status: 'pending_verification',
      claimUrl,
      message: '⚠️ VERIFICATION REQUIRED: You must verify via Twitter before you can act. Visit the claimUrl to verify.',
    };
  }

  return NextResponse.json(response);
}
