'use client';

// ============================================================
// Relationship Panel - Shows agent relationships and scores
// ============================================================

import { useEffect, useState } from 'react';

interface Relationship {
  id: string;
  agent1Id: string;
  agent2Id: string;
  agent1Name: string;
  agent2Name: string;
  score: number;
  interactionCount: number;
  lastInteractionAt: number;
  status: string;
}

interface RelationshipPanelProps {
  selectedAgentId: string | null;
}

const statusConfig: Record<string, { emoji: string; color: string; label: string }> = {
  rival: { emoji: '⚡', color: '#e74c3c', label: 'Rival' },
  stranger: { emoji: '👋', color: '#95a5a6', label: 'Stranger' },
  acquaintance: { emoji: '🤝', color: '#3498db', label: 'Acquaintance' },
  friend: { emoji: '😄', color: '#2ecc71', label: 'Friend' },
  close_friend: { emoji: '💕', color: '#e91e8a', label: 'Close Friend' },
};

export default function RelationshipPanel({ selectedAgentId }: RelationshipPanelProps) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);

  useEffect(() => {
    const fetchRelationships = async () => {
      try {
        const url = selectedAgentId
          ? `/api/relationships?agentId=${selectedAgentId}`
          : '/api/relationships';
        const res = await fetch(url);
        const data = await res.json();
        setRelationships(data.relationships || []);
      } catch { /* ignore */ }
    };

    fetchRelationships();
    const interval = setInterval(fetchRelationships, 5000);
    return () => clearInterval(interval);
  }, [selectedAgentId]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  const getBarWidth = (score: number) => {
    // Map -100..100 to 0..100%
    return ((score + 100) / 200) * 100;
  };

  const getBarColor = (score: number) => {
    if (score < -30) return '#e74c3c';
    if (score <= 10) return '#95a5a6';
    if (score <= 30) return '#3498db';
    if (score <= 60) return '#2ecc71';
    return '#e91e8a';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-bold text-white/90 tracking-wide uppercase flex items-center gap-2">
          <span className="text-lg">❤️</span> Relationships
          <span className="ml-auto bg-white/10 text-white/60 text-xs px-2 py-0.5 rounded-full">
            {relationships.length}
          </span>
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {relationships.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-white/30 text-sm">No relationships yet</p>
            <p className="text-white/20 text-xs mt-1">Agents need to interact first</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {relationships
              .sort((a, b) => b.score - a.score)
              .map(rel => {
                const config = statusConfig[rel.status] || statusConfig.stranger;

                return (
                  <div
                    key={rel.id}
                    className="px-3 py-3 rounded-lg hover:bg-white/5 transition"
                  >
                    {/* Agent names */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-white/80 font-medium truncate">
                        {rel.agent1Name} & {rel.agent2Name}
                      </span>
                      <span className="text-xs flex items-center gap-1" style={{ color: config.color }}>
                        {config.emoji} {config.label}
                      </span>
                    </div>

                    {/* Relationship bar */}
                    <div className="relative h-2.5 bg-white/5 rounded-full overflow-hidden mb-1.5">
                      {/* Center marker */}
                      <div className="absolute left-1/2 top-0 w-px h-full bg-white/20 z-10" />

                      {/* Score fill */}
                      <div
                        className="absolute top-0 h-full rounded-full transition-all duration-500"
                        style={{
                          left: rel.score >= 0 ? '50%' : `${getBarWidth(rel.score)}%`,
                          width: rel.score >= 0
                            ? `${(rel.score / 100) * 50}%`
                            : `${50 - getBarWidth(rel.score)}%`,
                          backgroundColor: getBarColor(rel.score),
                        }}
                      />
                    </div>

                    {/* Stats */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/30">
                        Score: {rel.score} • {rel.interactionCount} interactions
                      </span>
                      <span className="text-[10px] text-white/20">
                        {formatTime(rel.lastInteractionAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
