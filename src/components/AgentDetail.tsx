'use client';

// ============================================================
// Agent Detail Panel - Compact Redesign
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface AgentInfo {
  id: string;
  name: string;
  bio: string;
  personality: string[];
  appearance: { color: string; hat?: string; accessory?: string; expression?: string };
  position: { x: number; y: number };
  state: string;
  mood: string;
  energy: number;
  happiness: number;
  exp: number;
  money: number;
  level: number;
  direction: string;
  inventory: { wood: number; fish: Record<string, number>; items: Record<string, number> };
  walletAddress?: string;
  createdAt: number;
}

// Shorten wallet address for display (xxxx...xxxx)
function shortenAddress(address: string): string {
  if (!address || address.length < 12) return address || '';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

interface AgentDetailProps {
  agentId: string;
  onClose: () => void;
}

const stateEmoji: Record<string, string> = {
  idle: '💤', walking: '🚶', talking: '💬', sleeping: '😴', building: '🔨',
};

const moodEmoji: Record<string, string> = {
  happy: '😊', neutral: '😐', sad: '😢', excited: '🤩',
};

function getLevel(exp: number): number {
  return Math.floor(Math.sqrt(exp / 100)) + 1;
}

function getExpForLevel(level: number): number {
  return (level - 1) * (level - 1) * 100;
}

function getTotalFish(fish: Record<string, number> | undefined): number {
  if (!fish) return 0;
  return Object.values(fish).reduce((a, b) => a + b, 0);
}

export default function AgentDetail({ agentId, onClose }: AgentDetailProps) {
  const [agent, setAgent] = useState<AgentInfo | null>(null);

  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}`);
        const data = await res.json();
        setAgent(data);
      } catch { /* ignore */ }
    };

    fetchAgent();
    const interval = setInterval(fetchAgent, 3000);
    return () => clearInterval(interval);
  }, [agentId]);

  if (!agent) {
    return (
      <div className="p-3 text-center">
        <p className="text-white/30 text-xs">Loading...</p>
      </div>
    );
  }

  const level = agent.level ?? getLevel(agent.exp ?? 0);
  const expCurrent = agent.exp ?? 0;
  const expForNextLevel = getExpForLevel(level + 1);
  const expProgress = Math.min(100, (expCurrent / expForNextLevel) * 100);
  const totalFish = getTotalFish(agent.inventory?.fish);

  return (
    <div className="p-3 space-y-2">
      {/* Row 1: Avatar, Name, State, Money, Close */}
      <div className="flex items-center gap-2">
        {/* Avatar with level */}
        <div className="relative shrink-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-lg shadow-lg"
            style={{ backgroundColor: agent.appearance.color }}
          >
            {moodEmoji[agent.mood] || '😐'}
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 bg-indigo-500 text-[9px] font-bold text-white w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-[#16162a]">
            {level}
          </div>
        </div>

        {/* Name & State */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white/95 truncate">{agent.name}</span>
            <span className="text-xs text-white/40">{stateEmoji[agent.state] || '💤'}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/40">
            <span>({Math.round(agent.position.x)}, {Math.round(agent.position.y)})</span>
          </div>
        </div>

        {/* Money & Wallet */}
        <div className="text-right shrink-0">
          <div className="text-emerald-400 font-bold text-sm">${agent.money || 0}</div>
          {agent.walletAddress && (
            <a
              href={`https://solscan.io/account/${agent.walletAddress}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-purple-400/70 hover:text-purple-300 font-mono flex items-center gap-0.5 justify-end"
              title={agent.walletAddress}
            >
              <span>◎</span>
              <span>{shortenAddress(agent.walletAddress)}</span>
              <span className="text-[8px]">↗</span>
            </a>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-white/30 hover:text-white transition shrink-0"
        >
          ✕
        </button>
      </div>

      {/* Row 2: Stats bars inline */}
      <div className="flex gap-3">
        {/* Energy */}
        <div className="flex-1">
          <div className="flex items-center justify-between text-[9px] mb-0.5">
            <span className="text-emerald-400/70">⚡ {Math.round(agent.energy)}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${agent.energy}%`,
                background: agent.energy > 50 ? '#22c55e' : agent.energy > 20 ? '#f59e0b' : '#ef4444',
              }}
            />
          </div>
        </div>

        {/* Happiness */}
        <div className="flex-1">
          <div className="flex items-center justify-between text-[9px] mb-0.5">
            <span className="text-pink-400/70">💗 {Math.round(agent.happiness)}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${agent.happiness}%`,
                background: agent.happiness > 70 ? '#ec4899' : agent.happiness > 40 ? '#f97316' : '#64748b',
              }}
            />
          </div>
        </div>

        {/* XP */}
        <div className="flex-1">
          <div className="flex items-center justify-between text-[9px] mb-0.5">
            <span className="text-indigo-400/70">✨ {expCurrent}/{expForNextLevel}</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
              style={{ width: `${expProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Row 3: Inventory inline */}
      <div className="flex items-center gap-2 text-[11px]">
        <div className={`flex items-center gap-1 px-2 py-1 rounded ${agent.inventory?.wood > 0 ? 'bg-orange-500/15 text-orange-300' : 'bg-white/5 text-white/30'}`}>
          🪵 {agent.inventory?.wood || 0}
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded ${totalFish > 0 ? 'bg-sky-500/15 text-sky-300' : 'bg-white/5 text-white/30'}`}>
          🐟 {totalFish}
        </div>
        {Object.entries(agent.inventory?.items || {}).map(([item, count]) => (
          <div key={item} className="flex items-center gap-1 px-2 py-1 rounded bg-purple-500/15 text-purple-300">
            📦 {count}
          </div>
        ))}
        <div className="flex-1" />
        {/* Personality tags condensed */}
        {agent.personality.slice(0, 2).map((trait, i) => (
          <span key={i} className="text-[9px] px-1.5 py-0.5 bg-white/5 rounded text-white/50">{trait}</span>
        ))}
        {agent.personality.length > 2 && (
          <span className="text-[9px] text-white/30">+{agent.personality.length - 2}</span>
        )}
      </div>

      {/* Row 4: Bio (one line) */}
      <div className="text-[10px] text-white/40 truncate italic" title={agent.bio}>
        &ldquo;{agent.bio}&rdquo;
      </div>

      {/* Row 5: Profile & Diary link */}
      <Link
        href={`/agent/${agentId}`}
        className="flex items-center justify-center gap-1.5 text-[11px] text-amber-300/70 hover:text-amber-200 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-all"
      >
        <span>View Profile & Diary</span>
      </Link>
    </div>
  );
}
