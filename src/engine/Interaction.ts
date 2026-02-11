// ============================================================
// Moltlets Town - Interaction System
// ============================================================

import { db } from '@/db';
import { agents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { eventBus } from './EventBus';
import { TILE_TYPES, FISH_TYPES, FISH_ENERGY_COST, MARKET_PRICES, RAIN_FISH_RARITY_BONUS } from '@/lib/constants';
import type { Position } from '@/types';
import { chopTree, getTreeState } from './Resources';
import { addFish, getInventory, removeItem, removeFish, removeWood } from './Inventory';
import { isRaining } from './WorldTime';
import { logActivity } from '@/lib/solana';

// ── Types ────────────────────────────────────────────────────

export type InteractionType = 'sit' | 'fish' | 'vending' | 'sign' | 'sleep' | 'chop' | 'sell' | 'picnic' | 'play';

export interface Interactable {
    type: InteractionType;
    x: number;
    y: number;
    label?: string; // e.g. "Bench" or "Cola Machine"
    range: number;  // Distance required to interact
    cooldown?: number; // ms
}

// ── Registry ─────────────────────────────────────────────────

const interactables: Interactable[] = [];

export function registerInteractable(item: Interactable) {
    interactables.push(item);
}

export function getInteractables(): Interactable[] {
    return interactables;
}

export function getNearbyInteractables(pos: Position, radius: number = 2): Interactable[] {
    return interactables.filter(item => {
        const dx = item.x - pos.x;
        const dy = item.y - pos.y;
        return Math.sqrt(dx * dx + dy * dy) <= radius;
    });
}

// ── Interaction Logic ────────────────────────────────────────

export function handleInteraction(agentId: string, interactionType: InteractionType, targetX: number, targetY: number): { success: boolean; message: string } {
    const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!agent) return { success: false, message: 'Agent not found' };

    // Validate distance
    const dist = Math.sqrt(Math.pow(agent.posX - targetX, 2) + Math.pow(agent.posY - targetY, 2));
    if (dist > 2.5) {
        return { success: false, message: 'Too far away' };
    }

    // Find nearest interactable to ensure it exists
    const target = interactables.find(i =>
        i.type === interactionType &&
        Math.abs(i.x - targetX) < 1 &&
        Math.abs(i.y - targetY) < 1
    );

    if (!target) {
        // Allow implicit interactions if valid tile? For now, require registration.
        // return { success: false, message: 'Nothing there to interact with' };
    }

    switch (interactionType) {
        case 'sit':
        case 'picnic':
            return handleSit(agent);
        case 'fish':
            return handleFish(agent);
        case 'vending':
            return handleVending(agent);
        case 'play':
            return handlePlay(agent);
        case 'sign':
            return { success: true, message: 'Read a sign.' };
        case 'chop':
            return handleChop(agent, targetX, targetY);
        case 'sell':
            return { success: false, message: 'Use the sell action with item and quantity' };
        default:
            return { success: false, message: 'Unknown interaction' };
    }
}

// ── Specific Handlers ────────────────────────────────────────

function handleSit(agent: typeof agents.$inferSelect) {
    // Restore energy
    const newEnergy = Math.min(100, agent.energy + 25);
    db.update(agents).set({
        energy: newEnergy,
        state: 'idle', // Sitting is an idle state conceptually for now
        lastActiveAt: Date.now()
    }).where(eq(agents.id, agent.id)).run();

    return { success: true, message: 'Sat down and rested. Energy restored.' };
}

function handlePlay(agent: typeof agents.$inferSelect) {
    // Boost happiness and energy slightly (exercise!)
    const newHappy = Math.min(100, agent.happiness + 15);
    const newEnergy = Math.max(0, agent.energy - 5);
    db.update(agents).set({
        happiness: newHappy,
        energy: newEnergy,
        mood: 'excited',
        lastActiveAt: Date.now()
    }).where(eq(agents.id, agent.id)).run();

    return { success: true, message: 'Played on the playground! So fun!' };
}

function handleFish(agent: typeof agents.$inferSelect) {
    // Use enhanced fish handler with inventory system
    return handleFishEnhanced(agent);
}

function handleVending(agent: typeof agents.$inferSelect) {

    db.update(agents)
        .set({
            money: agent.money - 5,
            energy: Math.min(100, agent.energy + 10),
            lastActiveAt: Date.now()
        })
        .where(eq(agents.id, agent.id))
        .run();

    return { success: true, message: 'Bought a snack! Yummy.' };
}

// ── Chop Tree Handler ───────────────────────────────────────

function handleChop(agent: typeof agents.$inferSelect, targetX: number, targetY: number) {
    const result = chopTree(agent.id, targetX, targetY);

    if (!result.success) {
        return { success: false, message: result.error || 'Cannot chop here' };
    }

    // Log to Solana
    logActivity('chop', agent.id, agent.name, 'tree', result.woodGained);

    // Emit activity animation event (longer duration for better visibility)
    eventBus.emit('activity_start', {
        agentId: agent.id,
        activity: 'chopping',
        targetX: Math.floor(targetX),
        targetY: Math.floor(targetY),
        duration: 6000,  // 6 seconds for visible animation
        woodGained: result.woodGained,
    });

    return {
        success: true,
        message: `Chopped tree! Got ${result.woodGained} wood.`,
        woodGained: result.woodGained,
    };
}

// ── Enhanced Fish Handler (with inventory) ──────────────────

