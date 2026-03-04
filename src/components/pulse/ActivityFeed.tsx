'use client';

import { useRef, useEffect } from 'react';
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
  conversation_end: { icon: '👋', format: (p) => `Conversation ended` },
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

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function ActivityFeed({ events, connected }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="bg-black/50 backdrop-blur-md rounded-xl border border-white/10 w-[240px] flex flex-col max-h-[50vh]">
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest font-display">Activity</span>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
        <span className="text-[9px] text-white/30 ml-auto">{events.length} events</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-0.5">
        {events.length === 0 ? (
          <p className="text-[10px] text-white/20 text-center py-4">Waiting for events...</p>
        ) : (
          events.slice(-10).map((evt, i) => {
            const config = EVENT_CONFIG[evt.type];
            if (!config) return null;
            const payload = evt.payload as Record<string, unknown>;

            return (
              <div
                key={i}
                className="flex items-start gap-1.5 px-1.5 py-1 rounded-md hover:bg-white/5 transition-colors animate-fade-in"
              >
                <span className="text-[10px] shrink-0 mt-0.5">{config.icon}</span>
                <span className="text-[10px] text-white/60 flex-1 leading-snug">{config.format(payload)}</span>
                <span className="text-[8px] text-white/20 shrink-0 mt-0.5 font-mono">{timeAgo(evt.timestamp)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
