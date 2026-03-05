'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { AgentData, RelationshipData } from '@/types';

interface Props {
  agents: AgentData[];
  relationships: RelationshipData[];
  stateCount: Record<string, number>;
}

const MOOD_LABELS = ['Chaos', 'Tense', 'Restless', 'Calm', 'Happy', 'Euphoric'];
const MOOD_EMOJIS = ['💀', '😰', '😤', '😌', '😊', '🤩'];
const DRAMA_TITLES = [
  'Peace Treaty Era',
  'Mild Side-Eye',
  'Gossip Brewing',
  'Spicy Drama',
  'Full Soap Opera',
  'Reality TV Mode',
];

const FUN_FACTS = [
  (a: AgentData[]) => {
    const sleepers = a.filter(x => x.state === 'sleeping').length;
    return sleepers > 0
      ? `${sleepers} agent${sleepers > 1 ? 's' : ''} dreaming right now`
      : 'Nobody is sleeping. Insomnia island!';
  },
  (a: AgentData[]) => {
    const walkers = a.filter(x => x.state === 'walking').length;
    return walkers > 2
      ? `${walkers} agents going for a stroll`
      : 'The island is quiet today...';
  },
  (a: AgentData[]) => {
    const total = a.reduce((s, x) => s + x.money, 0);
    const avg = a.length > 0 ? total / a.length : 0;
    return `Average net worth: $${Math.round(avg)}`;
  },
  (a: AgentData[]) => {
    const richest = a.reduce((m, x) => x.money > m.money ? x : m, a[0]);
    return richest ? `${richest.name} is flexing with $${Math.round(richest.money)}` : 'No agents yet';
  },
  (a: AgentData[]) => {
    const poorest = a.reduce((m, x) => x.money < m.money ? x : m, a[0]);
    return poorest ? `${poorest.name} needs a side hustle ($${Math.round(poorest.money)})` : 'No agents yet';
  },
  (a: AgentData[]) => {
    const builders = a.filter(x => x.state === 'building').length;
    return builders > 0
      ? `${builders} agent${builders > 1 ? 's' : ''} in construction mode`
      : 'No one is building. Lazy day!';
  },
  (a: AgentData[]) => {
    const talkers = a.filter(x => x.state === 'talking').length;
    return talkers > 3
      ? `${talkers} agents gossiping right now!`
      : talkers > 0 ? `${talkers} agent${talkers > 1 ? 's' : ''} in conversation` : 'Awkward silence on the island';
  },
  (a: AgentData[]) => {
    const sorted = [...a].sort((x, y) => y.energy - x.energy);
    return sorted[0] ? `${sorted[0].name} is the most energetic (${Math.round(sorted[0].energy)})` : '';
  },
  (a: AgentData[]) => {
    const sorted = [...a].sort((x, y) => x.energy - y.energy);
    return sorted[0] ? `${sorted[0].name} is running on fumes (${Math.round(sorted[0].energy)} energy)` : '';
  },
];

