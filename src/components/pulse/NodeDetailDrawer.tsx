'use client';

import type { AgentData, RelationshipData } from '@/types';
import Link from 'next/link';
import { getSolscanUrl } from '@/lib/solana-urls';

interface Props {
  agent: AgentData | null;
  relationships: (RelationshipData & { agent1Name: string; agent2Name: string })[];
  onClose: () => void;
}

function getLevel(exp: number): number {
  return Math.floor(Math.sqrt((exp || 0) / 100)) + 1;
}

const STATUS_COLORS: Record<string, string> = {
  rival: '#e74c3c',
  stranger: '#95a5a6',
  acquaintance: '#3498db',
  friend: '#2ecc71',
  close_friend: '#e91e8a',
};

const MOOD_EMOJI: Record<string, string> = {
  happy: '😊',
  neutral: '😐',
  sad: '😢',
  excited: '🤩',
};

const STATE_EMOJI: Record<string, string> = {
  idle: '😐',
  walking: '🚶',
  talking: '💬',
  sleeping: '😴',
  building: '🏗️',
};

export default function NodeDetailDrawer({ agent, relationships, onClose }: Props) {
  if (!agent) return null;

  const appearance = typeof agent.appearance === 'string' ? JSON.parse(agent.appearance) : agent.appearance;
  const level = getLevel(agent.exp);
  const fishTotal = agent.inventory?.fish ? Object.values(agent.inventory.fish).reduce((a, b) => a + b, 0) : 0;

  // Get this agent's relationships
  const agentRels = relationships
    .filter(r => r.agent1Id === agent.id || r.agent2Id === agent.id)
    .map(r => ({
      ...r,
      otherName: r.agent1Id === agent.id ? r.agent2Name : r.agent1Name,
    }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="bg-black/60 backdrop-blur-xl rounded-xl border border-white/10 w-[280px] max-h-[70vh] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: appearance?.color || '#FFD93D' }}>
          <span className="text-sm">{MOOD_EMOJI[agent.mood] || '😐'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white truncate font-display">{agent.name}</h3>
          <p className="text-[10px] text-white/40">Lv {level} · {STATE_EMOJI[agent.state]} {agent.state}</p>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-lg">×</button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
        {/* Bio */}
        <p className="text-[11px] text-white/50 leading-relaxed">{agent.bio}</p>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/5 rounded-lg px-2.5 py-2">
            <span className="text-[9px] text-white/30 uppercase">Energy</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-sm font-bold text-white/80">{agent.energy}</span>
              <span className="text-[9px] text-white/30">/200</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-green-400/60 rounded-full" style={{ width: `${(agent.energy / 200) * 100}%` }} />
            </div>
          </div>
          <div className="bg-white/5 rounded-lg px-2.5 py-2">
            <span className="text-[9px] text-white/30 uppercase">Happiness</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-sm font-bold text-white/80">{agent.happiness}</span>
              <span className="text-[9px] text-white/30">/100</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-pink-400/60 rounded-full" style={{ width: `${agent.happiness}%` }} />
            </div>
          </div>
        </div>

        {/* Inventory */}
        <div className="flex gap-3 text-[11px]">
          <span className="text-amber-400/80">💰 ${Math.round(agent.money)}</span>
          <span className="text-orange-400/80">🪵 {agent.inventory?.wood || 0}</span>
          <span className="text-sky-400/80">🐟 {fishTotal}</span>
        </div>

        {/* Wallet */}
        {(agent as AgentData & { walletAddress?: string }).walletAddress && (
          <a
            href={getSolscanUrl((agent as AgentData & { walletAddress?: string }).walletAddress!)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-purple-400/60 hover:text-purple-300 transition-colors font-mono block truncate"
          >
            🔗 {(agent as AgentData & { walletAddress?: string }).walletAddress!.slice(0, 12)}...
          </a>
        )}

        {/* Relationships */}
        {agentRels.length > 0 && (
          <div className="border-t border-white/5 pt-3">
            <span className="text-[9px] text-white/40 uppercase tracking-wider">Relationships ({agentRels.length})</span>
            <div className="mt-2 space-y-1.5">
              {agentRels.slice(0, 10).map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[r.status] || '#999' }} />
                  <span className="text-white/60 flex-1 truncate">{r.otherName}</span>
                  <span className="text-white/30 font-mono">{r.score > 0 ? '+' : ''}{r.score}</span>
                  <span className="text-white/20 capitalize text-[8px]">{r.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Links */}
        <div className="border-t border-white/5 pt-3 flex gap-2">
          <Link
            href={`/agent/${agent.id}`}
            className="text-[10px] text-indigo-400/70 hover:text-indigo-300 transition-colors"
          >
            View Profile →
          </Link>
          <Link
            href="/watch"
            className="text-[10px] text-green-400/70 hover:text-green-300 transition-colors"
          >
            Watch Live →
          </Link>
        </div>
      </div>
    </div>
  );
}
