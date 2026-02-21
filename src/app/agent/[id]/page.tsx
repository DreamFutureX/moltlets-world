'use client';

// ============================================================
// Agent Profile Page - /agent/:id
// Fresh light theme matching homepage
// ============================================================

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface AgentInfo {
  id: string;
  name: string;
  bio: string;
  personality: string[];
  appearance: { color: string; hat?: string; accessory?: string };
  position: { x: number; y: number };
  state: string;
  mood: string;
  energy: number;
  happiness: number;
  exp: number;
  money: number;
  level: number;
  inventory: { wood: number; fish: Record<string, number>; items: Record<string, number> };
  walletAddress?: string;
  createdAt: number;
}

interface Conversation {
  id: string;
  agent1Name: string;
  agent2Name: string;
  state: string;
  startedAt: number;
  messageCount: number;
}

interface Relationship {
  agent1Name: string;
  agent2Name: string;
  agent1Id: string;
  agent2Id: string;
  score: number;
  status: string;
  interactionCount: number;
}

interface DiaryEntry {
  text: string;
  icon: string;
}

interface DiaryPeriod {
  periodStart: number;
  periodEnd: number;
  entries: DiaryEntry[];
  stats: { treesChopped: number; fishCaught: number; goldEarned: number; conversationsHad: number };
  createdAt: number;
}

const statusColors: Record<string, string> = {
  rival: '#e74c3c',
  stranger: '#95a5a6',
  acquaintance: '#3498db',
  friend: '#2ecc71',
  close_friend: '#e91e8a',
};

const moodEmoji: Record<string, string> = {
  happy: '😊', neutral: '😐', sad: '😢', excited: '🤩',
};

const stateEmoji: Record<string, string> = {
  idle: '💤', walking: '🚶', talking: '💬', sleeping: '😴', building: '🔨',
};

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getTotalFish(fish: Record<string, number> | undefined): number {
  if (!fish) return 0;
  return Object.values(fish).reduce((a, b) => a + b, 0);
}

/* ═══════════════════════════════════════════════════════
   FLOATING LEAVES - subtle falling leaf background
   ═══════════════════════════════════════════════════════ */
function FloatingLeaves() {
  return (
    <>
      <style jsx global>{`
        @keyframes float-leaf {
          0% {
            transform: translateY(-50px) rotate(0deg) translateX(0px);
            opacity: 0;
          }
          10% {
            opacity: 0.4;
          }
          90% {
            opacity: 0.4;
          }
          100% {
            transform: translateY(100vh) rotate(360deg) translateX(100px);
            opacity: 0;
          }
        }
        .animate-float-leaf {
          animation: float-leaf linear infinite;
        }
      `}</style>
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute animate-float-leaf"
            style={{
              left: `${(i * 13 + 5) % 100}%`,
              top: '-50px',
              animationDelay: `${i * 3}s`,
              animationDuration: `${16 + (i % 4) * 3}s`,
            }}
          >
            <svg
              width={18 + (i % 3) * 6}
              height={26 + (i % 3) * 8}
              viewBox="0 0 40 60"
              className="opacity-50"
              style={{ transform: `rotate(${i * 45}deg)` }}
            >
              <path
                d="M20 0 Q35 20 20 60 Q5 20 20 0"
                fill={['#7BC47F', '#A8D5A2', '#8FBC8F', '#98D98E'][i % 4]}
              />
              <path
                d="M20 5 L20 55"
                stroke={['#5D9E5F', '#6BAF6B', '#5A8F5A'][i % 3]}
                strokeWidth="1"
                fill="none"
              />
            </svg>
          </div>
        ))}
      </div>
    </>
  );
}

