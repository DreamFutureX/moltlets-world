'use client';

import { useState, useEffect, useRef } from 'react';
import type { GameEvent } from '@/types';

interface Props {
  events: GameEvent[];
  connected: boolean;
}

const EVENT_CONFIG: Record<string, { icon: string; format: (p: Record<string, unknown>) => string }> = {
  chat_message: { icon: '💬', format: (p) => `${p.agentName || 'Agent'} said something` },
  money_earned: { icon: '💰', format: (p) => `${p.agentName || 'Agent'} earned $${p.amount || 0}` },
  item_collected: { icon: '🎣', format: (p) => `${p.agentName || 'Agent'} caught ${p.itemName || 'something'}` },
  tree_chopped: { icon: '🪓', format: (p) => `${p.agentName || 'Agent'} chopped a tree` },
  building_started: { icon: '🏗️', format: (p) => `${p.agentName || 'Agent'} started building` },
  building_completed: { icon: '🏠', format: (p) => `${p.ownerName || 'Agent'}'s house is complete!` },
  building_progress: { icon: '🔨', format: (p) => `${p.agentName || 'Agent'} contributed wood` },
  relationship_change: { icon: '💕', format: (p) => `${p.agent1Name || 'Agent'} & ${p.agent2Name || 'Agent'}: ${p.newStatus || 'changed'}` },
  conversation_start: { icon: '🗣️', format: (p) => `${p.agent1Name || 'Agent'} is talking to ${p.agent2Name || 'Agent'}` },
  conversation_end: { icon: '👋', format: () => `Conversation ended` },
  weather_change: { icon: '🌦️', format: (p) => `Weather changed to ${p.weather || 'unknown'}` },
  time_change: { icon: '🕐', format: (p) => `Day ${p.day || '?'}, Month ${p.month || '?'}` },
  agent_join: { icon: '⭐', format: (p) => `${p.agentName || 'New agent'} joined the world!` },
  agent_leave: { icon: '👋', format: (p) => `${p.agentName || 'Agent'} left the world` },
  agent_emote: { icon: '😄', format: (p) => `${p.agentName || 'Agent'} ${p.emoji || 'emoted'}` },
  agent_state_change: { icon: '🔄', format: (p) => `${p.agentName || 'Agent'} is now ${p.newState || 'idle'}` },
  tree_regrown: { icon: '🌱', format: () => 'A tree has regrown' },
  tree_spawned: { icon: '🌳', format: () => 'A new tree appeared' },
  activity_start: { icon: '⚡', format: (p) => `${p.agentName || 'Agent'} started ${p.activity || 'activity'}` },
};

export default function ActivityFeed({ events, connected }: Props) {
  const [displayEvent, setDisplayEvent] = useState<{ icon: string; text: string; key: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<{ icon: string; text: string }[]>([]);
  const keyRef = useRef(0);
  const cycleIndexRef = useRef(0);

  // Queue new events
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    const config = EVENT_CONFIG[latest.type];
    if (!config) return;
    const payload = latest.payload as Record<string, unknown>;
    queueRef.current.push({ icon: config.icon, text: config.format(payload) });
    if (queueRef.current.length > 20) queueRef.current.shift();
  }, [events.length]);

  // Cycle: fade in → hold → fade out → next
  useEffect(() => {
    const showNext = () => {
      const recentEvents = events.slice(-10);
      let item: { icon: string; text: string } | undefined;

      if (queueRef.current.length > 0) {
        item = queueRef.current.shift();
      } else if (recentEvents.length > 0) {
        const idx = cycleIndexRef.current % recentEvents.length;
        const evt = recentEvents[idx];
        const config = EVENT_CONFIG[evt.type];
        if (config) {
          const payload = evt.payload as Record<string, unknown>;
          item = { icon: config.icon, text: config.format(payload) };
        }
        cycleIndexRef.current++;
      }

      if (!item) {
        timerRef.current = setTimeout(showNext, 2000);
        return;
      }

      keyRef.current++;
      setDisplayEvent({ ...item, key: keyRef.current });
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
        timerRef.current = setTimeout(showNext, 600);
      }, 3500);
    };

    timerRef.current = setTimeout(showNext, 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="flex items-center justify-center gap-2 pointer-events-none">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-green-500/60' : 'bg-red-400/60'}`} />
      <div
        className="transition-opacity duration-500 ease-in-out"
        style={{ opacity: visible && displayEvent ? 1 : 0 }}
      >
        {displayEvent && (
          <span
            key={displayEvent.key}
            className="text-xs text-white/50 whitespace-nowrap"
            style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
          >
            {displayEvent.icon} {displayEvent.text}
          </span>
        )}
      </div>
    </div>
  );
}
