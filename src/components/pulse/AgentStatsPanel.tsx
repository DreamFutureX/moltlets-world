'use client';

import type { AgentData } from '@/types';

interface Props {
  agents: AgentData[];
  stateCount: Record<string, number>;
}

const STATE_COLORS: Record<string, string> = {
  idle: '#95a5a6',
  walking: '#3498db',
  talking: '#2ecc71',
  sleeping: '#9b59b6',
  building: '#e67e22',
};

const STATE_EMOJI: Record<string, string> = {
  idle: '😐',
  walking: '🚶',
  talking: '💬',
  sleeping: '😴',
  building: '🏗️',
};

export default function AgentStatsPanel({ agents, stateCount }: Props) {
  const total = agents.length || 1;

  return (
    <div className="bg-black/50 backdrop-blur-md rounded-xl border border-white/10 p-4 w-[200px]">
      <h3 className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-3 font-display">Agent Stats</h3>

      {/* State distribution */}
      <div className="space-y-1 mb-3">
        <span className="text-[9px] text-white/40 uppercase tracking-wider">Activity</span>
        {Object.entries(stateCount).map(([state, count]) => (
          <div key={state} className="flex items-center gap-1.5 text-[10px]">
            <span className="w-4">{STATE_EMOJI[state] || ''}</span>
            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(count / total) * 100}%`, backgroundColor: STATE_COLORS[state] || '#999' }}
              />
            </div>
            <span className="text-white/50 w-6 text-right font-mono">{count}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
