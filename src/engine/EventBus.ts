// ============================================================
// Moltlets Town - SSE Event Bus (Server → Clients)
// Optimized for high-load (500+ agents, many SSE connections)
// ============================================================

import type { GameEvent, GameEventType } from '@/types';
import { db, safeDbOperation, getSqlite } from '@/db';
import { events } from '@/db/schema';

type Listener = (event: GameEvent) => void;

// Events that should NOT be persisted to DB (high-frequency, low-value)
const EPHEMERAL_EVENTS: Set<GameEventType> = new Set([
  'world_tick',
  'agent_move',
  'heartbeat',
]);

class EventBus {
  private listeners: Set<Listener> = new Set();
  private recentEvents: GameEvent[] = [];
  private maxRecent = 100;
  private eventQueue: GameEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor() {
    // Batch flush events to DB every 2 seconds (reduces DB writes)
    this.flushInterval = setInterval(() => this.flushEventQueue(), 2000);
  }

  /**
   * Subscribe to game events (used by SSE connections).
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get count of active listeners (SSE connections).
   */
  get connectionCount(): number {
    return this.listeners.size;
  }

  /**
   * Emit an event to all subscribers and queue for DB persistence.
   */
  emit(type: GameEventType, payload: Record<string, unknown>): void {
    const event: GameEvent = {
      type,
      payload,
      timestamp: Date.now(),
    };

    // Broadcast to all SSE listeners (with dead listener cleanup)
    const deadListeners: Listener[] = [];
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        deadListeners.push(listener);
      }
    }
    // Clean up dead listeners after iteration
    for (const dead of deadListeners) {
      this.listeners.delete(dead);
    }

    // Cache in memory (for new SSE clients to catch up)
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents.shift();
    }

    // Queue for DB persistence (skip ephemeral events)
    if (!EPHEMERAL_EVENTS.has(type)) {
      this.eventQueue.push(event);
      // Force flush if queue is getting large
      if (this.eventQueue.length >= 50) {
        this.flushEventQueue();
      }
    }
  }

  /**
   * Flush queued events to database in a single transaction.
   */
  private flushEventQueue(): void {
    if (this.isProcessing || this.eventQueue.length === 0) return;

    this.isProcessing = true;
    const toFlush = this.eventQueue.splice(0, this.eventQueue.length);

    safeDbOperation(() => {
      const sqlite = getSqlite();
      const insertStmt = sqlite.prepare(
        'INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)'
      );
      const transaction = sqlite.transaction((items: typeof toFlush) => {
        for (const e of items) {
          insertStmt.run(
            e.type,
            JSON.stringify(e.payload),
            e.timestamp,
          );
        }
      });
      transaction(toFlush);
    }, undefined);

    this.isProcessing = false;
  }

  /**
   * Get recent events (for new SSE clients to catch up).
   */
  getRecentEvents(since?: number): GameEvent[] {
    if (!since) return [...this.recentEvents];
    return this.recentEvents.filter(e => e.timestamp > since);
  }

  /**
   * Stop the event bus (cleanup)
   */
  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // Final flush
    this.flushEventQueue();
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { listeners: number; queuedEvents: number; recentEvents: number } {
    return {
      listeners: this.listeners.size,
      queuedEvents: this.eventQueue.length,
      recentEvents: this.recentEvents.length,
    };
  }
}

// Singleton
const globalForBus = globalThis as unknown as { __eventBus?: EventBus };
if (!globalForBus.__eventBus) {
  globalForBus.__eventBus = new EventBus();
}
export const eventBus = globalForBus.__eventBus;
