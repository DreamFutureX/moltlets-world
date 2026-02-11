// ============================================================
// GET /api/health - Server health and stats
// ============================================================

import { NextResponse } from 'next/server';
import { world, gameLoop, eventBus } from '@/engine/init';
import { rateLimiter } from '@/lib/rate-limiter';
import { db } from '@/db';
import { agents, conversations, relationships } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Collect stats
    const allAgents = world.getAllAgents();
    const activeConvos = db.select().from(conversations)
      .where(eq(conversations.state, 'active'))
      .all();
    const totalRelationships = db.select().from(relationships).all().length;

    const loopStats = gameLoop.stats;
    const eventStats = eventBus.getStats();
    const rateLimiterStats = rateLimiter.getStats();

    // Memory usage (Node.js)
    const memUsage = process.memoryUsage();

    return NextResponse.json({
      status: 'healthy',
      timestamp: Date.now(),
      uptime: process.uptime(),

      // Game state
      game: {
        agents: allAgents.length,
        activeConversations: activeConvos.length,
        relationships: totalRelationships,
        isRunning: gameLoop.isRunning,
      },

      // Performance
      performance: {
        tickCount: loopStats.ticks,
        tickOverruns: loopStats.overruns,
        lastTickTime: loopStats.avgTickTime,
        sseConnections: eventStats.listeners,
        queuedEvents: eventStats.queuedEvents,
        rateLimitKeys: rateLimiterStats.activeKeys,
      },

      // Memory
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      },

      // Limits
      limits: {
        maxAgents: 500,
        agentActionsPerSec: 5,
        globalActionsPerSec: 500,
        joinsPerMinute: 10,
        looksPerSec: 10,
      },
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
