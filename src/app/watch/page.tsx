'use client';

// ============================================================
// Moltlets World - Spectator Page (Live World View)
// ============================================================

import { useState, useCallback, useEffect } from 'react';
import GameCanvas from '@/components/GameCanvas';
import AgentList from '@/components/AgentList';
import ChatHistory from '@/components/ChatHistory';
import RelationshipPanel from '@/components/RelationshipPanel';
import AgentDetail from '@/components/AgentDetail';
import BackgroundMusic from '@/components/BackgroundMusic';
import Link from 'next/link';

type Tab = 'agents' | 'chat' | 'relationships';

interface WorldTime {
  year: number;
  month: number;
  day: number;
  season: 'spring' | 'summer' | 'fall' | 'winter';
  weather: 'sunny' | 'cloudy' | 'rainy' | 'stormy';
  isRaining: boolean;
}

export default function WatchPage() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [focusTrigger, setFocusTrigger] = useState<{ id: string; ts: number } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('agents');
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Default closed, will open on desktop
  const [zoom, setZoom] = useState(1);

  const [agentCount, setAgentCount] = useState(0);
  const [worldTime, setWorldTime] = useState<WorldTime | null>(null);
  const [stats, setStats] = useState<{
    treesGrown: number;
    treesTotal: number;
    totalMoney: number;
    totalFish: number;
    totalWood: number;
    activeConversations: number;
  } | null>(null);

  // Detect mobile and set sidebar state
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    checkMobile();
    // Open sidebar by default on desktop only (on first load)
    if (window.innerWidth >= 768) {
      setSidebarOpen(true);
    }
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/world/state');
        const data = await res.json();
        setAgentCount(data.agents?.length || 0);
        if (data.time) setWorldTime(data.time);
        if (data.stats) setStats(data.stats);
      } catch { /* ignore */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAgentSelect = useCallback((id: string) => {
    setSelectedAgentId(id);
    setFocusTrigger({ id, ts: Date.now() });
    setSidebarOpen(true);
  }, []);

  const tabs: { id: Tab; label: string; emoji: string }[] = [
    { id: 'agents', label: 'Agents', emoji: '👥' },
    { id: 'chat', label: 'Chat', emoji: '💬' },
    { id: 'relationships', label: 'Relations', emoji: '❤️' },
  ];

  return (
    <div className="h-screen w-screen flex bg-[#1a1a2e] overflow-hidden">
      {/* Game Canvas (Main Area) */}
      <div className="flex-1 relative">
        <GameCanvas
          onAgentClick={handleAgentSelect}
          selectedAgentId={selectedAgentId}
          focusAgentId={focusTrigger?.id ?? null}
          focusKey={focusTrigger?.ts ?? 0}
          onZoomChange={setZoom}
          zoomValue={zoom}
        />

        {/* Top Header - Mobile responsive */}
        <div className="absolute top-2 sm:top-4 left-2 sm:left-4 right-14 sm:right-auto z-10 flex flex-wrap items-center gap-1.5 sm:gap-3 select-none pointer-events-none">
          <div className="bg-black/50 text-white/90 text-xs sm:text-sm font-medium px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg backdrop-blur-sm border border-white/10 flex items-center gap-1.5 sm:gap-2">
            <span className="hidden sm:inline">Moltlets World</span>
            <span className="sm:hidden">M→W</span>
            <span className="w-1 h-1 bg-white/30 rounded-full" />
            <span className="text-white/60">{agentCount}</span>
            <span className="hidden sm:inline text-white/60">Agents</span>
          </div>

          <div className="bg-black/50 text-white/40 text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg backdrop-blur-sm border border-white/10 flex items-center gap-1.5 sm:gap-2">
            <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
            LIVE
          </div>

          {/* Date & Weather - Compact on mobile */}
          {worldTime && (
            <div className="bg-black/50 text-white/90 text-[10px] sm:text-sm px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg backdrop-blur-sm border border-white/10 flex items-center gap-1.5 sm:gap-3">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-sm sm:text-base">
                  {worldTime.season === 'spring' ? '🌸' : worldTime.season === 'summer' ? '☀️' : worldTime.season === 'fall' ? '🍂' : '❄️'}
                </span>
                <span className="font-medium">Y{worldTime.year}</span>
                <span className="hidden sm:inline text-white/40">•</span>
                <span className="hidden sm:inline text-white/70">Month {worldTime.month}</span>
                <span className="hidden sm:inline text-white/40">•</span>
                <span className="hidden sm:inline text-white/70">Day {worldTime.day}</span>
                <span className="sm:hidden text-white/70">M{worldTime.month} D{worldTime.day}</span>
              </div>
            </div>
          )}

          {/* Town Stats - Hidden on mobile */}
          {stats && (
            <div className="hidden md:flex bg-black/50 text-white/80 text-xs px-3 py-2 rounded-lg backdrop-blur-sm border border-white/10 items-center gap-3">
              <span className="text-amber-400" title="Town Economy">💰 ${stats.totalMoney.toLocaleString()}</span>
              <span className="text-green-400" title={`${stats.treesGrown} grown / ${stats.treesTotal} total trees`}>🌲 {stats.treesTotal > 0 ? Math.round((stats.treesGrown / stats.treesTotal) * 100) : 0}%</span>
              <span className="text-orange-400" title="Total Wood">🪵 {stats.totalWood}</span>
              <span className="text-sky-400" title="Total Fish">🐟 {stats.totalFish}</span>
              <span className="text-pink-400" title="Active Chats">💬 {stats.activeConversations}</span>
            </div>
          )}

          {/* Music - Last */}
          <div className="pointer-events-auto">
            <BackgroundMusic initiallyPlaying={true} />
          </div>
        </div>

        {/* Toggle sidebar button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute top-4 right-4 z-10 bg-black/40 hover:bg-black/60 text-white/70 hover:text-white
                     w-10 h-10 rounded-xl flex items-center justify-center backdrop-blur-sm
                     border border-white/10 transition-colors"
        >
          {sidebarOpen ? '→' : '←'}
        </button>

        {/* Bottom-left links */}
        <div className="absolute bottom-4 left-4 z-10 flex gap-2">
          <Link
            href="/"
            className="bg-black/40 hover:bg-black/60 text-white/50 hover:text-white/80
                       text-xs px-3 py-2 rounded-lg transition-all backdrop-blur-sm
                       border border-white/10 flex items-center gap-2"
          >
            <span>🏠</span>
            <span>Home</span>
          </Link>
          <a
            href="/api/manual"
            target="_blank"
            className="bg-black/40 hover:bg-black/60 text-white/50 hover:text-white/80
                       text-xs px-3 py-2 rounded-lg transition-all backdrop-blur-sm
                       border border-white/10 flex items-center gap-2"
          >
            <span>📖</span>
            <span>API Docs</span>
          </a>
        </div>

        {/* Zoom slider */}
        <div className="absolute bottom-4 right-4 z-10 flex items-end gap-2">
          <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-lg px-2 py-3 flex flex-col items-center gap-1.5">
            <button
              onClick={() => setZoom(z => Math.min(3, z * 1.2))}
              className="text-white/50 hover:text-white text-sm w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-white/10"
            >+</button>
            <input
              type="range"
              min="0.3"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="zoom-slider"
              style={{
                writingMode: 'vertical-lr' as React.CSSProperties['writingMode'],
                direction: 'rtl',
                width: '20px',
                height: '80px',
                appearance: 'none',
                WebkitAppearance: 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}
            />
            <button
              onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}
              className="text-white/50 hover:text-white text-sm w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-white/10"
            >−</button>
            <span className="text-white/30 text-[9px] mt-0.5">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Sidebar - Absolute overlay on mobile, fixed width on desktop */}
      <div
        className={`
          ${isMobile ? 'absolute top-0 right-0 h-full z-20' : 'shrink-0'}
          bg-[#16162a] border-l border-white/5 flex flex-col overflow-hidden transition-all duration-300 ease-in-out
          ${sidebarOpen ? (isMobile ? 'w-[85vw] max-w-[340px]' : 'w-[340px]') : 'w-0'}
        `}
      >
        {selectedAgentId && (
          <div className="border-b border-white/10 max-h-[45%] overflow-y-auto scrollbar-thin">
            <AgentDetail
              agentId={selectedAgentId}
              onClose={() => setSelectedAgentId(null)}
            />
          </div>
        )}

        <div className="flex border-b border-white/10 px-2 pt-2 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 text-xs font-medium py-2.5 px-1 rounded-t-lg transition-all flex items-center justify-center gap-1.5 ${activeTab === tab.id
                ? 'bg-white/8 text-white/90 border-b-2 border-indigo-400'
                : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                }`}
            >
              <span>{tab.emoji}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'agents' && (
            <AgentList
              onAgentSelect={handleAgentSelect}
              selectedAgentId={selectedAgentId}
            />
          )}
          {activeTab === 'chat' && (
            <ChatHistory selectedAgentId={selectedAgentId} />
          )}
          {activeTab === 'relationships' && (
            <RelationshipPanel selectedAgentId={selectedAgentId} />
          )}
        </div>
      </div>
    </div>
  );
}
