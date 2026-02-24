// ============================================================
// GET /api/health - Health check for Railway
// Checks DB connectivity and game loop state
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { eventBus } from '@/engine/init';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Check DB is accessible
    const agentCount = db.select().from(agents).all().length;

    // Check EventBus is alive
    const busStats = eventBus.getStats();

    return NextResponse.json({
      status: 'healthy',
      timestamp: Date.now(),
      uptime: process.uptime(),
      agents: agentCount,
      connections: busStats.listeners,
      eventQueue: busStats.queuedEvents,
    });
  } catch (err) {
    console.error('[Health] Error:', err);
    return NextResponse.json({
      status: 'unhealthy',
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: Date.now(),
    }, { status: 500 });
  }
}
