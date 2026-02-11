// ============================================================
// POST /api/agents/:id/act - Agent performs an action
// High-load optimized with rate limiting
// ============================================================

import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { world } from '@/engine/init';
import { eventBus } from '@/engine/EventBus';
import {
  startConversation,
  addMessage,
  getActiveConversation,
  endConversation,
} from '@/engine/Conversation';
import { handleSell } from '@/engine/Interaction';
import { startBuilding, contributeToBuilding, getBuildingsByAgent, getBuildingAt, findBuildingSite } from '@/engine/Buildings';
import { CONVERSATION_DISTANCE, MARKET_INTERACTION_RANGE, CRAFTING_RECIPES, BUILD_INTERACTION_RANGE } from '@/lib/constants';
import { getInventory, hasItems, removeWood, addItem } from '@/engine/Inventory';
import { checkRateLimit, AGENT_ACTION_LIMIT, GLOBAL_ACTION_LIMIT } from '@/lib/rate-limiter';
import type { ActionRequest, ActionResponse } from '@/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // ═══════════════════════════════════════════════════════════
  // RATE LIMITING - Prevent overload
  // ═══════════════════════════════════════════════════════════

  // Global rate limit check
  const globalCheck = checkRateLimit('global:actions', GLOBAL_ACTION_LIMIT);
  if (!globalCheck.allowed) {
    return globalCheck.response;
  }

  // Per-agent rate limit check
  const agentCheck = checkRateLimit(`agent:${id}`, AGENT_ACTION_LIMIT);
  if (!agentCheck.allowed) {
    return agentCheck.response;
  }

  // Authenticate
  const auth = await validateApiKey(request);
  if (!auth || auth.agentId !== id) {
    return NextResponse.json(
      { error: 'Unauthorized. Provide valid API key in Authorization: Bearer <key>' },
      { status: 401 },
    );
  }

  const agent = world.getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  // Note: With the new flow, agents are only created AFTER verification.
  // NPCs (spawned by system) have no claims and can act freely.
  // This check is a safety measure for edge cases.

  try {
    const body = (await request.json()) as ActionRequest;

    switch (body.action) {
      // ── MOVE ──
      case 'move': {
        if (!body.target || typeof body.target.x !== 'number' || typeof body.target.y !== 'number') {
          return NextResponse.json(
            { error: 'move requires target: { x: number, y: number }' },
            { status: 400 },
          );
        }
        const moved = world.setAgentTarget(id, body.target);
        if (!moved) {
          return NextResponse.json(
            { success: false, error: 'Cannot move there (blocked or in conversation)' },
            { status: 400 },
          );
        }
        return NextResponse.json({
          success: true,
          result: { message: `Moving to (${body.target.x}, ${body.target.y})` },
        } satisfies ActionResponse);
      }

      // ── SAY (chat) ──
      case 'say': {
        if (!body.targetAgentId || !body.message) {
          return NextResponse.json(
            { error: 'say requires targetAgentId and message' },
            { status: 400 },
          );
        }

        if (body.message.length > 500) {
          return NextResponse.json(
            { error: 'Message must be 500 characters or less' },
            { status: 400 },
          );
        }

        const target = world.getAgent(body.targetAgentId);
        if (!target) {
          return NextResponse.json(
            { error: 'Target agent not found' },
            { status: 404 },
          );
        }

        // Check distance
        const dx = agent.posX - target.posX;
        const dy = agent.posY - target.posY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > CONVERSATION_DISTANCE) {
          return NextResponse.json({
            success: false,
            error: `Too far away (distance: ${distance.toFixed(1)}, max: ${CONVERSATION_DISTANCE}). Move closer first.`,
          }, { status: 400 });
        }

        // Get or start conversation
        let convo = getActiveConversation(id);

        if (!convo) {
          // Start new conversation
          const convoId = startConversation(id, body.targetAgentId);
          if (!convoId) {
            return NextResponse.json({
              success: false,
              error: 'Cannot start conversation (one of you is already in a conversation)',
            }, { status: 400 });
          }
          convo = getActiveConversation(id)!;
        }

        // Verify target is the conversation partner
        const partnerId = convo.agent1Id === id ? convo.agent2Id : convo.agent1Id;
        if (partnerId !== body.targetAgentId) {
          return NextResponse.json({
            success: false,
            error: `You're already in a conversation with a different agent. End it first.`,
          }, { status: 400 });
        }

        // Add message
        const sent = addMessage(convo.id, id, body.message);
        if (!sent) {
          return NextResponse.json({
            success: false,
            error: 'Could not send message (cooldown or conversation ended)',
          }, { status: 400 });
        }

        return NextResponse.json({
          success: true,
          result: {
            conversationId: convo.id,
            message: 'Message sent',
          },
        } satisfies ActionResponse);
      }

      // ── EMOTE ──
      case 'emote': {
        if (!body.emoji) {
          return NextResponse.json(
            { error: 'emote requires emoji string' },
            { status: 400 },
          );
        }

        eventBus.emit('agent_emote', {
          agentId: id,
          name: agent.name,
          emoji: body.emoji,
          position: { x: agent.posX, y: agent.posY },
        });

        return NextResponse.json({
          success: true,
          result: { message: `Emoted: ${body.emoji}` },
        } satisfies ActionResponse);
      }

      // ── WANDER ──
      case 'wander': {
        const wandered = world.wanderAgent(id);
        return NextResponse.json({
          success: wandered,
          result: { message: wandered ? 'Wandering to a random spot' : 'Could not find a place to wander' },
        } satisfies ActionResponse);
      }

      // ── LOOK AROUND ──
      case 'look_around': {
        const nearby = world.getNearbyAgents(
          { x: agent.posX, y: agent.posY },
          10,
          id,
        );

        return NextResponse.json({
          success: true,
          result: {
            nearbyAgents: nearby.map(a => ({
              id: a.id,
              name: a.name,
              distance: a.distance.toFixed(1),
              state: a.state,
              mood: a.mood,
              position: { x: a.posX, y: a.posY },
            })),
          },
        } satisfies ActionResponse);
      }

      // ── INTERACT ──
      case 'interact': {
        if (!body.target || !body.interactionType) {
          return NextResponse.json(
            { error: 'interact requires target: { x, y } and interactionType' },
            { status: 400 },
          );
        }

        // Check if agent is close enough happens inside handleInteraction, but we can also check here if we want.
        // The handleInteraction returns { success, message }

        const result = world.interact(id, body.interactionType, body.target.x, body.target.y);

        if (!result.success) {
          return NextResponse.json(
            { success: false, error: result.message },
            { status: 400 },
          );
        }

        return NextResponse.json({
          success: true,
          result: { message: result.message },
        } satisfies ActionResponse);
      }

      // ── END CONVERSATION ──
      case 'leave': {
        const activeConvo = getActiveConversation(id);
        if (activeConvo) {
          endConversation(activeConvo.id);
          return NextResponse.json({
            success: true,
            result: { message: 'Left the conversation' },
          });
        }
        return NextResponse.json({
          success: false,
          error: 'Not in a conversation',
        }, { status: 400 });
      }

      // ── CHOP TREE ──
      case 'chop': {
        if (!body.target || typeof body.target.x !== 'number' || typeof body.target.y !== 'number') {
          return NextResponse.json(
            { error: 'chop requires target: { x: number, y: number }' },
            { status: 400 },
          );
        }

        const chopResult = world.interact(id, 'chop', body.target.x, body.target.y);

        if (!chopResult.success) {
          return NextResponse.json(
            { success: false, error: chopResult.message },
            { status: 400 },
          );
        }

        return NextResponse.json({
          success: true,
          result: { message: chopResult.message, inventory: getInventory(id) },
        } satisfies ActionResponse);
      }

      // ── SELL ITEMS AT MARKET ──
      case 'sell': {
        if (!body.item || typeof body.quantity !== 'number' || body.quantity < 1) {
          return NextResponse.json(
            { error: 'sell requires item (string) and quantity (number >= 1)' },
            { status: 400 },
          );
        }

        // Check if near market
        if (!body.target) {
          return NextResponse.json(
            { error: 'sell requires target: { x, y } near a market stall' },
            { status: 400 },
          );
        }

        const dx = agent.posX - body.target.x;
        const dy = agent.posY - body.target.y;
        const distToMarket = Math.sqrt(dx * dx + dy * dy);

        if (distToMarket > MARKET_INTERACTION_RANGE + 1) {
          return NextResponse.json(
            { success: false, error: `Too far from market (distance: ${distToMarket.toFixed(1)})` },
            { status: 400 },
          );
        }

        const sellResult = handleSell(id, body.item, body.quantity);

        if (!sellResult.success) {
          return NextResponse.json(
            { success: false, error: sellResult.message },
            { status: 400 },
          );
        }

        return NextResponse.json({
          success: true,
          result: {
            message: sellResult.message,
            earned: sellResult.earned,
            inventory: getInventory(id),
          },
        } satisfies ActionResponse);
      }

      // ── CRAFT ITEMS ──
      case 'craft': {
        if (!body.recipeId) {
          return NextResponse.json(
            { error: 'craft requires recipeId' },
            { status: 400 },
          );
        }

        const recipe = CRAFTING_RECIPES.find(r => r.id === body.recipeId);
        if (!recipe) {
          return NextResponse.json(
            { error: `Unknown recipe: ${body.recipeId}. Available: ${CRAFTING_RECIPES.map(r => r.id).join(', ')}` },
            { status: 400 },
          );
        }

        // Check if agent has required materials
        if (!hasItems(id, recipe.inputs)) {
          return NextResponse.json(
            { success: false, error: `Not enough materials. Need: ${Object.entries(recipe.inputs).map(([k, v]) => `${v} ${k}`).join(', ')}` },
            { status: 400 },
          );
        }

        // Remove materials
        for (const [item, qty] of Object.entries(recipe.inputs)) {
          if (item === 'wood') {
            removeWood(id, qty);
          }
        }

        // Add crafted item
        addItem(id, recipe.output);

        // Emit event
        eventBus.emit('item_collected', {
          agentId: id,
          item: recipe.name,
          quantity: 1,
          position: { x: agent.posX, y: agent.posY },
        });

        return NextResponse.json({
          success: true,
          result: {
            message: `Crafted ${recipe.name}!`,
            inventory: getInventory(id),
          },
        } satisfies ActionResponse);
      }

      // ── BUILD HOUSE ──
      case 'build': {
        // Check if agent already has a building
        const existingBuildings = getBuildingsByAgent(id);

        if (existingBuildings.length > 0) {
          // Already has building - contribute to it
          const building = existingBuildings[0];

          if (building.state === 'complete') {
            return NextResponse.json({
              success: false,
              error: 'Your house is already complete!',
            }, { status: 400 });
          }

          // Check distance to building
          const dx = agent.posX - building.x;
          const dy = agent.posY - building.y;
          const distToBuilding = Math.sqrt(dx * dx + dy * dy);

          if (distToBuilding > BUILD_INTERACTION_RANGE + 1) {
            return NextResponse.json({
              success: false,
              error: `Too far from your building site. Go to (${building.x}, ${building.y})`,
            }, { status: 400 });
          }

          const contributeResult = contributeToBuilding(id, building.id);

          if (!contributeResult.success) {
            return NextResponse.json({
              success: false,
              error: contributeResult.error,
            }, { status: 400 });
          }

          return NextResponse.json({
            success: true,
            result: {
              message: contributeResult.completed
                ? 'House completed!'
                : `Added ${contributeResult.woodAdded} wood (${contributeResult.newTotal}/${building.woodRequired})`,
              state: contributeResult.newState,
              progress: Math.floor((contributeResult.newTotal! / building.woodRequired) * 100),
              completed: contributeResult.completed,
              inventory: getInventory(id),
            },
          } satisfies ActionResponse);
        }

        // Start new building
        if (!body.target) {
          // Find a spot automatically
          const spot = findBuildingSite(agent.posX, agent.posY, 15);
          if (!spot) {
            return NextResponse.json({
              success: false,
              error: 'No suitable building spot found nearby',
            }, { status: 400 });
          }
          body.target = spot;
        }

        // Check distance to build spot
        const dx = agent.posX - body.target.x;
        const dy = agent.posY - body.target.y;
        const distToSpot = Math.sqrt(dx * dx + dy * dy);

        if (distToSpot > BUILD_INTERACTION_RANGE + 1) {
          return NextResponse.json({
            success: false,
            error: `Too far from build spot. Move closer to (${body.target.x}, ${body.target.y})`,
          }, { status: 400 });
        }

        const startResult = startBuilding(id, body.target.x, body.target.y, 'house');

        if (!startResult.success) {
          return NextResponse.json({
            success: false,
            error: startResult.error,
          }, { status: 400 });
        }

        return NextResponse.json({
          success: true,
          result: {
            message: 'Started building your house!',
            buildingId: startResult.buildingId,
            position: body.target,
            inventory: getInventory(id),
          },
        } satisfies ActionResponse);
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: "${body.action}". Valid actions: move, say, emote, wander, look_around, interact, leave, chop, sell, craft, build` },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
