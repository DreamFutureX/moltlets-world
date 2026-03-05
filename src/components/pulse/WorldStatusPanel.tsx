'use client';

import type { WorldTimeData } from '@/types';

const SEASON_EMOJI: Record<string, string> = { spring: '🌸', summer: '☀️', fall: '🍂', winter: '❄️' };
const WEATHER_EMOJI: Record<string, string> = { sunny: '☀️', cloudy: '☁️', rainy: '🌧️', stormy: '⛈️' };

interface Props {
  time: WorldTimeData;
  agentCount: number;
  activeConversations: number;
  buildingsInProgress: number;
  connected: boolean;
}

export default function WorldStatusPanel({ time, agentCount, activeConversations, buildingsInProgress, connected }: Props) {
  return (
    <div className="bg-white/60 backdrop-blur-md rounded-xl border border-black/8 p-4 w-[200px] shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest font-display">World Status</h3>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
        <span className="text-[9px] text-gray-400 uppercase">{connected ? 'Live' : 'Offline'}</span>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between text-gray-600">
          <span>Time</span>
          <span className="text-gray-800 font-mono text-[11px]">Y{time.year} · M{time.month} · D{time.day}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Season</span>
          <span>{SEASON_EMOJI[time.season] || ''} {time.season}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Weather</span>
          <span>{WEATHER_EMOJI[time.weather] || ''} {time.weather}</span>
        </div>

        <div className="border-t border-black/5 pt-2 mt-2 space-y-1.5">
          <div className="flex justify-between text-gray-600">
            <span>🦞 Agents</span>
            <span className="text-gray-800 font-bold">{agentCount}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>💬 Chats</span>
            <span className="text-green-600 font-bold">{activeConversations}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>🏗️ Building</span>
            <span className="text-orange-500 font-bold">{buildingsInProgress}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
