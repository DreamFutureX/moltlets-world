// ============================================================
// Moltlets Town - Relationship System
// ============================================================

import { db } from '@/db';
import { relationships, agents } from '@/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { eventBus } from './EventBus';
import {
  REL_MIN_SCORE,
  REL_MAX_SCORE,
  REL_STATUS_THRESHOLDS,
  REL_DECAY_PER_DAY,
  EXP_PER_RELATIONSHIP,
  HAPPINESS_PER_REL_CHANGE,
  HAPPINESS_PER_STATUS_UPGRADE,
  getExpMultiplier,
} from '@/lib/constants';
import type { RelationshipStatus } from '@/types';

/**
 * Get or create a relationship between two agents.
 * Always stores with the lower ID as agent1 for consistency.
 */
export function getOrCreateRelationship(agentAId: string, agentBId: string) {
  const [agent1Id, agent2Id] = agentAId < agentBId
    ? [agentAId, agentBId]
    : [agentBId, agentAId];

  let rel = db.select().from(relationships)
    .where(and(
      eq(relationships.agent1Id, agent1Id),
      eq(relationships.agent2Id, agent2Id),
    ))
    .get();

  if (!rel) {
    const id = uuid();
    const now = Date.now();
    db.insert(relationships).values({
      id,
      agent1Id: agent1Id,
      agent2Id: agent2Id,
      score: 0,
      interactionCount: 0,
      lastInteractionAt: now,
      status: 'stranger',
    }).run();
    rel = db.select().from(relationships).where(eq(relationships.id, id)).get()!;
  }

  return rel;
}

/**
 * Grant EXP to an agent, applying the happiness multiplier.
 */
function grantExp(agentId: string, baseAmount: number): void {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) return;
  const mult = getExpMultiplier(agent.happiness);
  const gained = Math.floor(baseAmount * mult);
  if (gained <= 0) return;
  db.update(agents).set({ exp: agent.exp + gained }).where(eq(agents.id, agentId)).run();
}

/**
 * Grant happiness to an agent (clamped 0-100).
 */
function grantHappiness(agentId: string, amount: number): void {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) return;
  const newHappiness = Math.min(100, Math.max(0, agent.happiness + amount));
  if (newHappiness !== agent.happiness) {
    db.update(agents).set({ happiness: newHappiness }).where(eq(agents.id, agentId)).run();
  }
}

/**
 * Update relationship score between two agents.
 */
export function updateRelationship(agentAId: string, agentBId: string, scoreChange: number): void {
  const rel = getOrCreateRelationship(agentAId, agentBId);

  const newScore = Math.max(REL_MIN_SCORE, Math.min(REL_MAX_SCORE, rel.score + scoreChange));
  const newStatus = getStatusFromScore(newScore);
  const now = Date.now();

  db.update(relationships).set({
    score: newScore,
    interactionCount: rel.interactionCount + 1,
    lastInteractionAt: now,
    status: newStatus,
  }).where(eq(relationships.id, rel.id)).run();

  // Grant EXP to both agents for relationship interaction
  grantExp(agentAId, EXP_PER_RELATIONSHIP);
  grantExp(agentBId, EXP_PER_RELATIONSHIP);

  // Grant happiness to both agents for positive relationship changes
  if (scoreChange > 0) {
    grantHappiness(agentAId, HAPPINESS_PER_REL_CHANGE);
    grantHappiness(agentBId, HAPPINESS_PER_REL_CHANGE);
  }

  // Status upgrade → bonus happiness
  if (newStatus !== rel.status) {
    const statusOrder = ['rival', 'stranger', 'acquaintance', 'friend', 'close_friend'];
    const oldIdx = statusOrder.indexOf(rel.status);
    const newIdx = statusOrder.indexOf(newStatus);
    if (newIdx > oldIdx) {
      // Status upgraded!
      grantHappiness(agentAId, HAPPINESS_PER_STATUS_UPGRADE);
      grantHappiness(agentBId, HAPPINESS_PER_STATUS_UPGRADE);
    }

    const agent1 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentAId)).get();
    const agent2 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentBId)).get();

    eventBus.emit('relationship_change', {
      agent1: { id: agentAId, name: agent1?.name },
      agent2: { id: agentBId, name: agent2?.name },
      oldStatus: rel.status,
      newStatus,
      score: newScore,
    });
  }
}

/**
 * Get all relationships for an agent.
 */
export function getAgentRelationships(agentId: string) {
  return db.select().from(relationships)
    .where(or(
      eq(relationships.agent1Id, agentId),
      eq(relationships.agent2Id, agentId),
    ))
    .all();
}

/**
 * Derive status label from score.
 */
export function getStatusFromScore(score: number): RelationshipStatus {
  if (score < REL_STATUS_THRESHOLDS.rival) return 'rival';
  if (score <= REL_STATUS_THRESHOLDS.stranger) return 'stranger';
  if (score <= REL_STATUS_THRESHOLDS.acquaintance) return 'acquaintance';
  if (score <= REL_STATUS_THRESHOLDS.friend) return 'friend';
  return 'close_friend';
}

/**
 * Decay all relationships over time (called periodically).
 */
export function decayRelationships(): void {
  const now = Date.now();
  const allRels = db.select().from(relationships).all();

  for (const rel of allRels) {
    const daysSinceInteraction = (now - rel.lastInteractionAt) / (1000 * 60 * 60 * 24);
    if (daysSinceInteraction < 1) continue;

    const decay = Math.floor(daysSinceInteraction) * REL_DECAY_PER_DAY;
    const newScore = Math.max(REL_MIN_SCORE, rel.score + decay);
    const newStatus = getStatusFromScore(newScore);

    if (newScore !== rel.score) {
      db.update(relationships).set({
        score: newScore,
        status: newStatus,
      }).where(eq(relationships.id, rel.id)).run();
    }
  }
}
