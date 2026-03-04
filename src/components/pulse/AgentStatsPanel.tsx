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

function getLevel(exp: number): number {
  return Math.floor(Math.sqrt((exp || 0) / 100)) + 1;
}

export default function AgentStatsPanel({ agents, stateCount }: Props) {
  const total = agents.length || 1;

  // Level distribution
  const levels: Record<number, number> = {};
  for (const a of agents) {
    const lv = getLevel(a.exp);
    levels[lv] = (levels[lv] || 0) + 1;
  }
  const maxLv = Math.max(...Object.keys(levels).map(Number), 1);
  const maxLvCount = Math.max(...Object.values(levels), 1);

  // Variant distribution
  const variants: Record<string, number> = {};
  for (const a of agents) {
    const app = typeof a.appearance === 'string' ? JSON.parse(a.appearance) : a.appearance;
    const v = app?.variant || 'lobster-bot';
    variants[v] = (variants[v] || 0) + 1;
  }

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

      {/* Level histogram */}
      <div className="border-t border-white/5 pt-2 mb-3">
        <span className="text-[9px] text-white/40 uppercase tracking-wider">Levels</span>
        <div className="flex items-end gap-px mt-1.5 h-8">
          {Array.from({ length: maxLv }, (_, i) => i + 1).map(lv => (
            <div key={lv} className="flex-1 flex flex-col items-center">
              <div
                className="w-full rounded-t-sm bg-indigo-400/50 transition-all duration-500"
                style={{ height: `${((levels[lv] || 0) / maxLvCount) * 100}%`, minHeight: levels[lv] ? 2 : 0 }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-px text-[7px] text-white/25 mt-0.5">
          {Array.from({ length: maxLv }, (_, i) => (
            <div key={i} className="flex-1 text-center">{i + 1}</div>
          ))}
        </div>
      </div>

      {/* Variant distribution */}
      <div className="border-t border-white/5 pt-2">
        <span className="text-[9px] text-white/40 uppercase tracking-wider">Species</span>
        <div className="mt-1.5 space-y-1">
          {Object.entries(variants).sort((a, b) => b[1] - a[1]).map(([v, count]) => (
            <div key={v} className="flex justify-between text-[10px] text-white/60">
              <span className="capitalize">{v.replace('-', ' ')}</span>
              <span className="text-white/40 font-mono">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
