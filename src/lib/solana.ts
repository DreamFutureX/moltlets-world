// ============================================================
// Solana Integration - Wallet Generation & Memo Logging
// Uses Solana as a public memory ledger for agent activities
// ============================================================

import { Keypair, Connection, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

// Use devnet for development, mainnet-beta for production
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const RPC_URL = SOLANA_NETWORK === 'mainnet-beta'
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com';

// Memo program ID (standard on Solana)
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Connection singleton
let connection: Connection | null = null;

function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(RPC_URL, 'confirmed');
  }
  return connection;
}

// ═══════════════════════════════════════════════════════════
// Startup Diagnostics
// ═══════════════════════════════════════════════════════════

console.log(`[Solana] Config: network=${SOLANA_NETWORK}, rpc=${RPC_URL}, treasury=${process.env.SOLANA_TREASURY_SECRET_KEY ? '✅ CONFIGURED' : '⚠️ MISSING — on-chain logging disabled!'}`);

// ═══════════════════════════════════════════════════════════
// Wallet Generation
// ═══════════════════════════════════════════════════════════

/**
 * Generate a new Solana keypair for an agent.
 * Returns the public key (wallet address) as a base58 string.
 * The secret key is derived deterministically from agentId for recovery.
 */
export function generateWallet(agentId: string): string {
  // Create deterministic seed from agentId + secret salt
  const salt = process.env.WALLET_SEED_SALT || 'moltlets-town-default-salt';
  const seedString = `${salt}:${agentId}`;

  // Convert to 32-byte seed using simple hash
  const seed = new Uint8Array(32);
  for (let i = 0; i < seedString.length && i < 32; i++) {
    seed[i] = seedString.charCodeAt(i);
  }
  // Fill remaining bytes with hash-like derivation
  for (let i = seedString.length; i < 32; i++) {
    seed[i] = (seed[i % seedString.length] * 31 + i) % 256;
  }

  const keypair = Keypair.fromSeed(seed);
  return keypair.publicKey.toBase58();
}

/**
 * Recover the keypair for an agent (for signing transactions).
 * Only call this server-side when you need to sign.
 */
export function recoverKeypair(agentId: string): Keypair {
  const salt = process.env.WALLET_SEED_SALT || 'moltlets-town-default-salt';
  const seedString = `${salt}:${agentId}`;

  const seed = new Uint8Array(32);
  for (let i = 0; i < seedString.length && i < 32; i++) {
    seed[i] = seedString.charCodeAt(i);
  }
  for (let i = seedString.length; i < 32; i++) {
    seed[i] = (seed[i % seedString.length] * 31 + i) % 256;
  }

  return Keypair.fromSeed(seed);
}

// ═══════════════════════════════════════════════════════════
// Activity Logging (Memo Transactions)
// ═══════════════════════════════════════════════════════════

// Activity types to log on-chain
export type ActivityType =
  | 'join'      // Agent joined the world
  | 'fish'      // Caught a fish
  | 'chop'      // Chopped a tree
  | 'build'     // Building milestone (started, complete)
  | 'trade'     // Bought/sold something
  | 'chat'      // Had a conversation (summary only)
  | 'level_up'; // Leveled up

interface ActivityLog {
  type: ActivityType;
  agentId: string;
  agentName: string;
  details?: string;
  value?: number;
  timestamp: number;
}

// Batch queue for activities - optimized to save gas
const activityQueue: ActivityLog[] = [];
let batchTimer: NodeJS.Timeout | null = null;
const BATCH_INTERVAL = 5 * 60 * 1000; // 5 minutes - batch more to save gas
const BATCH_SIZE = 50; // 50 activities per transaction - fewer txs = less gas
const TX_TIMEOUT_MS = 30_000; // 30s timeout for sendAndConfirmTransaction
const MAX_BATCH_RETRIES = 3; // Drop batch after this many consecutive failures
let consecutiveFailures = 0;

// Treasury keypair for paying transaction fees (fund this on devnet)
let treasuryKeypair: Keypair | null = null;

function getTreasuryKeypair(): Keypair | null {
  if (treasuryKeypair) return treasuryKeypair;

  const secretKey = process.env.SOLANA_TREASURY_SECRET_KEY;
  if (!secretKey) {
    console.warn('[Solana] No treasury key configured - memo logging disabled');
    return null;
  }

  try {
    const decoded = JSON.parse(secretKey) as number[];
    treasuryKeypair = Keypair.fromSecretKey(Uint8Array.from(decoded));
    console.log(`[Solana] Treasury loaded: ${treasuryKeypair.publicKey.toBase58()}`);
    return treasuryKeypair;
  } catch (e) {
    console.error('[Solana] Failed to load treasury key:', e);
    return null;
  }
}

/**
 * Initialize Solana subsystem — call from GameLoop on startup.
 * Validates treasury key and starts heartbeat to prevent timer drift.
 */
