'use client';

// ============================================================
// Custom hook: polls /api/world/state for full dashboard data
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentData, RelationshipData, WorldTimeData, BuildingData } from '@/types';

interface WorldStats {
  treesGrown: number;
  treesSaplings: number;
  treesTotal: number;
  totalMoney: number;
  totalFish: number;
  totalWood: number;
  activeConversations: number;
  totalRelationships: number;
  stateCount: Record<string, number>;
}

interface ConversationWithNames {
  id: string;
  agent1Id: string;
  agent2Id: string;
  agent1Name: string;
  agent2Name: string;
  state: string;
  startedAt: number;
  recentMessages: { id: string; agentId: string; content: string; createdAt: number }[];
}

export interface WorldData {
  agents: AgentData[];
  relationships: (RelationshipData & { agent1Name: string; agent2Name: string })[];
  conversations: ConversationWithNames[];
  buildings: BuildingData[];
  time: WorldTimeData;
  stats: WorldStats;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useWorldData(intervalMs: number = 8000): WorldData {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [relationships, setRelationships] = useState<(RelationshipData & { agent1Name: string; agent2Name: string })[]>([]);
  const [conversations, setConversations] = useState<ConversationWithNames[]>([]);
  const [buildings, setBuildings] = useState<BuildingData[]>([]);
  const [time, setTime] = useState<WorldTimeData>({ day: 1, month: 1, year: 1, season: 'spring', weather: 'sunny', isRaining: false });
  const [stats, setStats] = useState<WorldStats>({
    treesGrown: 0, treesSaplings: 0, treesTotal: 0,
    totalMoney: 0, totalFish: 0, totalWood: 0,
    activeConversations: 0, totalRelationships: 0, stateCount: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/world/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!mountedRef.current) return;

      setAgents(data.agents || []);
      setRelationships(data.relationships || []);
      setConversations(data.conversations || []);
      setBuildings(data.buildings || []);
      if (data.time) setTime(data.time);
      if (data.stats) setStats(data.stats);
      setError(null);
      setLoading(false);
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to fetch');
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData, intervalMs]);

  return { agents, relationships, conversations, buildings, time, stats, loading, error, refresh: fetchData };
}
