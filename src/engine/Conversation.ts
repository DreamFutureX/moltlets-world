// ============================================================
// Moltlets Town - Conversation State Machine
// ============================================================

import { db } from '@/db';
import { conversations, messages, agents } from '@/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { eventBus } from './EventBus';
import { updateRelationship } from './Relationship';
import {
  CONVERSATION_TIMEOUT_MS,
  CONVERSATION_MAX_DURATION_MS,
  CONVERSATION_MAX_MESSAGES,
  CONVERSATION_INVITE_TIMEOUT_MS,
  MESSAGE_COOLDOWN_MS,
  REL_FIRST_CONVO_BONUS,
  REL_PER_MESSAGE,
  REL_LONG_CONVO_BONUS,
  REL_LONG_CONVO_THRESHOLD,
} from '@/lib/constants';

/**
 * Check if an agent is currently in a conversation.
 */
export function getActiveConversation(agentId: string) {
  return db.select()
    .from(conversations)
    .where(
      and(
        or(
          eq(conversations.agent1Id, agentId),
          eq(conversations.agent2Id, agentId),
        ),
        or(
          eq(conversations.state, 'invited'),
          eq(conversations.state, 'active'),
        ),
      ),
    )
    .get();
}

/**
 * Start a conversation between two agents.
 */
export function startConversation(initiatorId: string, targetId: string): string | null {
  // Check neither agent is already in a conversation
  if (getActiveConversation(initiatorId) || getActiveConversation(targetId)) {
    return null;
  }

  const id = uuid();
  const now = Date.now();

  db.insert(conversations).values({
    id,
    agent1Id: initiatorId,
    agent2Id: targetId,
    state: 'active',
    startedAt: now,
  }).run();

  // Update agent states to talking
  db.update(agents).set({ state: 'talking' }).where(eq(agents.id, initiatorId)).run();
  db.update(agents).set({ state: 'talking' }).where(eq(agents.id, targetId)).run();

  // First conversation bonus
  updateRelationship(initiatorId, targetId, REL_FIRST_CONVO_BONUS);

  const initiator = db.select({ name: agents.name }).from(agents).where(eq(agents.id, initiatorId)).get();
  const target = db.select({ name: agents.name }).from(agents).where(eq(agents.id, targetId)).get();

  eventBus.emit('conversation_start', {
    conversationId: id,
    agent1: { id: initiatorId, name: initiator?.name },
    agent2: { id: targetId, name: target?.name },
  });

  return id;
}

/**
 * Add a message to a conversation.
 */
export function addMessage(conversationId: string, agentId: string, content: string): boolean {
  const convo = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!convo || convo.state !== 'active') return false;

  // Check agent is a participant
  if (convo.agent1Id !== agentId && convo.agent2Id !== agentId) return false;

  // Check message count limit
  const msgCount = db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .all().length;

  if (msgCount >= CONVERSATION_MAX_MESSAGES) {
    endConversation(conversationId);
    return false;
  }

  // Check cooldown (last message from this agent)
  const lastMsg = db.select().from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      eq(messages.agentId, agentId),
    ))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  if (lastMsg && Date.now() - lastMsg.createdAt < MESSAGE_COOLDOWN_MS) {
    return false;
  }

  const msgId = uuid();
  const now = Date.now();

  db.insert(messages).values({
    id: msgId,
    conversationId,
    agentId,
    content,
    createdAt: now,
  }).run();

  // Update relationship per message
  const otherId = convo.agent1Id === agentId ? convo.agent2Id : convo.agent1Id;
  updateRelationship(agentId, otherId, REL_PER_MESSAGE);

  // Long conversation bonus
  if (msgCount + 1 === REL_LONG_CONVO_THRESHOLD) {
    updateRelationship(agentId, otherId, REL_LONG_CONVO_BONUS);
  }

  const sender = db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId)).get();

  eventBus.emit('chat_message', {
    conversationId,
    messageId: msgId,
    agentId,
    agentName: sender?.name,
    content,
    timestamp: now,
  });

  // Update agent's last active
  db.update(agents).set({ lastActiveAt: now }).where(eq(agents.id, agentId)).run();

  return true;
}

/**
 * End a conversation.
 */
export function endConversation(conversationId: string): void {
  const convo = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!convo || convo.state === 'ended') return;

  const now = Date.now();

  db.update(conversations).set({
    state: 'ended',
    endedAt: now,
  }).where(eq(conversations.id, conversationId)).run();

  // Set agents back to idle
  db.update(agents).set({ state: 'idle' }).where(eq(agents.id, convo.agent1Id)).run();
  db.update(agents).set({ state: 'idle' }).where(eq(agents.id, convo.agent2Id)).run();

  // Generate summary from messages
  const allMessages = db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);

  if (allMessages.length > 0) {
    const agent1 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, convo.agent1Id)).get();
    const agent2 = db.select({ name: agents.name }).from(agents).where(eq(agents.id, convo.agent2Id)).get();

    const summary = `${agent1?.name} and ${agent2?.name} had a conversation with ${allMessages.length} messages.`;
    db.update(conversations).set({ summary }).where(eq(conversations.id, conversationId)).run();
  }

  eventBus.emit('conversation_end', {
    conversationId,
    agent1Id: convo.agent1Id,
    agent2Id: convo.agent2Id,
    messageCount: allMessages.length,
  });
}

/**
 * Check for timed-out conversations (called by game loop).
 */
export function tickConversations(): void {
  const now = Date.now();

  // Get all active/invited conversations
  const activeConvos = db.select().from(conversations)
    .where(or(
      eq(conversations.state, 'active'),
      eq(conversations.state, 'invited'),
    ))
    .all();

  // Track agents that are in active conversations
  const agentsInActiveConvos = new Set<string>();

  for (const convo of activeConvos) {
    // Invite timeout
    if (convo.state === 'invited' && now - convo.startedAt > CONVERSATION_INVITE_TIMEOUT_MS) {
      endConversation(convo.id);
      continue;
    }

    // Max duration timeout
    if (now - convo.startedAt > CONVERSATION_MAX_DURATION_MS) {
      endConversation(convo.id);
      continue;
    }

    // Silence timeout - check last message
    if (convo.state === 'active') {
      const lastMsg = db.select().from(messages)
        .where(eq(messages.conversationId, convo.id))
        .all()
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      const lastActivity = lastMsg ? lastMsg.createdAt : convo.startedAt;
      if (now - lastActivity > CONVERSATION_TIMEOUT_MS) {
        endConversation(convo.id);
      } else {
        // This conversation is still active
        agentsInActiveConvos.add(convo.agent1Id);
        agentsInActiveConvos.add(convo.agent2Id);
      }
    }
  }

  // Cleanup orphaned "talking" agents (stuck in talking but no active conversation)
  const talkingAgents = db.select().from(agents)
    .where(eq(agents.state, 'talking'))
    .all();

  for (const agent of talkingAgents) {
    if (!agentsInActiveConvos.has(agent.id)) {
      // This agent is stuck in "talking" but has no active conversation
      db.update(agents).set({ state: 'idle' }).where(eq(agents.id, agent.id)).run();
      console.log(`[Conversation] Fixed orphaned talking agent: ${agent.name}`);
    }
  }
}

/**
 * Get conversation messages.
 */
export function getConversationMessages(conversationId: string) {
  return db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);
}