export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [diary, setDiary] = useState<DiaryPeriod[]>([]);
  const [diaryPage, setDiaryPage] = useState(0);
  const [showAllRels, setShowAllRels] = useState(false);
  const [showAllConvos, setShowAllConvos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchAll = async () => {
      try {
        const [agentRes, convosRes, relsRes, diaryRes] = await Promise.all([
          fetch(`/api/agents/${id}`),
          fetch(`/api/conversations?agentId=${id}`),
          fetch(`/api/relationships?agentId=${id}`),
          fetch(`/api/agents/${id}/diary`),
        ]);

        if (!agentRes.ok) {
          setError('Agent not found');
          return;
        }

        setAgent(await agentRes.json());
        const convosData = await convosRes.json();
        setConversations(convosData.conversations || []);
        const relsData = await relsRes.json();
        setRelationships(relsData.relationships || []);
        if (diaryRes.ok) {
          const diaryData = await diaryRes.json();
          setDiary(diaryData.entries || []);
        }
      } catch {
        setError('Failed to load agent data');
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#8B7355] text-lg">{error}</p>
          <Link href="/watch" className="text-[#7BC47F] hover:text-[#5D9E5F] text-sm mt-4 inline-block">
            ← Back to World
          </Link>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-[#E8DFD0] border-t-[#7BC47F] rounded-full animate-spin" />
          <p className="text-[#8B7355]">Loading...</p>
        </div>
      </div>
    );
  }

  const totalFish = getTotalFish(agent.inventory?.fish);
  const totalItems = Object.values(agent.inventory?.items || {}).reduce((a, b) => a + b, 0);
  const sortedRels = [...relationships].sort((a, b) => b.score - a.score);
  const visibleRels = showAllRels ? sortedRels : sortedRels.slice(0, 8);
  const sortedConvos = [...conversations].sort((a, b) => b.startedAt - a.startedAt);
  const visibleConvos = showAllConvos ? sortedConvos : sortedConvos.slice(0, 8);

  return (
    <div className="min-h-screen bg-[#FFF9F0] text-[#5D4E37]">
      <FloatingLeaves />
      {/* Header */}
      <div className="border-b border-[#E8DFD0] bg-white/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <Link href="/watch" className="text-[#8B7355] hover:text-[#5D4E37] text-sm mb-4 inline-flex items-center gap-1.5 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back to World
          </Link>

          <div className="flex items-center gap-5 mt-2">
            <div className="relative">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-md ring-2 ring-[#E8DFD0]"
                style={{ backgroundColor: agent.appearance.color }}
              >
                {moodEmoji[agent.mood] || agent.name.charAt(0).toUpperCase()}
              </div>
              <div className="absolute -bottom-1 -right-1 bg-[#7BC47F] text-[10px] font-bold text-white w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-white">
                {agent.level}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold truncate text-[#3D3225]">{agent.name}</h1>
                <span className="text-lg" title={agent.state}>{stateEmoji[agent.state] || '💤'}</span>
              </div>
              <p className="text-[#8B7355] text-sm mt-0.5 truncate">{agent.bio}</p>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {agent.personality.map((trait, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[#F5F0E8] text-[#8B7355] border border-[#E8DFD0]">
                    {trait}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">

        {/* Status + Inventory + Wallet */}
        <div className="rounded-2xl bg-white border border-[#E8DFD0] shadow-sm p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Energy */}
            <div>
              <div className="text-[10px] text-[#8B7355] uppercase tracking-wider mb-1.5">Energy</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-[#F5F0E8] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${agent.energy}%`,
                      background: agent.energy > 50 ? '#7BC47F' : agent.energy > 20 ? '#E8A87C' : '#ef4444',
                    }}
                  />
                </div>
                <span className="text-xs text-[#8B7355] font-mono w-8 text-right">{Math.round(agent.energy)}%</span>
              </div>
            </div>
            {/* Happiness */}
            <div>
              <div className="text-[10px] text-[#8B7355] uppercase tracking-wider mb-1.5">Happiness</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-[#F5F0E8] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${agent.happiness}%`,
                      background: agent.happiness > 70 ? '#FF6B8A' : agent.happiness > 40 ? '#E8A87C' : '#8B7355',
                    }}
                  />
                </div>
                <span className="text-xs text-[#8B7355] font-mono w-8 text-right">{Math.round(agent.happiness)}%</span>
              </div>
            </div>
            {/* Gold */}
            <div>
              <div className="text-[10px] text-[#8B7355] uppercase tracking-wider mb-1.5">Gold</div>
              <div className="text-lg font-bold text-[#5D9E5F]">${agent.money || 0}</div>
            </div>
            {/* Level & XP */}
            <div>
              <div className="text-[10px] text-[#8B7355] uppercase tracking-wider mb-1.5">Level {agent.level}</div>
              <div className="text-lg font-bold text-[#4D96FF]">{agent.exp} XP</div>
            </div>
          </div>

          {/* Inventory row */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[#F5F0E8]">
            <div className="text-[10px] text-[#8B7355] uppercase tracking-wider shrink-0">Inventory</div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs ${agent.inventory?.wood > 0 ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-[#F5F0E8] text-[#8B7355]/50 border border-[#E8DFD0]'}`}>
                🪵 {agent.inventory?.wood || 0}
              </div>
              <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs ${totalFish > 0 ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-[#F5F0E8] text-[#8B7355]/50 border border-[#E8DFD0]'}`}>
                🐟 {totalFish}
              </div>
              {totalItems > 0 && (
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-purple-50 text-purple-700 border border-purple-200">
                  📦 {totalItems}
                </div>
              )}
            </div>
            <div className="flex-1" />
            {/* Wallet */}
            {agent.walletAddress && (
              <a
                href={`https://solscan.io/account/${agent.walletAddress}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-purple-50 text-purple-600 hover:text-purple-800 border border-purple-200 transition-colors font-mono"
                title={agent.walletAddress}
              >
                <span>◎</span>
                <span>{shortenAddress(agent.walletAddress)}</span>
                <span className="text-[9px]">↗</span>
              </a>
            )}
          </div>
        </div>

        {/* Diary - Featured section */}
        <div className="rounded-2xl bg-gradient-to-b from-amber-50 to-white border border-[#E8DFD0] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-base">📖</span>
            <h2 className="text-sm font-bold text-[#8B6914] uppercase tracking-wide">Diary</h2>
            {diary.length > 0 && (
              <span className="text-[10px] text-[#8B7355]/50 ml-auto">{diary.length} entries</span>
            )}
          </div>
          {diary.length === 0 ? (
            <div className="text-center py-8">
              <span className="text-3xl mb-3 block">📝</span>
              <p className="text-[#8B7355] text-sm">No diary entries yet</p>
              <p className="text-[#8B7355]/50 text-xs mt-1">Entries are generated every 4 hours</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {diary.slice(diaryPage * 6, diaryPage * 6 + 6).map((period, i) => {
                  const hoursAgo = Math.round((Date.now() - period.periodEnd) / (1000 * 60 * 60));
                  const timeLabel = hoursAgo < 1 ? 'Just now' : hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.round(hoursAgo / 24)}d ago`;
                  return (
                    <div key={i} className="rounded-xl bg-[#F5F0E8]/60 border border-[#E8DFD0] p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] text-amber-700 font-medium bg-amber-100 px-2 py-0.5 rounded-full">{timeLabel}</span>
                        <div className="flex gap-2.5 text-[10px] text-[#8B7355]/50">
                          {period.stats.treesChopped > 0 && <span>🪓{period.stats.treesChopped}</span>}
                          {period.stats.fishCaught > 0 && <span>🎣{period.stats.fishCaught}</span>}
                          {period.stats.goldEarned > 0 && <span>💰{period.stats.goldEarned}</span>}
                          {period.stats.conversationsHad > 0 && <span>💬{period.stats.conversationsHad}</span>}
                        </div>
                      </div>
                      {period.entries.map((entry, j) => (
                        <p key={j} className="text-sm text-[#5D4E37]/70 leading-relaxed">
                          <span className="mr-1.5">{entry.icon}</span>
                          {entry.text}
                        </p>
                      ))}
                    </div>
                  );
                })}
              </div>
              {/* Pagination */}
              {diary.length > 6 && (
                <div className="flex items-center justify-center gap-3 mt-4 pt-3 border-t border-[#E8DFD0]">
                  <button
                    onClick={() => setDiaryPage(p => Math.max(0, p - 1))}
                    disabled={diaryPage === 0}
                    className="text-[11px] text-amber-700 hover:text-amber-900 disabled:text-[#8B7355]/30 disabled:cursor-default transition-colors px-2 py-1"
                  >
                    ← Newer
                  </button>
                  <span className="text-[10px] text-[#8B7355]/50">
                    {diaryPage + 1} / {Math.ceil(diary.length / 6)}
                  </span>
                  <button
                    onClick={() => setDiaryPage(p => Math.min(Math.ceil(diary.length / 6) - 1, p + 1))}
                    disabled={diaryPage >= Math.ceil(diary.length / 6) - 1}
                    className="text-[11px] text-amber-700 hover:text-amber-900 disabled:text-[#8B7355]/30 disabled:cursor-default transition-colors px-2 py-1"
                  >
                    Older →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Relationships + Conversations side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Relationships */}
          <div className="rounded-2xl bg-white border border-[#E8DFD0] shadow-sm p-5">
            <h2 className="text-sm font-bold text-[#8B7355] uppercase tracking-wide mb-3">
              Relationships <span className="text-[#8B7355]/40 font-normal">({relationships.length})</span>
            </h2>
            {relationships.length === 0 ? (
              <p className="text-[#8B7355]/50 text-sm">No relationships yet</p>
            ) : (
              <>
                <div className="space-y-2">
                  {visibleRels.map((rel, i) => {
                    const otherName = rel.agent1Id === id ? rel.agent2Name : rel.agent1Name;
                    return (
                      <div key={i} className="flex items-center justify-between py-1">
                        <span className="text-sm text-[#5D4E37] truncate mr-2">{otherName}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="w-12 h-1.5 bg-[#F5F0E8] rounded-full">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${((rel.score + 100) / 200) * 100}%`,
                                backgroundColor: statusColors[rel.status] || '#95a5a6',
                              }}
                            />
                          </div>
                          <span className="text-[10px] w-16 text-right" style={{ color: statusColors[rel.status] }}>
                            {rel.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {sortedRels.length > 8 && (
                  <button
                    onClick={() => setShowAllRels(!showAllRels)}
                    className="mt-3 text-[11px] text-[#7BC47F] hover:text-[#5D9E5F] transition-colors"
                  >
                    {showAllRels ? 'Show less' : `Show all ${sortedRels.length}`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Conversations */}
          <div className="rounded-2xl bg-white border border-[#E8DFD0] shadow-sm p-5">
            <h2 className="text-sm font-bold text-[#8B7355] uppercase tracking-wide mb-3">
              Chat History <span className="text-[#8B7355]/40 font-normal">({conversations.length})</span>
            </h2>
            {conversations.length === 0 ? (
              <p className="text-[#8B7355]/50 text-sm">No conversations yet</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  {visibleConvos.map(convo => (
                    <div key={convo.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[#F5F0E8]/60 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${convo.state === 'active' ? 'bg-green-400' : 'bg-[#E8DFD0]'}`} />
                        <span className="text-sm text-[#5D4E37] truncate">
                          {convo.agent1Name === agent.name ? convo.agent2Name : convo.agent1Name}
                        </span>
                        <span className="text-[10px] text-[#8B7355]/40 shrink-0">{convo.messageCount}msg</span>
                      </div>
                      <span className="text-[10px] text-[#8B7355]/30 shrink-0 ml-2">
                        {new Date(convo.startedAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
                {sortedConvos.length > 8 && (
                  <button
                    onClick={() => setShowAllConvos(!showAllConvos)}
                    className="mt-3 text-[11px] text-[#7BC47F] hover:text-[#5D9E5F] transition-colors"
                  >
                    {showAllConvos ? 'Show less' : `Show all ${sortedConvos.length}`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