// Lazy import to avoid circular dependency
let _world: { map: { tiles: number[][] } } | null = null;
function getWorld() {
    if (!_world) {
        // Dynamic require to break circular dependency
        _world = require('./World').world;
    }
    return _world;
}

function isNearWater(x: number, y: number): boolean {
    const world = getWorld();
    if (!world?.map?.tiles) return true; // Allow fishing if world not loaded yet

    const tiles = world.map.tiles;
    const px = Math.floor(x);
    const py = Math.floor(y);

    // Check adjacent tiles for water
    for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const tx = px + dx;
        const ty = py + dy;
        if (ty >= 0 && ty < tiles.length && tx >= 0 && tx < tiles[0].length) {
            const tile = tiles[ty][tx];
            if (tile === TILE_TYPES.WATER || tile === TILE_TYPES.WATER_DEEP) {
                return true;
            }
        }
    }
    return false;
}

export function handleFishEnhanced(agent: typeof agents.$inferSelect) {
    if (agent.energy < FISH_ENERGY_COST) {
        return { success: false, message: 'Too tired to fish' };
    }

    // Check if near water
    if (!isNearWater(agent.posX, agent.posY)) {
        return { success: false, message: 'Must be near water to fish!' };
    }

    // Emit activity animation event (fishing starts - longer duration for visible animation)
    eventBus.emit('activity_start', {
        agentId: agent.id,
        activity: 'fishing',
        duration: 8000,  // 8 seconds for visible fishing animation
        position: { x: agent.posX, y: agent.posY },
    });

    // Check if raining (better rare fish chances)
    const raining = isRaining();
    const rarityBonus = raining ? RAIN_FISH_RARITY_BONUS : 0;

    // Roll for catch using weighted chances (boosted during rain)
    const roll = Math.random();
    let cumulative = 0;
    let caughtFish = null;

    // During rain, rare fish have boosted chances
    for (const fish of FISH_TYPES) {
        let fishChance = fish.chance;
        // Boost rare fish during rain
        if (raining && (fish.rarity === 'rare' || fish.rarity === 'legendary')) {
            fishChance += rarityBonus;
        }
        cumulative += fishChance;
        if (roll < cumulative) {
            caughtFish = fish;
            break;
        }
    }

    // Deduct energy
    db.update(agents)
        .set({
            energy: agent.energy - FISH_ENERGY_COST,
            exp: (agent.exp || 0) + (caughtFish ? 10 : 3),
            lastActiveAt: Date.now(),
        })
        .where(eq(agents.id, agent.id))
        .run();

    if (caughtFish) {
        // Add fish to inventory
        addFish(agent.id, caughtFish.id);

        // Log to Solana (only log rare+ fish to save on batch size)
        if (caughtFish.rarity === 'rare' || caughtFish.rarity === 'legendary') {
            logActivity('fish', agent.id, agent.name, caughtFish.id, caughtFish.price);
        }

        // Emit item collected event
        eventBus.emit('item_collected', {
            agentId: agent.id,
            item: caughtFish.name,
            quantity: 1,
            position: { x: agent.posX, y: agent.posY },
        });

        return {
            success: true,
            message: `Caught a ${caughtFish.name}! (${caughtFish.rarity})`,
            fish: caughtFish.id,
        };
    }

    return { success: true, message: 'No bites this time... (+3 xp)' };
}

// ── Sell Item Handler ───────────────────────────────────────

export function handleSell(
    agentId: string,
    item: string,
    quantity: number
): { success: boolean; message: string; earned?: number } {
    const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!agent) return { success: false, message: 'Agent not found' };

    const inventory = getInventory(agentId);
    const price = MARKET_PRICES[item] ?? 0;

    if (price === 0) {
        return { success: false, message: `Cannot sell ${item}` };
    }

    // Check and remove from inventory
    let removed = false;
    if (item === 'wood') {
        if (inventory.wood < quantity) {
            return { success: false, message: `Not enough wood (have ${inventory.wood})` };
        }
        removed = removeWood(agentId, quantity);
    } else if (item in inventory.fish) {
        if ((inventory.fish[item] ?? 0) < quantity) {
            return { success: false, message: `Not enough ${item} (have ${inventory.fish[item] ?? 0})` };
        }
        removed = removeFish(agentId, item, quantity);
    } else if (item in inventory.items) {
        if ((inventory.items[item] ?? 0) < quantity) {
            return { success: false, message: `Not enough ${item} (have ${inventory.items[item] ?? 0})` };
        }
        removed = removeItem(agentId, item, quantity);
    } else {
        return { success: false, message: `You don't have any ${item}` };
    }

    if (!removed) {
        return { success: false, message: `Failed to remove ${item} from inventory` };
    }

    // Add money
    const earned = price * quantity;
    db.update(agents)
        .set({
            money: (agent.money ?? 0) + earned,
            lastActiveAt: Date.now(),
        })
        .where(eq(agents.id, agentId))
        .run();

    // Log to Solana (only for trades earning 20+ gold)
    if (earned >= 20) {
        logActivity('trade', agentId, agent.name, `sold_${item}`, earned);
    }

    // Emit activity animation event (selling)
    eventBus.emit('activity_start', {
        agentId,
        activity: 'selling',
        duration: 1000,
        item,
        quantity,
        earned,
        position: { x: agent.posX, y: agent.posY },
    });

    // Emit money earned event
    eventBus.emit('money_earned', {
        agentId,
        amount: earned,
        source: 'selling',
        position: { x: agent.posX, y: agent.posY },
    });

    return {
        success: true,
        message: `Sold ${quantity} ${item} for $${earned}!`,
        earned,
    };
}
