'use client';

// ============================================================
// Moltlets Pulse — Interactive Data Visualization Dashboard
// ============================================================

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useWorldData } from '@/components/pulse/useWorldData';
import { useSSEStream } from '@/components/pulse/useSSEStream';
import BrainGraph from '@/components/pulse/BrainGraph';
import WorldStatusPanel from '@/components/pulse/WorldStatusPanel';
import EconomyPanel from '@/components/pulse/EconomyPanel';
import AgentStatsPanel from '@/components/pulse/AgentStatsPanel';
import OnChainPanel from '@/components/pulse/OnChainPanel';
import FunStatsPanel from '@/components/pulse/FunStatsPanel';
import ActivityFeed from '@/components/pulse/ActivityFeed';
import NodeDetailDrawer from '@/components/pulse/NodeDetailDrawer';

const MOBILE_TABS = [
  { id: 'world', icon: '🌍', label: 'World' },
  { id: 'economy', icon: '💰', label: 'Economy' },
  { id: 'stats', icon: '📊', label: 'Stats' },
  { id: 'vibe', icon: '✨', label: 'Vibe' },
  { id: 'chain', icon: '⛓', label: 'Chain' },
] as const;

type MobileTabId = typeof MOBILE_TABS[number]['id'];

export default function PulsePage() {
  const world = useWorldData(8000);
  const sse = useSSEStream();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [showHUD, setShowHUD] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTabId | null>(null);

  const selectedAgent = useMemo(
    () => world.agents.find(a => a.id === selectedNodeId) || null,
    [world.agents, selectedNodeId],
  );

  const topEarners = useMemo(
    () => [...world.agents]
      .sort((a, b) => b.money - a.money)
      .slice(0, 5)
      .map(a => {
        let app;
        try { app = typeof a.appearance === 'string' ? JSON.parse(a.appearance) : a.appearance; } catch { app = null; }
        return { name: a.name, color: app?.color || '#FFD93D', money: a.money };
      }),
    [world.agents],
  );

  const buildingsInProgress = useMemo(
    () => world.buildings.filter(b => b.state !== 'complete').length,
    [world.buildings],
  );

  // Render full panel for the active mobile tab
  const renderMobilePanel = () => {
    if (!mobileTab) return null;

    switch (mobileTab) {
      case 'world':
        return (
          <WorldStatusPanel
            time={world.time}
            agentCount={world.agents.length}
            activeConversations={world.stats.activeConversations}
            buildingsInProgress={buildingsInProgress}
            connected={sse.connected}
          />
        );
      case 'economy':
        return (
          <EconomyPanel
            totalMoney={world.stats.totalMoney}
            totalWood={world.stats.totalWood}
            totalFish={world.stats.totalFish}
            topEarners={topEarners}
          />
        );
      case 'stats':
        return (
          <AgentStatsPanel
            agents={world.agents}
            stateCount={world.stats.stateCount}
          />
        );
      case 'vibe':
        return (
          <FunStatsPanel
            agents={world.agents}
            relationships={world.relationships}
            stateCount={world.stats.stateCount}
          />
        );
      case 'chain':
        return <OnChainPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen w-screen bg-[#030308] overflow-hidden relative select-none">
      {/* ── 3D Brain Graph (full-screen background) ──────────── */}
      <BrainGraph
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
            <div className="flex items-center gap-1.5 bg-white/[0.08] backdrop-blur-xl rounded-full px-3 py-1.5 border border-white/[0.15] shadow-lg shadow-black/10">
              <Link href="/" className="text-[10px] text-white/50 hover:text-white/90 transition-colors px-1.5">Home</Link>
              <span className="text-white/25">·</span>
              <Link href="/watch" className="text-[10px] text-white/50 hover:text-white/90 transition-colors px-1.5">Watch</Link>
              <span className="text-white/25">·</span>
              <span className="text-[10px] text-white/80 font-semibold px-1.5">Pulse</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <h1 className="text-sm font-black text-white/70 tracking-wider font-display hidden sm:block">MOLTLETS PULSE</h1>
            <div className="flex items-center gap-1.5 bg-white/[0.08] backdrop-blur-xl rounded-full px-3 py-1.5 border border-white/[0.15] shadow-lg shadow-black/10">
              <span className={`w-1.5 h-1.5 rounded-full ${sse.connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-[10px] text-white/70 font-bold">{world.agents.length}</span>
              <span className="text-[10px] text-white/50">agents</span>
            </div>
            <button
              onClick={() => setShowHUD(h => !h)}
              className="bg-white/[0.08] backdrop-blur-xl rounded-full w-8 h-8 flex items-center justify-center text-white/50 hover:text-white/90 transition-colors text-sm border border-white/[0.15] shadow-lg shadow-black/10"
              title={showHUD ? 'Hide panels' : 'Show panels'}
            >
              {showHUD ? '👁' : '👁‍🗨'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Desktop HUD Panels (hidden on mobile) ──────────── */}
      {showHUD && (
        <>
          {/* Left column: World Status + Economy */}
          <div className="absolute top-16 left-4 z-20 hidden md:flex flex-col gap-3">
            <WorldStatusPanel
              time={world.time}
              agentCount={world.agents.length}
              activeConversations={world.stats.activeConversations}
              buildingsInProgress={buildingsInProgress}
              connected={sse.connected}
            />
            <EconomyPanel
              totalMoney={world.stats.totalMoney}
              totalWood={world.stats.totalWood}
              totalFish={world.stats.totalFish}
              topEarners={topEarners}
            />
          </div>

          {/* Right column: Agent Stats + Vibe Check */}
          <div className="absolute top-16 right-4 z-20 hidden lg:flex flex-col gap-3 items-end">
            <AgentStatsPanel
              agents={world.agents}
              stateCount={world.stats.stateCount}
            />
            <FunStatsPanel
              agents={world.agents}
              relationships={world.relationships}
              stateCount={world.stats.stateCount}
            />
          </div>

          {/* Bottom-right: On-Chain (desktop) */}
          <div className="absolute bottom-4 right-4 z-20 hidden md:block">
            <OnChainPanel />
          </div>
        </>
      )}

      {/* ── Activity Ticker (desktop — bottom center) ────────── */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 hidden md:block">
        <ActivityFeed events={sse.events} connected={sse.connected} />
      </div>

      {/* ── Node Detail Drawer (centered) ────────────────────── */}
      {selectedAgent && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30">
          <NodeDetailDrawer
            agent={selectedAgent}
            relationships={world.relationships}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      )}

      {/* ── Loading state ────────────────────────────────────── */}
      {world.loading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#030308]">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-white/10 border-t-white/50 animate-spin mx-auto mb-4" />
            <p className="text-white/40 text-sm font-display">Loading Moltlets Pulse...</p>
          </div>
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────── */}
      {!world.loading && world.error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#030308]/90">
          <div className="text-center">
            <p className="text-red-400/80 text-sm mb-3">Failed to load world data</p>
            <button
              onClick={world.refresh}
              className="bg-white/10 hover:bg-white/20 text-white/70 text-xs px-4 py-2 rounded-full transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile: Full Panel + Tab Bar ──────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-20 md:hidden">
        {/* Full panel (appears when a tab is active) */}
        {mobileTab && (
          <div className="px-3 pb-2 [&>div]:!w-full">
            {renderMobilePanel()}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex items-center justify-around bg-black/70 backdrop-blur-md border-t border-white/[0.1] px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {MOBILE_TABS.map(tab => {
            const isActive = mobileTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setMobileTab(isActive ? null : tab.id)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all ${
                  isActive
                    ? 'bg-white/[0.12] scale-105'
                    : 'hover:bg-white/[0.05] active:scale-95'
                }`}
              >
                <span className="text-base">{tab.icon}</span>
                <span className={`text-[8px] font-medium transition-colors ${isActive ? 'text-white/90' : 'text-white/50'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