export function initSolana(): void {
  const treasury = getTreasuryKeypair();
  if (treasury) {
    console.log(`[Solana] ✅ On-chain logging active — treasury: ${treasury.publicKey.toBase58()}`);
    // Check balance at startup
    getWalletBalance(treasury.publicKey.toBase58()).then(bal => {
      console.log(`[Solana] Treasury balance: ${bal.toFixed(4)} SOL`);
      if (bal < 0.01) {
        console.warn('[Solana] ⚠️ Treasury balance low! Transactions may fail. Airdrop SOL on devnet.');
      }
    });
  } else {
    console.warn('[Solana] ❌ On-chain logging DISABLED — set SOLANA_TREASURY_SECRET_KEY env var');
  }

  // Heartbeat: failsafe interval to flush stuck queues every 5 minutes
  setInterval(() => {
    if (activityQueue.length > 0) {
      console.log(`[Solana] Heartbeat: ${activityQueue.length} activities queued, flushing...`);
      flushActivityBatch();
    }
  }, BATCH_INTERVAL);
}

/**
 * Queue an activity for batch logging to Solana.
 * Activities are batched and sent every 5 minutes to save on fees.
 */
export function logActivity(
  type: ActivityType,
  agentId: string,
  agentName: string,
  details?: string,
  value?: number
): void {
  // Check if logging is enabled
  if (!process.env.SOLANA_TREASURY_SECRET_KEY) {
    return; // Silent skip if no treasury configured
  }

  activityQueue.push({
    type,
    agentId,
    agentName,
    details,
    value,
    timestamp: Date.now(),
  });

  // Start batch timer if not running
  if (!batchTimer) {
    batchTimer = setTimeout(flushActivityBatch, BATCH_INTERVAL);
  }

  // Flush immediately if queue is large
  if (activityQueue.length >= BATCH_SIZE) {
    flushActivityBatch();
  }
}

/**
 * Flush queued activities to Solana as a memo transaction.
 */
async function flushActivityBatch(): Promise<void> {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  if (activityQueue.length === 0) return;

  const treasury = getTreasuryKeypair();
  if (!treasury) return;

  // Take up to BATCH_SIZE activities
  const batch = activityQueue.splice(0, BATCH_SIZE);

  // Format as VERY compact memo to save space (max ~1000 bytes for memo)
  // Group by activity type for compression
  const summary: Record<string, { count: number; agents: Set<string>; totalValue: number }> = {};

  for (const a of batch) {
    if (!summary[a.type]) {
      summary[a.type] = { count: 0, agents: new Set(), totalValue: 0 };
    }
    summary[a.type].count++;
    summary[a.type].agents.add(a.agentName);
    if (a.value) summary[a.type].totalValue += a.value;
  }

  // Create compact summary: "MW|join:3|fish:12+45|chop:8+24|chat:15"
  const parts = ['MW']; // Moltlets World prefix
  for (const [type, data] of Object.entries(summary)) {
    let part = `${type}:${data.count}`;
    if (data.totalValue > 0) part += `+${data.totalValue}`;
    parts.push(part);
  }
  const memoText = parts.join('|');

  try {
    const conn = getConnection();

    // Create memo instruction
    const memoInstruction = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoText, 'utf-8'),
    });

    const transaction = new Transaction().add(memoInstruction);

    // Send transaction with timeout to prevent hanging
    const txPromise = sendAndConfirmTransaction(conn, transaction, [treasury]);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Transaction timeout after ${TX_TIMEOUT_MS / 1000}s`)), TX_TIMEOUT_MS)
    );
    const signature = await Promise.race([txPromise, timeoutPromise]);

    console.log(`[Solana] ✅ Logged ${batch.length} activities: ${signature}`);
    console.log(`[Solana] View: https://explorer.solana.com/tx/${signature}?cluster=${SOLANA_NETWORK}`);
    consecutiveFailures = 0; // Reset on success
  } catch (e) {
    consecutiveFailures++;
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[Solana] ❌ Failed to log activities (attempt ${consecutiveFailures}/${MAX_BATCH_RETRIES}): ${errMsg}`);

    if (consecutiveFailures >= MAX_BATCH_RETRIES) {
      console.error(`[Solana] ⚠️ Dropping ${batch.length} activities after ${MAX_BATCH_RETRIES} consecutive failures`);
      consecutiveFailures = 0; // Reset so future batches can try
    } else {
      // Re-queue failed activities for retry
      activityQueue.unshift(...batch);
    }
  }

  // Schedule next batch if more activities queued
  if (activityQueue.length > 0 && !batchTimer) {
    // Use shorter interval after failure for quicker retry
    const nextInterval = consecutiveFailures > 0 ? BATCH_INTERVAL * 2 : BATCH_INTERVAL;
    batchTimer = setTimeout(flushActivityBatch, nextInterval);
  }
}

/**
 * Force flush any pending activities (call on server shutdown).
 */
export async function flushPendingActivities(): Promise<void> {
  while (activityQueue.length > 0) {
    await flushActivityBatch();
  }
}

// ═══════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════

/**
 * Check if a wallet address is valid.
 */
export function isValidWallet(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get SOL balance of a wallet (for debugging/display).
 */
export async function getWalletBalance(address: string): Promise<number> {
  try {
    const conn = getConnection();
    const pubkey = new PublicKey(address);
    const balance = await conn.getBalance(pubkey);
    return balance / 1e9; // Convert lamports to SOL
  } catch {
    return 0;
  }
}

/**
 * Get Solana explorer URL for an address.
 */
export function getExplorerUrl(address: string, type: 'address' | 'tx' = 'address'): string {
  const base = 'https://explorer.solana.com';
  const cluster = SOLANA_NETWORK === 'mainnet-beta' ? '' : `?cluster=${SOLANA_NETWORK}`;
  return `${base}/${type}/${address}${cluster}`;
}
