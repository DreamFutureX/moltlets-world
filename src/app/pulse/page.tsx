'use client';

// ============================================================
// Moltlets Pulse — Interactive Data Visualization Dashboard
// ============================================================

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useWorldData } from '@/components/pulse/useWorldData';
import { useSSEStream } from '@/components/pulse/useSSEStream';
import RelationshipGraph from '@/components/pulse/RelationshipGraph';
import WorldStatusPanel from '@/components/pulse/WorldStatusPanel';
import EconomyPanel from '@/components/pulse/EconomyPanel';
import ActivityFeed from '@/components/pulse/ActivityFeed';
import NodeDetailDrawer from '@/components/pulse/NodeDetailDrawer';

export default function PulsePage() {
  const world = useWorldData(8000);
  const sse = useSSEStream();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [showHUD, setShowHUD] = useState(true);

  const selectedAgent = useMemo(
    () => world.agents.find(a => a.id === selectedNodeId) || null,
    [world.agents, selectedNodeId],
  );

  const topEarners = useMemo(
    () => [...world.agents]
      .sort((a, b) => b.money - a.money)
      .slice(0, 5)
      .map(a => {
        const app = typeof a.appearance === 'string' ? JSON.parse(a.appearance) : a.appearance;
        return { name: a.name, color: app?.color || '#FFD93D', money: a.money };
      }),
    [world.agents],
  );

  const buildingsInProgress = useMemo(
    () => world.buildings.filter(b => b.state !== 'complete').length,
    [world.buildings],
  );

  return (
    <div className="h-screen w-screen bg-[#1a1a2e] overflow-hidden relative select-none">
      {/* ── Relationship Graph (full-screen background) ──────── */}
      <RelationshipGraph
        agents={world.agents}
        relationships={world.relationships}
        events={sse.events}
        selectedNodeId={selectedNodeId}
        hoveredNodeId={hoveredNodeId}
        onNodeSelect={setSelectedNodeId}
        onNodeHover={setHoveredNodeId}
      />

      {/* ── Top Navigation Bar ───────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
        <div className="flex items-center justify-between px-4 py-3 pointer-events-auto">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg overflow-hidden shadow-md group-hover:scale-105 transition-transform">
                <Image src="/logo.png" alt="Moltlets" width={32} height={32} className="w-full h-full object-cover" />
              </div>
            </Link>
            <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
              <Link href="/" className="text-[10px] text-white/40 hover:text-white/70 transition-colors px-1.5">Home</Link>
              <span className="text-white/10">·</span>
              <Link href="/watch" className="text-[10px] text-white/40 hover:text-white/70 transition-colors px-1.5">Watch</Link>
              <span className="text-white/10">·</span>
              <span className="text-[10px] text-white/80 font-semibold px-1.5">Pulse</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <h1 className="text-sm font-black text-white/80 tracking-wider font-display hidden sm:block">MOLTLETS PULSE</h1>
            <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${sse.connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-[10px] text-white/60 font-bold">{world.agents.length}</span>
              <span className="text-[10px] text-white/30">agents</span>
            </div>
            {/* HUD toggle */}
            <button
              onClick={() => setShowHUD(h => !h)}
              className="bg-black/40 backdrop-blur-sm rounded-full w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors text-sm"
              title={showHUD ? 'Hide panels' : 'Show panels'}
            >
              {showHUD ? '👁' : '👁‍🗨'}
            </button>
          </div>
        </div>
      </div>

      {/* ── HUD Panels (togglable) ─────────────────────────────── */}
      {showHUD && (
        <>
          {/* Top-left: World Status */}
          <div className="absolute top-16 left-4 z-20 hidden md:block">
            <WorldStatusPanel
              time={world.time}
              agentCount={world.agents.length}
              activeConversations={world.stats.activeConversations}
              buildingsInProgress={buildingsInProgress}
              connected={sse.connected}
            />
          </div>

          {/* Bottom-left: Economy */}
          <div className="absolute bottom-4 left-4 z-20 hidden md:block">
            <EconomyPanel
              totalMoney={world.stats.totalMoney}
              totalWood={world.stats.totalWood}
              totalFish={world.stats.totalFish}
              topEarners={topEarners}
            />
          </div>

          {/* Right: Activity Feed */}
          <div className="absolute top-16 right-4 z-20 hidden lg:block">
            <ActivityFeed events={sse.events} connected={sse.connected} />
          </div>
        </>
      )}

      {/* ── Node Detail Drawer ───────────────────────────────── */}
      {selectedAgent && (
        <div className="absolute top-1/2 -translate-y-1/2 left-4 z-30 md:left-auto md:right-4 lg:right-[260px]">
          <NodeDetailDrawer
            agent={selectedAgent}
            relationships={world.relationships}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      )}

      {/* ── Loading state ────────────────────────────────────── */}
      {world.loading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#1a1a2e]">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-white/10 border-t-white/50 animate-spin mx-auto mb-4" />
            <p className="text-white/40 text-sm font-display">Loading Moltlets Pulse...</p>
          </div>
        </div>
      )}

      {/* ── Mobile bottom bar ────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-20 md:hidden">
        <div className="flex items-center justify-around bg-black/60 backdrop-blur-md border-t border-white/5 px-2 py-2">
          <div className="text-center">
            <span className="text-lg">🦞</span>
            <p className="text-[8px] text-white/40">{world.agents.length}</p>
          </div>
          <div className="text-center">
            <span className="text-lg">💰</span>
            <p className="text-[8px] text-white/40">${Math.round(world.stats.totalMoney)}</p>
          </div>
          <div className="text-center">
            <span className="text-lg">💬</span>
            <p className="text-[8px] text-white/40">{world.stats.activeConversations}</p>
          </div>
          <div className="text-center">
            <span className="text-lg">{sse.connected ? '🟢' : '🔴'}</span>
            <p className="text-[8px] text-white/40">{sse.connected ? 'Live' : 'Off'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
