// ============================================================
// GET /api/stream - Server-Sent Events for real-time updates
// ============================================================

import { eventBus } from '@/engine/init';
import type { GameEvent } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
        }
      }, 15000);

      // Clean up on disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe();
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
