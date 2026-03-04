'use client';

// ============================================================
// Custom hook: SSE stream from /api/stream for real-time events
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameEvent } from '@/types';

const MAX_EVENTS = 15;
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30000;
const HIDDEN_EVENTS = new Set(['heartbeat', 'world_tick', 'agent_move']);

export interface SSEStreamState {
  events: GameEvent[];
  connected: boolean;
  lastEventAt: number | null;
}

export function useSSEStream(): SSEStreamState {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const eventsRef = useRef<GameEvent[]>([]);
  const retryCount = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const url = lastEventAt ? `/api/stream?since=${lastEventAt}` : '/api/stream';
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      retryCount.current = 0;
    };

    es.onmessage = (e) => {
      try {
        const event: GameEvent = JSON.parse(e.data);
        if (HIDDEN_EVENTS.has(event.type)) {
          // Still track timestamp for reconnection catch-up
          if (event.timestamp) setLastEventAt(event.timestamp);
          return;
        }

        eventsRef.current = [...eventsRef.current.slice(-(MAX_EVENTS - 1)), event];
        setEvents(eventsRef.current);
        if (event.timestamp) setLastEventAt(event.timestamp);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      setConnected(false);

      // Exponential backoff reconnect
      const delay = Math.min(RECONNECT_BASE * Math.pow(2, retryCount.current), RECONNECT_MAX);
      retryCount.current++;
      setTimeout(connect, delay);
    };
  }, [lastEventAt]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { events, connected, lastEventAt };
}
