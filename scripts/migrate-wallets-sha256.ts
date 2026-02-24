// ============================================================
// Migrate all agent wallets to SHA-256 seed derivation
// Run with: npx tsx scripts/migrate-wallets-sha256.ts
// ============================================================

import { db } from '../src/db/index';
import { agents } from '../src/db/schema';
import { generateWallet } from '../src/lib/solana';
import { eq } from 'drizzle-orm';

async function main() {
  console.log('=== Migrating All Wallets to SHA-256 ===\n');

  const allAgents = db.select().from(agents).all();
  console.log(`Found ${allAgents.length} agents\n`);

  let updated = 0;
  for (const agent of allAgents) {
    const oldAddress = agent.walletAddress;
    const newAddress = generateWallet(agent.id);

    if (oldAddress !== newAddress) {
      db.update(agents)
        .set({ walletAddress: newAddress })
        .where(eq(agents.id, agent.id))
        .run();

      console.log(`✓ ${agent.name}: ${oldAddress} → ${newAddress}`);
      updated++;
    } else {
      console.log(`  ${agent.name}: unchanged`);
    }
  }

  console.log(`\n=== Done! Updated ${updated}/${allAgents.length} wallets ===`);
}

main().catch(console.error);
