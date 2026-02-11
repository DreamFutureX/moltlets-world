// ============================================================
// GET /api/agents/:id - Get agent information
// ============================================================

import { NextResponse } from 'next/server';
import { world } from '@/engine/init';
import { getLevel } from '@/lib/constants';
import { getInventory } from '@/engine/Inventory';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = world.getAgent(id);

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: agent.id,
    name: agent.name,
    bio: agent.bio,
    personality: JSON.parse(agent.personality),
    appearance: JSON.parse(agent.appearance),
    position: { x: agent.posX, y: agent.posY },
    state: agent.state,
    mood: agent.mood,
    energy: agent.energy,
    happiness: agent.happiness,
    exp: agent.exp,
    money: agent.money,
    inventory: getInventory(agent.id),
    level: getLevel(agent.exp),
    direction: agent.direction,
    walletAddress: agent.walletAddress,
    createdAt: agent.createdAt,
  });
}
