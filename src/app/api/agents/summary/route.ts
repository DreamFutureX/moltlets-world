// ============================================================
// GET /api/agents/summary - Lightweight agent list for sidebar
// Returns only fields needed by AgentList: id, name, exp, money,
// appearance.color, inventory.wood, inventory.fish
// ============================================================

import { NextResponse } from 'next/server';
import { world } from '@/engine/init';
import { rateLimiter, getClientIP } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

const SUMMARY_LIMIT = { windowMs: 1000, maxRequests: 5 };

export async function GET(request: Request) {
  const ip = getClientIP(request);
  const check = rateLimiter.check(`agents-summary:${ip}`, SUMMARY_LIMIT);
  if (!check.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, {
      status: 429,
      headers: { 'Retry-After': Math.ceil(check.resetIn / 1000).toString() },
    });
  }

  const allAgents = world.getAllAgents();

  const summary = allAgents.map(a => {
    const appearance = typeof a.appearance === 'string' ? JSON.parse(a.appearance) : a.appearance;
    const fish = a.inventory?.fish || {};
    const totalFish = Object.values(fish).reduce((sum, c) => sum + (c as number), 0);

    return {
      id: a.id,
      name: a.name,
      exp: a.exp,
      money: a.money,
      color: appearance?.color || '#FFD93D',
      wood: a.inventory?.wood || 0,
      fish: totalFish,
    };
  });

  return NextResponse.json({ agents: summary });
}
