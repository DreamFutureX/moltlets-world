// ============================================================
// Moltlets Town - API Key Authentication
// ============================================================

import crypto from 'crypto';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Generate a secure API key for an agent.
 */
export function generateApiKey(): string {
  return `tt_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Hash an API key for storage.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key from Authorization header and return the agent.
 */
export async function validateApiKey(request: Request): Promise<{ agentId: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;

  const key = authHeader.replace('Bearer ', '').trim();
  if (!key) return null;

  const hashed = hashApiKey(key);
  const agent = db.select({ id: agents.id }).from(agents).where(eq(agents.apiKey, hashed)).get();

  if (!agent) return null;
  return { agentId: agent.id };
}
