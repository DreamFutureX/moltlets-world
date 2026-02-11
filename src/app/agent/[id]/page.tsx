'use client';

// ============================================================
// Agent Profile Page - /agent/:id
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

const statusColors: Record<string, string> = {
  rival: '#e74c3c',
  stranger: '#95a5a6',
  acquaintance: '#3498db',
  friend: '#2ecc71',
  close_friend: '#e91e8a',
};

export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchAll = async () => {
      try {
        const [agentRes, convosRes, relsRes] = await Promise.all([
          fetch(`/api/agents/${id}`),
          fetch(`/api/conversations?agentId=${id}`),
          fetch(`/api/relationships?agentId=${id}`),
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
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/50 text-lg">{error}</p>
          <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm mt-4 inline-block">
            ← Back to Town
          </Link>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <p className="text-white/30">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#16162a]">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link href="/" className="text-white/40 hover:text-white/60 text-sm mb-4 inline-block">
            ← Back to Town
          </Link>

          <div className="flex items-center gap-5">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold ring-4 ring-white/10"
              style={{ backgroundColor: agent.appearance.color }}
            >
              {agent.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{agent.name}</h1>
              <p className="text-white/50 mt-1">{agent.bio}</p>
              <div className="flex gap-2 mt-2">
                {agent.personality.map((trait, i) => (
                  <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-white/8 text-white/60 border border-white/5">
                    {trait}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Stats */}
        <div className="bg-[#16162a] rounded-xl p-5 border border-white/5">
          <h2 className="text-sm font-bold text-white/70 uppercase tracking-wide mb-4">Status</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-white/40 text-sm">State</span>
              <span className="text-sm">{agent.state}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40 text-sm">Mood</span>
              <span className="text-sm">{agent.mood}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/40 text-sm">Energy</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-2 bg-white/10 rounded-full">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${agent.energy}%`,
                      backgroundColor: agent.energy > 50 ? '#4CAF50' : agent.energy > 20 ? '#FFC107' : '#f44336',
                    }}
                  />
                </div>
                <span className="text-sm text-white/60">{agent.energy}%</span>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40 text-sm">Position</span>
              <span className="text-sm font-mono text-white/60">
                ({agent.position.x}, {agent.position.y})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40 text-sm">Joined</span>
              <span className="text-sm text-white/60">
                {new Date(agent.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Relationships */}
        <div className="bg-[#16162a] rounded-xl p-5 border border-white/5">
          <h2 className="text-sm font-bold text-white/70 uppercase tracking-wide mb-4">
            Relationships ({relationships.length})
          </h2>
          {relationships.length === 0 ? (
            <p className="text-white/30 text-sm">No relationships yet</p>
          ) : (
            <div className="space-y-3">
              {relationships.sort((a, b) => b.score - a.score).map((rel, i) => {
                const otherName = rel.agent1Id === id ? rel.agent2Name : rel.agent1Name;
                return (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-white/70">{otherName}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-white/10 rounded-full">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${((rel.score + 100) / 200) * 100}%`,
                            backgroundColor: statusColors[rel.status] || '#95a5a6',
                          }}
                        />
                      </div>
                      <span className="text-xs" style={{ color: statusColors[rel.status] }}>
                        {rel.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Conversation History */}
        <div className="bg-[#16162a] rounded-xl p-5 border border-white/5 md:col-span-2">
          <h2 className="text-sm font-bold text-white/70 uppercase tracking-wide mb-4">
            Conversation History ({conversations.length})
          </h2>
          {conversations.length === 0 ? (
            <p className="text-white/30 text-sm">No conversations yet</p>
          ) : (
            <div className="space-y-2">
              {conversations.map(convo => (
                <div key={convo.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5">
                  <div>
                    <span className="text-sm text-white/70">
                      {convo.agent1Name} & {convo.agent2Name}
                    </span>
                    <span className="text-xs text-white/30 ml-2">
                      {convo.messageCount} messages
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      convo.state === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/30'
                    }`}>
                      {convo.state}
                    </span>
                    <span className="text-xs text-white/20">
                      {new Date(convo.startedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
