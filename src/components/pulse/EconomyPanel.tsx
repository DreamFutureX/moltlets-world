'use client';

interface AgentSummary {
  name: string;
  color: string;
  money: number;
}

interface Props {
  totalMoney: number;
  totalWood: number;
  totalFish: number;
  topEarners: AgentSummary[];
}

export default function EconomyPanel({ totalMoney, totalWood, totalFish, topEarners }: Props) {
  const total = totalMoney + totalWood * 10 + totalFish * 15;

  return (
    <div className="bg-white/60 backdrop-blur-md rounded-xl border border-black/8 p-4 w-[200px] shadow-sm">
      <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 font-display">Economy</h3>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between text-gray-600">
          <span>💰 Total Gold</span>
          <span className="text-amber-600 font-bold font-mono">${Math.round(totalMoney).toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>🪵 Total Wood</span>
          <span className="text-orange-500 font-bold font-mono">{totalWood.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>🐟 Total Fish</span>
          <span className="text-sky-600 font-bold font-mono">{totalFish.toLocaleString()}</span>
        </div>

        {/* GDP bar */}
        <div className="mt-1">
          <div className="flex justify-between text-[9px] text-gray-400 mb-1">
            <span>GDP</span>
            <span>${Math.round(total).toLocaleString()}</span>
          </div>
          <div className="h-1.5 bg-black/5 rounded-full overflow-hidden flex">
            <div className="h-full bg-amber-400/70 rounded-l-full" style={{ width: `${total > 0 ? (totalMoney / total * 100) : 0}%` }} />
            <div className="h-full bg-orange-400/70" style={{ width: `${total > 0 ? (totalWood * 10 / total * 100) : 0}%` }} />
            <div className="h-full bg-sky-400/70 rounded-r-full" style={{ width: `${total > 0 ? (totalFish * 15 / total * 100) : 0}%` }} />
          </div>
        </div>

        {/* Top earners */}
        {topEarners.length > 0 && (
          <div className="border-t border-black/5 pt-2 mt-2">
            <span className="text-[9px] text-gray-400 uppercase tracking-wider">Top Earners</span>
            <div className="mt-1.5 space-y-1">
              {topEarners.slice(0, 5).map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-gray-400 w-3">{i + 1}.</span>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-gray-600 truncate flex-1">{a.name}</span>
                  <span className="text-amber-600/80 font-mono">${Math.round(a.money)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
