// ============================================================
// Moltlets Town - Resource Management (Trees, etc.)
// ============================================================

import { db } from '@/db';
import { agents, treeStates } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { eventBus } from './EventBus';
import { addWood } from './Inventory';
import {
  TREE_REGROW_TIME_MS,
  WOOD_PER_TREE_MIN,
  WOOD_PER_TREE_MAX,
  CHOP_ENERGY_COST,
  RAIN_TREE_GROWTH_MULTIPLIER,
} from '@/lib/constants';
import type { TreeState } from '@/types';

// Import rain check function (will be set dynamically to avoid circular deps)
let isRainingFn: () => boolean = () => false;
export function setIsRainingFn(fn: () => boolean): void {
  isRainingFn = fn;
}

// --- In-memory tree state cache (for fast lookups) ---
const treeCache = new Map<string, {
  state: TreeState;
  regrowsAt: number | null;
}>();

// --- Export tree cache for WorldTime tree spawning ---
export function getTreeCache(): Map<string, { state: string; regrowsAt: number | null }> {
  return treeCache as Map<string, { state: string; regrowsAt: number | null }>;
}

// --- Get tree key from coordinates ---
export function getTreeKey(x: number, y: number): string {
  return `${Math.floor(x)}_${Math.floor(y)}`;
}

// --- Initialize tree in cache (called when registering tree tiles) ---
export function registerTree(x: number, y: number): void {
  const key = getTreeKey(x, y);

  // Check if tree state exists in DB
  const existing = db.select().from(treeStates).where(eq(treeStates.id, key)).get();

  if (existing) {
    // Load from DB
    treeCache.set(key, {
      state: existing.state as TreeState,
      regrowsAt: existing.regrowsAt,
    });
  } else {
    // Create new full tree
    treeCache.set(key, { state: 'full', regrowsAt: null });
    db.insert(treeStates).values({
      id: key,
      x: Math.floor(x),
      y: Math.floor(y),
      state: 'full',
      resourceCount: Math.floor(Math.random() * (WOOD_PER_TREE_MAX - WOOD_PER_TREE_MIN + 1)) + WOOD_PER_TREE_MIN,
      regrowsAt: null,
    }).onConflictDoNothing().run();
  }
}

// --- Get tree state ---
export function getTreeState(x: number, y: number): TreeState {
  const key = getTreeKey(x, y);
  const cached = treeCache.get(key);
  return cached?.state ?? 'full';
}

// --- Get all tree states (for rendering) ---
export function getAllTreeStates(): Map<string, TreeState> {
  const result = new Map<string, TreeState>();
  for (const [key, data] of treeCache.entries()) {
    result.set(key, data.state);
  }
  return result;
}

// --- Chop tree result ---
export interface ChopResult {
  success: boolean;
  woodGained: number;
  error?: string;
  treeState: TreeState;
}

// --- Chop a tree ---
export function chopTree(agentId: string, x: number, y: number): ChopResult {
  const key = getTreeKey(x, y);
  const cached = treeCache.get(key);

  // Check if tree exists and is full
  if (!cached || cached.state !== 'full') {
    return { success: false, woodGained: 0, error: 'No harvestable tree here', treeState: cached?.state ?? 'full' };
  }

  // Check agent energy
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) {
    return { success: false, woodGained: 0, error: 'Agent not found', treeState: 'full' };
  }
  if (agent.energy < CHOP_ENERGY_COST) {
    return { success: false, woodGained: 0, error: 'Not enough energy', treeState: 'full' };
  }

  // Calculate wood gained (1-3)
  const woodGained = Math.floor(Math.random() * (WOOD_PER_TREE_MAX - WOOD_PER_TREE_MIN + 1)) + WOOD_PER_TREE_MIN;

  // Deduct energy
  const newEnergy = Math.max(0, agent.energy - CHOP_ENERGY_COST);
  db.update(agents)
    .set({ energy: newEnergy, lastActiveAt: Date.now() })
    .where(eq(agents.id, agentId))
    .run();

  // Add wood to inventory
  addWood(agentId, woodGained);

  // Update tree state to stump
  const regrowsAt = Date.now() + TREE_REGROW_TIME_MS;
  treeCache.set(key, { state: 'stump', regrowsAt });

  db.update(treeStates)
    .set({ state: 'stump', regrowsAt, resourceCount: 0 })
    .where(eq(treeStates.id, key))
    .run();

  // Emit events
  eventBus.emit('tree_chopped', {
    agentId,
    x: Math.floor(x),
    y: Math.floor(y),
    woodGained,
  });

  eventBus.emit('item_collected', {
    agentId,
    item: 'wood',
    quantity: woodGained,
    position: { x: Math.floor(x), y: Math.floor(y) },
  });

  return { success: true, woodGained, treeState: 'stump' };
}

// --- Tick tree regrowth (called periodically by game loop) ---
export function tickTreeRegrowth(): void {
  const now = Date.now();

  // Rain makes trees grow faster
  const raining = isRainingFn();
  const growthMultiplier = raining ? RAIN_TREE_GROWTH_MULTIPLIER : 1.0;

  for (const [key, data] of treeCache.entries()) {
    if (data.state === 'stump' && data.regrowsAt) {
      // Adjust regrow time based on rain
      const effectiveRegrowTime = raining
        ? now + (data.regrowsAt - now) / growthMultiplier
        : data.regrowsAt;

      // Check if halfway through regrowth (become sapling)
      const halfwayTime = effectiveRegrowTime - (TREE_REGROW_TIME_MS / 2 / growthMultiplier);
      if (now >= halfwayTime && now < effectiveRegrowTime) {
        // Transition to sapling
        treeCache.set(key, { state: 'sapling', regrowsAt: data.regrowsAt });
        db.update(treeStates)
          .set({ state: 'sapling' })
          .where(eq(treeStates.id, key))
          .run();
      } else if (now >= data.regrowsAt) {
        // Fully regrown
        treeCache.set(key, { state: 'full', regrowsAt: null });
        db.update(treeStates)
          .set({
            state: 'full',
            regrowsAt: null,
            resourceCount: Math.floor(Math.random() * (WOOD_PER_TREE_MAX - WOOD_PER_TREE_MIN + 1)) + WOOD_PER_TREE_MIN,
          })
          .where(eq(treeStates.id, key))
          .run();

        // Parse coordinates from key
        const [xStr, yStr] = key.split('_');
        eventBus.emit('tree_regrown', {
          x: parseInt(xStr, 10),
          y: parseInt(yStr, 10),
        });
      }
    } else if (data.state === 'sapling' && data.regrowsAt && now >= data.regrowsAt) {
      // Fully regrown from sapling
      treeCache.set(key, { state: 'full', regrowsAt: null });
      db.update(treeStates)
        .set({
          state: 'full',
          regrowsAt: null,
          resourceCount: Math.floor(Math.random() * (WOOD_PER_TREE_MAX - WOOD_PER_TREE_MIN + 1)) + WOOD_PER_TREE_MIN,
        })
        .where(eq(treeStates.id, key))
        .run();

      const [xStr, yStr] = key.split('_');
      eventBus.emit('tree_regrown', {
        x: parseInt(xStr, 10),
        y: parseInt(yStr, 10),
      });
    }
  }
}

// --- Load all tree states from DB on startup ---
export function loadTreeStates(): void {
  const allTrees = db.select().from(treeStates).all();
  for (const tree of allTrees) {
    treeCache.set(tree.id, {
      state: tree.state as TreeState,
      regrowsAt: tree.regrowsAt,
    });
  }
  console.log(`[Resources] Loaded ${allTrees.length} tree states from DB`);
}
