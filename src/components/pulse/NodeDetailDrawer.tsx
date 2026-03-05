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
  happy: '😊', neutral: '😐', sad: '😢', excited: '🤩',
};

const STATE_EMOJI: Record<string, string> = {
  idle: '😐', walking: '🚶', talking: '💬', sleeping: '😴', building: '🏗️',
};

export default function NodeDetailDrawer({ agent, relationships, onClose }: Props) {
  if (!agent) return null;

  const appearance = typeof agent.appearance === 'string' ? JSON.parse(agent.appearance) : agent.appearance;
  const level = getLevel(agent.exp);
  const fishTotal = agent.inventory?.fish ? Object.values(agent.inventory.fish).reduce((a, b) => a + b, 0) : 0;

  const agentRels = relationships
    .filter(r => r.agent1Id === agent.id || r.agent2Id === agent.id)
    .map(r => ({
      ...r,
      otherName: r.agent1Id === agent.id ? r.agent2Name : r.agent1Name,
    }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-xl border border-black/8 w-[260px] max-h-[60vh] flex flex-col overflow-hidden animate-fade-in shadow-lg">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-black/5 flex items-center gap-2.5 shrink-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: appearance?.color || '#FFD93D' }}>
          <span className="text-xs">{MOOD_EMOJI[agent.mood] || '😐'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-bold text-gray-800 truncate font-display">{agent.name}</h3>
          <p className="text-[9px] text-gray-400">Lv {level} · {STATE_EMOJI[agent.state]} {agent.state}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-base leading-none">×</button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2.5 space-y-2.5">
        {/* Stats row */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-black/5 rounded-lg px-2 py-1.5">
            <span className="text-[8px] text-gray-400 uppercase">Energy</span>
            <div className="flex items-baseline gap-0.5 mt-0.5">
              <span className="text-xs font-bold text-gray-700">{Math.round(agent.energy)}</span>
              <span className="text-[8px] text-gray-300">/200</span>
            </div>
            <div className="h-1 bg-black/5 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-green-400 rounded-full" style={{ width: `${(agent.energy / 200) * 100}%` }} />
            </div>
          </div>
          <div className="bg-black/5 rounded-lg px-2 py-1.5">
            <span className="text-[8px] text-gray-400 uppercase">Happiness</span>
            <div className="flex items-baseline gap-0.5 mt-0.5">
              <span className="text-xs font-bold text-gray-700">{Math.round(agent.happiness)}</span>
              <span className="text-[8px] text-gray-300">/100</span>
            </div>
            <div className="h-1 bg-black/5 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-pink-400 rounded-full" style={{ width: `${Math.min(100, agent.happiness)}%` }} />
            </div>
          </div>
        </div>

        {/* Inventory */}
        <div className="flex gap-2.5 text-[10px]">
          <span className="text-amber-600">💰 ${Math.round(agent.money)}</span>
          <span className="text-orange-500">🪵 {agent.inventory?.wood || 0}</span>
          <span className="text-sky-600">🐟 {fishTotal}</span>
        </div>

        {/* Wallet */}
        {(agent as AgentData & { walletAddress?: string }).walletAddress && (
          <a
            href={getSolscanUrl((agent as AgentData & { walletAddress?: string }).walletAddress!)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-purple-600 hover:text-purple-800 transition-colors font-mono block truncate"
          >
            🔗 {(agent as AgentData & { walletAddress?: string }).walletAddress!.slice(0, 12)}...
          </a>
        )}

        {/* Relationships — top 6 only */}
        {agentRels.length > 0 && (
          <div className="border-t border-black/5 pt-2">
            <span className="text-[8px] text-gray-400 uppercase tracking-wider">Top Relationships</span>
            <div className="mt-1.5 space-y-1">
              {agentRels.slice(0, 6).map((r, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[r.status] || '#999' }} />
                  <span className="text-gray-600 flex-1 truncate">{r.otherName}</span>
                  <span className="text-gray-400 font-mono text-[9px]">{r.score > 0 ? '+' : ''}{r.score}</span>
                  <span className="text-gray-300 capitalize text-[8px]">{r.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Links */}
        <div className="border-t border-black/5 pt-2 flex gap-2">
          <Link href={`/agent/${agent.id}`} className="text-[9px] text-indigo-600 hover:text-indigo-800 transition-colors">
            View Profile →
          </Link>
          <Link href="/watch" className="text-[9px] text-green-600 hover:text-green-800 transition-colors">
            Watch Live →
          </Link>
        </div>
      </div>
    </div>
  );
}