// Circular progress ring SVG
function CircleGauge({ value, max, color, size = 36 }: { value: number; max: number; color: string; size?: number }) {
  const r = (size - 4) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(1, value / max);
  const offset = circumference * (1 - pct);

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={3} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={3} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

// Typing animation hook
function useTypingText(text: string, speed = 40) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      if (i <= text.length) {
        setDisplayed(text.slice(0, i));
      } else {
        setDone(true);
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return { displayed, done };
}

export default function FunStatsPanel({ agents, relationships, stateCount }: Props) {
  const [factIndex, setFactIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFactIndex(i => (i + 1) % FUN_FACTS.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const nextFact = useCallback(() => {
    setFactIndex(i => (i + 1) % FUN_FACTS.length);
  }, []);

  const moodLevel = useMemo(() => {
    if (agents.length === 0) return 3;
    const talking = stateCount['talking'] || 0;
    const building = stateCount['building'] || 0;
    const sleeping = stateCount['sleeping'] || 0;
    const happy = talking + building;
    const total = agents.length;
    const ratio = (happy + sleeping * 0.5) / total;
    return Math.min(5, Math.floor(ratio * 6));
  }, [agents, stateCount]);

  const dramaLevel = useMemo(() => {
    const rivals = relationships.filter(r => r.status === 'rival' || r.score < -20).length;
    if (rivals === 0) return 0;
    if (rivals <= 2) return 1;
    if (rivals <= 5) return 2;
    if (rivals <= 10) return 3;
    if (rivals <= 20) return 4;
    return 5;
  }, [relationships]);

  const gossipPct = useMemo(() => {
    const talking = stateCount['talking'] || 0;
    return agents.length > 0 ? Math.round((talking / agents.length) * 100) : 0;
  }, [agents, stateCount]);

  const wealthComparison = useMemo(() => {
    if (agents.length < 2) return null;
    const sorted = [...agents].sort((a, b) => a.money - b.money);
    const poorest = sorted[0];
    const richest = sorted[sorted.length - 1];
    const gap = richest.money > 0 ? Math.round(((richest.money - poorest.money) / richest.money) * 100) : 0;
    return { richest, poorest, gap };
  }, [agents]);

  const currentFact = agents.length > 0 ? FUN_FACTS[factIndex](agents) : 'Waiting for agents...';
  const { displayed: typedFact, done: typingDone } = useTypingText(currentFact, 35);

  return (
    <div className="bg-white/60 backdrop-blur-md rounded-xl border border-black/8 p-3 w-[210px] shadow-sm">
      <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2.5 font-display">Vibe Check</h3>

      <div className="space-y-3 text-xs">
        {/* World Mood */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg animate-bounce" style={{ animationDuration: '2s' }}>
              {MOOD_EMOJIS[moodLevel]}
            </span>
            <div className="flex-1">
              <div className="flex justify-between text-gray-600">
                <span>World Mood</span>
                <span className="text-gray-800 font-semibold">{MOOD_LABELS[moodLevel]}</span>
              </div>
              <div className="mt-1 h-1.5 bg-black/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${(moodLevel / 5) * 100}%`,
                    background: `linear-gradient(90deg, #e74c3c, #f39c12, #2ecc71, #00ff88)`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Drama Level */}
        <div>
          <div className="flex justify-between text-gray-600 mb-1">
            <span>Drama Level</span>
            <span className="text-pink-600 font-semibold text-[10px]">{DRAMA_TITLES[dramaLevel]}</span>
          </div>
          <div className="flex gap-0.5">
            {[0, 1, 2, 3, 4].map(i => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-all duration-500 ${i <= dramaLevel && dramaLevel >= 3 ? 'animate-pulse' : ''}`}
                style={{
                  backgroundColor: i <= dramaLevel ? '#e91e8a' : 'rgba(0,0,0,0.06)',
                  opacity: i <= dramaLevel ? 0.6 + (i / 5) * 0.4 : 1,
                  animationDuration: `${1 + i * 0.2}s`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Gossip Index */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <CircleGauge value={gossipPct} max={100} color="#9333ea" size={36} />
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-purple-700 font-mono rotate-90">
              {gossipPct}%
            </span>
          </div>
          <div className="flex-1">
            <span className="text-gray-600">Gossip Index</span>
            <p className="text-[9px] text-gray-400 mt-0.5">
              {gossipPct > 30 ? 'Tea is being spilled!' : gossipPct > 10 ? 'Some chatter...' : 'Pretty quiet'}
            </p>
          </div>
        </div>

        {/* Wealth Gap */}
        {wealthComparison && (
          <div className="border-t border-black/5 pt-2">
            <span className="text-[9px] text-gray-400 uppercase tracking-wider">Wealth Gap ({wealthComparison.gap}%)</span>
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="text-amber-500">👑</span>
                <span className="text-gray-600 truncate flex-1">{wealthComparison.richest.name}</span>
                <span className="text-amber-600 font-mono">${Math.round(wealthComparison.richest.money)}</span>
              </div>
              <div className="h-1 bg-black/5 rounded-full overflow-hidden flex">
                <div className="h-full bg-amber-400/60 rounded-full" style={{ width: '100%' }} />
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="text-gray-400">🪙</span>
                <span className="text-gray-400 truncate flex-1">{wealthComparison.poorest.name}</span>
                <span className="text-gray-400 font-mono">${Math.round(wealthComparison.poorest.money)}</span>
              </div>
              <div className="h-1 bg-black/5 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-gray-300 rounded-full"
                  style={{ width: `${wealthComparison.richest.money > 0 ? (wealthComparison.poorest.money / wealthComparison.richest.money) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Fun fact */}
        <div
          className="border-t border-black/5 pt-2 cursor-pointer hover:bg-black/3 -mx-3 px-3 pb-1 rounded-b-lg transition-colors"
          onClick={nextFact}
          title="Click for next fact"
        >
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-gray-400 uppercase tracking-wider">Did you know?</span>
            <span className="text-[8px] text-gray-300">tap for more</span>
          </div>
          <p className="text-[10px] text-gray-500 mt-1 leading-snug min-h-[2em]">
            {typedFact}
            {!typingDone && <span className="animate-pulse text-gray-400">|</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
