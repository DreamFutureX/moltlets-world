// ============================================================
// GET /api/stream - Server-Sent Events for real-time updates
// Protected: per-IP connection limit + global cap
// ============================================================

import { eventBus } from '@/engine/init';
import { getClientIP } from '@/lib/rate-limiter';
import type { GameEvent } from '@/types';

export const dynamic = 'force-dynamic';

// SSE connection tracking
const MAX_CONNECTIONS_PER_IP = 5;
const MAX_GLOBAL_CONNECTIONS = 500;
const ipConnections = new Map<string, number>();
let globalConnections = 0;

export async function GET(request: Request) {
  const ip = getClientIP(request);

  // Check per-IP limit
  const currentIpConns = ipConnections.get(ip) || 0;
  if (currentIpConns >= MAX_CONNECTIONS_PER_IP) {
    return new Response(
      JSON.stringify({ error: 'Too many SSE connections from this IP', max: MAX_CONNECTIONS_PER_IP }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '10' } },
    );
  }

  // Check global limit
  if (globalConnections >= MAX_GLOBAL_CONNECTIONS) {
    return new Response(
      JSON.stringify({ error: 'Server at max SSE capacity', max: MAX_GLOBAL_CONNECTIONS }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } },
    );
  }

  // Track connection
  ipConnections.set(ip, currentIpConns + 1);
  globalConnections++;

  const cleanup = () => {
    const count = ipConnections.get(ip) || 1;
    if (count <= 1) {
      ipConnections.delete(ip);
    } else {
      ipConnections.set(ip, count - 1);
    }
    globalConnections = Math.max(0, globalConnections - 1);
  };

  const encoder = new TextEncoder();

  // Get 'since' parameter for catching up
  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  const sinceTs = since ? parseInt(since, 10) : undefined;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`),
      );

      // Send recent events for catch-up
      if (sinceTs) {
        const recentEvents = eventBus.getRecentEvents(sinceTs);
        for (const event of recentEvents) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
      }

      // Subscribe to new events
      const unsubscribe = eventBus.subscribe((event: GameEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Client disconnected
          unsubscribe();
          cleanup();
        }
      });

      // Heartbeat every 15 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`),
          );
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
          cleanup();
        }
      }, 15000);

      // Clean up on disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe();
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
