// ============================================================
// Moltlets Town - Inventory Management
// Safe operations with error handling for high-load
// ============================================================

import { db, safeDbOperation } from '@/db';
import { agents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { InventoryData } from '@/types';

// --- Default Inventory ---
export const DEFAULT_INVENTORY: InventoryData = {
  wood: 0,
  fish: {},
  items: {},
};

// --- Parse inventory from DB (JSON string) ---
export function parseInventory(inventoryStr: string): InventoryData {
  try {
    const parsed = JSON.parse(inventoryStr);
    return {
      wood: parsed.wood ?? 0,
      fish: parsed.fish ?? {},
      items: parsed.items ?? {},
    };
  } catch {
    return { ...DEFAULT_INVENTORY };
  }
}

// --- Stringify inventory for DB ---
export function stringifyInventory(inventory: InventoryData): string {
  return JSON.stringify(inventory);
}

// --- Get agent's inventory ---
export function getInventory(agentId: string): InventoryData {
  return safeDbOperation(() => {
    const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!agent) return { ...DEFAULT_INVENTORY };
    return parseInventory(agent.inventory);
  }, { ...DEFAULT_INVENTORY });
}

// --- Save agent's inventory ---
export function saveInventory(agentId: string, inventory: InventoryData): void {
  safeDbOperation(() => {
    db.update(agents)
      .set({
        inventory: stringifyInventory(inventory),
        lastActiveAt: Date.now(),  // Update activity timestamp
      })
      .where(eq(agents.id, agentId))
      .run();
  }, undefined);
}

// --- Add wood to inventory ---
export function addWood(agentId: string, amount: number): InventoryData {
  const inventory = getInventory(agentId);
  inventory.wood += amount;
  saveInventory(agentId, inventory);
  return inventory;
}

// --- Remove wood from inventory (returns false if not enough) ---
export function removeWood(agentId: string, amount: number): boolean {
  const inventory = getInventory(agentId);
  if (inventory.wood < amount) return false;
  inventory.wood -= amount;
  saveInventory(agentId, inventory);
  return true;
}

// --- Add fish to inventory ---
export function addFish(agentId: string, fishType: string, amount: number = 1): InventoryData {
  const inventory = getInventory(agentId);
  inventory.fish[fishType] = (inventory.fish[fishType] ?? 0) + amount;
  saveInventory(agentId, inventory);
  return inventory;
}

// --- Remove fish from inventory ---
export function removeFish(agentId: string, fishType: string, amount: number = 1): boolean {
  const inventory = getInventory(agentId);
  const current = inventory.fish[fishType] ?? 0;
  if (current < amount) return false;
  inventory.fish[fishType] = current - amount;
  if (inventory.fish[fishType] === 0) delete inventory.fish[fishType];
  saveInventory(agentId, inventory);
  return true;
}

// --- Add crafted item to inventory ---
export function addItem(agentId: string, itemType: string, amount: number = 1): InventoryData {
  const inventory = getInventory(agentId);
  inventory.items[itemType] = (inventory.items[itemType] ?? 0) + amount;
  saveInventory(agentId, inventory);
  return inventory;
}

// --- Remove item from inventory ---
export function removeItem(agentId: string, itemType: string, amount: number = 1): boolean {
  const inventory = getInventory(agentId);
  const current = inventory.items[itemType] ?? 0;
  if (current < amount) return false;
  inventory.items[itemType] = current - amount;
  if (inventory.items[itemType] === 0) delete inventory.items[itemType];
  saveInventory(agentId, inventory);
  return true;
}

// --- Check if agent has required items ---
export function hasItems(agentId: string, requirements: Record<string, number>): boolean {
  const inventory = getInventory(agentId);
  for (const [item, qty] of Object.entries(requirements)) {
    if (item === 'wood') {
      if (inventory.wood < qty) return false;
    } else if (item in inventory.fish) {
      if ((inventory.fish[item] ?? 0) < qty) return false;
    } else {
      if ((inventory.items[item] ?? 0) < qty) return false;
    }
  }
  return true;
}

// --- Get total inventory value (for selling all) ---
export function getInventoryValue(agentId: string, prices: Record<string, number>): number {
  const inventory = getInventory(agentId);
  let total = inventory.wood * (prices.wood ?? 0);

  for (const [fishType, qty] of Object.entries(inventory.fish)) {
    total += qty * (prices[fishType] ?? 0);
  }

  for (const [itemType, qty] of Object.entries(inventory.items)) {
    total += qty * (prices[itemType] ?? 0);
  }

  return total;
}

// --- Get inventory summary for display ---
export function getInventorySummary(inventory: InventoryData): string {
  const parts: string[] = [];

  if (inventory.wood > 0) {
    parts.push(`${inventory.wood} wood`);
  }

  for (const [fishType, qty] of Object.entries(inventory.fish)) {
    if (qty > 0) parts.push(`${qty} ${fishType}`);
  }

  for (const [itemType, qty] of Object.entries(inventory.items)) {
    if (qty > 0) parts.push(`${qty} ${itemType.replace(/_/g, ' ')}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'empty';
}
