'use client';

// ============================================================
// Agent List Sidebar Panel - Compact Design
// ============================================================

import { useEffect, useState } from 'react';
import type { AgentData, InventoryData } from '@/types';

interface AgentListProps {
  onAgentSelect: (agentId: string) => void;
  selectedAgentId: string | null;
}

function getLevel(exp: number): number {
  return Math.floor(Math.sqrt((exp || 0) / 100)) + 1;
}

function getTotalFish(fish: Record<string, number> | undefined): number {
  if (!fish) return 0;
  return Object.values(fish).reduce((a, b) => a + b, 0);
}

function getInventorySummary(inventory: InventoryData | undefined) {
  if (!inventory) return { wood: 0, fish: 0 };
  return {
    wood: inventory.wood || 0,
    fish: getTotalFish(inventory.fish),
  };
}

export default function AgentList({ onAgentSelect, selectedAgentId }: AgentListProps) {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch('/api/world/state');
        const data = await res.json();
        setAgents(data.agents || []);
      } catch { /* ignore */ }
    };

    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, []);

  const filtered = search.trim()
    ? agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : agents;

  // Sort by level desc, then name
  const sorted = [...filtered].sort((a, b) => {
    const lvlDiff = getLevel(b.exp) - getLevel(a.exp);
    if (lvlDiff !== 0) return lvlDiff;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <span className="text-sm">👥</span>
        <span className="text-xs font-semibold text-white/80 uppercase tracking-wide">Agents</span>
        <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto">
          {agents.length}
        </span>
      </div>

      {/* Search */}
      <div className="px-2 py-2 border-b border-white/5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full bg-white/5 border border-white/8 rounded-md text-xs text-white/80 placeholder:text-white/25
                     px-2.5 py-1.5 outline-none focus:border-indigo-500/50 transition-all"
        />
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {sorted.length === 0 ? (
          <div className="px-4 py-6 text-center text-white/30 text-xs">
            {search ? `No agents matching "${search}"` : 'No agents yet'}
          </div>
        ) : (
          <div className="py-1">
            {sorted.map(agent => {
              const appearance = typeof agent.appearance === 'string'
                ? JSON.parse(agent.appearance as string)
                : agent.appearance;
              const isSelected = selectedAgentId === agent.id;
              const level = getLevel(agent.exp);
              const inv = getInventorySummary(agent.inventory);

              return (
                <button
                  key={agent.id}
                  onClick={() => onAgentSelect(agent.id)}
                  className={`w-full text-left px-2 py-1 flex items-center gap-2 transition-colors ${isSelected
                    ? 'bg-indigo-500/20 border-l-2 border-indigo-400'
                    : 'hover:bg-white/5 border-l-2 border-transparent'
                    }`}
                >
                  {/* Color dot */}
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: appearance?.color || '#FFD93D' }}
                  />

                  {/* Name */}
                  <span className="text-xs font-medium text-white/90 truncate flex-1 min-w-0">
                    {agent.name}
                  </span>

                  {/* Money */}
                  <span className="text-[10px] text-amber-400/80 shrink-0 w-10 text-right">
                    ${agent.money || 0}
                  </span>

                  {/* Inventory mini */}
                  <div className="flex items-center gap-1 shrink-0 text-[10px] w-12">
                    <span className={inv.wood > 0 ? 'text-orange-400/80' : 'text-white/20'}>
                      🪵{inv.wood}
                    </span>
                    <span className={inv.fish > 0 ? 'text-sky-400/80' : 'text-white/20'}>
                      🐟{inv.fish}
                    </span>
                  </div>

                  {/* Level */}
                  <span className="text-[9px] font-bold text-indigo-400/70 shrink-0 w-10 text-right">
                    LV {level}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
