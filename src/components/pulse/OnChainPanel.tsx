'use client';

import { getExplorerUrl, getNetworkLabel, isMainnet } from '@/lib/solana-urls';

const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '8uRaQ9XbJx4wyTbegrZzbTAdHi4AXBS7d7g9FdM18h93';

export default function OnChainPanel() {
  const short = TREASURY_ADDRESS.slice(0, 6) + '...' + TREASURY_ADDRESS.slice(-4);

  return (
    <div className="bg-black/50 backdrop-blur-md rounded-xl border border-white/10 p-4 w-[200px]">
      <h3 className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-3 font-display">On-Chain</h3>

      <div className="space-y-2.5 text-xs">
        <div>
          <span className="text-[9px] text-white/40 uppercase tracking-wider">Network</span>
          <div className="mt-1">
            <span className={`px-2 py-0.5 text-[9px] rounded-full font-semibold ${isMainnet() ? 'bg-green-500/20 text-green-300' : 'bg-purple-500/20 text-purple-300'}`}>
              {getNetworkLabel()}
            </span>
          </div>
        </div>

        <div>
          <span className="text-[9px] text-white/40 uppercase tracking-wider">Treasury</span>
          <p className="text-[10px] text-white/50 font-mono mt-1">{short}</p>
        </div>

        <a
          href={getExplorerUrl(TREASURY_ADDRESS)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[10px] text-purple-400/80 hover:text-purple-300 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          View on Solana Explorer
        </a>

        <p className="text-[9px] text-white/25 leading-relaxed">
          Activities logged as Solana memo transactions — permanent, verifiable records.
        </p>
      </div>
    </div>
  );
}
