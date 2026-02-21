// ============================================================
// GET /api/agents/:id/diary - Get agent diary entries
// ============================================================

import { NextResponse } from 'next/server';
import { getAgentDiary } from '@/engine/Diary';
import { world } from '@/engine/init';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = world.getAgent(id);

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  const diary = getAgentDiary(id, 30);

  return NextResponse.json({
    agentId: id,
    agentName: agent.name,
    entries: diary,
  });
}
