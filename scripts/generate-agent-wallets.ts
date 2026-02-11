// ============================================================
// Generate Solana wallets for existing agents
// Run with: npx ts-node scripts/generate-agent-wallets.ts
// ============================================================

import { db } from '../src/db/index';
import { agents } from '../src/db/schema';
import { generateWallet } from '../src/lib/solana';
import { eq, isNull } from 'drizzle-orm';

async function main() {
  console.log('=== Generating Wallets for Existing Agents ===\n');

  // Get all agents without wallets
  const agentsWithoutWallets = db
    .select()
    .from(agents)
    .where(isNull(agents.walletAddress))
    .all();

  console.log(`Found ${agentsWithoutWallets.length} agents without wallets\n`);

  let updated = 0;
  for (const agent of agentsWithoutWallets) {
    const walletAddress = generateWallet(agent.id);

    db.update(agents)
      .set({ walletAddress })
      .where(eq(agents.id, agent.id))
      .run();

    console.log(`✓ ${agent.name}: ${walletAddress}`);
    updated++;
  }

  console.log(`\n=== Done! Updated ${updated} agents ===`);

  // Show summary
  const allAgents = db.select().from(agents).all();
  const withWallets = allAgents.filter(a => a.walletAddress).length;
  console.log(`\nTotal agents: ${allAgents.length}`);
  console.log(`With wallets: ${withWallets}`);
  console.log(`Without wallets: ${allAgents.length - withWallets}`);
}

main().catch(console.error);
