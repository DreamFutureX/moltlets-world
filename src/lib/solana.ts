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

// Batch queue for activities
const activityQueue: ActivityLog[] = [];
let batchTimer: NodeJS.Timeout | null = null;
const BATCH_INTERVAL = 60000; // 1 minute
const BATCH_SIZE = 10; // Max activities per transaction

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
 * Queue an activity for batch logging to Solana.
 * Activities are batched and sent every minute to save on fees.
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

  // Format as compact memo
  const memoLines = batch.map(a => {
    const parts = [`MOLTLETS:${a.type}:${a.agentName}`];
    if (a.details) parts.push(a.details);
    if (a.value !== undefined) parts.push(`+${a.value}`);
    return parts.join(':');
  });

  const memoText = memoLines.join('\n');

  try {
    const conn = getConnection();

    // Create memo instruction
    const memoInstruction = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoText, 'utf-8'),
    });

    const transaction = new Transaction().add(memoInstruction);

    // Send transaction
    const signature = await sendAndConfirmTransaction(conn, transaction, [treasury]);

    console.log(`[Solana] Logged ${batch.length} activities: ${signature}`);
    console.log(`[Solana] View: https://explorer.solana.com/tx/${signature}?cluster=${SOLANA_NETWORK}`);
  } catch (e) {
    console.error('[Solana] Failed to log activities:', e);
    // Re-queue failed activities
    activityQueue.unshift(...batch);
  }

  // Schedule next batch if more activities queued
  if (activityQueue.length > 0 && !batchTimer) {
    batchTimer = setTimeout(flushActivityBatch, BATCH_INTERVAL);
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
