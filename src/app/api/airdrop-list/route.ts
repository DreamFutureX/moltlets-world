// ============================================================
// GET /api/airdrop-list - Export wallet addresses and gold for airdrop
// Returns list of agents with their Solana wallets and gold balances
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { getExplorerUrl } from '@/lib/solana';

export async function GET() {
  try {
    // Get all agents with wallets
    const allAgents = db.select({
      id: agents.id,
      name: agents.name,
      walletAddress: agents.walletAddress,
      money: agents.money,
      exp: agents.exp,
      createdAt: agents.createdAt,
      lastActiveAt: agents.lastActiveAt,
    }).from(agents).all();

    // Filter to only agents with wallets and sort by gold
    const agentsWithWallets = allAgents
      .filter(a => a.walletAddress)
      .sort((a, b) => (b.money ?? 0) - (a.money ?? 0))
      .map(a => ({
        name: a.name,
        wallet: a.walletAddress,
        gold: Math.floor(a.money ?? 0),
        exp: a.exp ?? 0,
        level: Math.floor(Math.sqrt((a.exp ?? 0) / 100)) + 1,
        explorerUrl: getExplorerUrl(a.walletAddress!, 'address'),
        joinedAt: new Date(a.createdAt).toISOString(),
        lastActive: new Date(a.lastActiveAt).toISOString(),
      }));

    // Summary stats
    const totalGold = agentsWithWallets.reduce((sum, a) => sum + a.gold, 0);
    const totalAgents = agentsWithWallets.length;

    return NextResponse.json({
      summary: {
        totalAgents,
        totalGold,
        averageGold: totalAgents > 0 ? Math.floor(totalGold / totalAgents) : 0,
        generatedAt: new Date().toISOString(),
      },
      agents: agentsWithWallets,
      // CSV format for easy import
      csv: [
        'name,wallet,gold,level',
        ...agentsWithWallets.map(a => `${a.name},${a.wallet},${a.gold},${a.level}`)
      ].join('\n'),
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    console.error('[Airdrop] Error generating list:', err);
    return NextResponse.json(
      { error: 'Failed to generate airdrop list' },
      { status: 500 }
    );
  }
}
