// ============================================================
// Moltlets Town - Building System
// ============================================================

import { db } from '@/db';
import { buildings, agents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { eventBus } from './EventBus';
import { removeWood, getInventory } from './Inventory';
import {
    HOUSE_WOOD_COST,
    HOUSE_BUILD_CONTRIBUTION,
    BUILD_ENERGY_COST,
    BUILD_INTERACTION_RANGE,
    TILE_TYPES,
} from '@/lib/constants';
import type { BuildingState, BuildingData } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { logActivity } from '@/lib/solana';

// In-memory building cache
const buildingCache = new Map<string, BuildingData>();

// Reference to world map for placing buildings
let worldMapRef: { tiles: number[][]; obstacles: boolean[][] } | null = null;

export function setWorldMapRefForBuildings(map: { tiles: number[][]; obstacles: boolean[][] }): void {
    worldMapRef = map;
}

// Load buildings from DB
export function loadBuildings(): void {
    try {
        const allBuildings = db.select().from(buildings).all();
        for (const b of allBuildings) {
            buildingCache.set(b.id, {
                id: b.id,
                ownerAgentId: b.ownerAgentId,
                ownerName: b.ownerName,
                x: b.x,
                y: b.y,
                buildingType: b.buildingType,
                state: b.state as BuildingState,
                woodUsed: b.woodUsed,
                woodRequired: b.woodRequired,
                createdAt: b.createdAt,
                completedAt: b.completedAt,
            });

            // Mark building positions on world map (important for rendering after server restart)
            if (worldMapRef && b.x >= 0 && b.y >= 0 &&
                b.x < worldMapRef.tiles.length && b.y < worldMapRef.tiles[0].length) {
                worldMapRef.tiles[b.x][b.y] = TILE_TYPES.BUILDING;
                worldMapRef.obstacles[b.x][b.y] = true;
            }
        }
        console.log(`[Buildings] Loaded ${buildingCache.size} buildings and marked tiles`);
    } catch (err) {
        console.error('[Buildings] Error loading buildings:', err);
        // Continue with empty cache
    }
}

// Get all buildings (refresh from DB to ensure consistency)
export function getAllBuildings(): BuildingData[] {
    // Refresh cache from DB to catch any direct DB updates
    try {
        const allBuildings = db.select().from(buildings).all();
        buildingCache.clear();
        for (const b of allBuildings) {
            buildingCache.set(b.id, {
                id: b.id,
                ownerAgentId: b.ownerAgentId,
                ownerName: b.ownerName,
                x: b.x,
                y: b.y,
                buildingType: b.buildingType,
                state: b.state as BuildingState,
                woodUsed: b.woodUsed,
                woodRequired: b.woodRequired,
                createdAt: b.createdAt,
                completedAt: b.completedAt,
            });
        }
    } catch (err) {
        console.error('[Buildings] Error refreshing buildings:', err);
    }
    return Array.from(buildingCache.values());
}

// Get building at position
export function getBuildingAt(x: number, y: number): BuildingData | null {
    for (const b of buildingCache.values()) {
        if (b.x === x && b.y === y) return b;
    }
    return null;
}

// Get buildings by agent
export function getBuildingsByAgent(agentId: string): BuildingData[] {
    return Array.from(buildingCache.values()).filter(b => b.ownerAgentId === agentId);
}

// Minimum distance between buildings to prevent collision
const MIN_BUILDING_DISTANCE = 4;

// Tiles that cannot be built on
const NON_BUILDABLE_TILES = new Set([
    TILE_TYPES.PATH,
    TILE_TYPES.WATER,
    TILE_TYPES.STONE,
    TILE_TYPES.TREE,
    TILE_TYPES.BUILDING,
    TILE_TYPES.BRIDGE,
    TILE_TYPES.DOCK,
    TILE_TYPES.FENCE,
    TILE_TYPES.GARDEN,
    TILE_TYPES.FLOWER_FIELD,
    TILE_TYPES.SAND_DUNE,
    TILE_TYPES.PALM_TREE,
    TILE_TYPES.CACTUS,
    TILE_TYPES.WATER_DEEP,
    TILE_TYPES.MARKET_STALL,
    TILE_TYPES.FOUNTAIN,
    TILE_TYPES.STONE_PATH,
    TILE_TYPES.SLIDE,
    TILE_TYPES.SWING,
    TILE_TYPES.PICNIC_TABLE,
    TILE_TYPES.LAMP_POST,
    TILE_TYPES.BENCH,
]);

// Check if position is valid for building
export function canBuildAt(x: number, y: number): { valid: boolean; reason?: string } {
    if (!worldMapRef) return { valid: false, reason: 'World not initialized' };

    // Check bounds
    if (x < 0 || y < 0 || x >= worldMapRef.tiles.length || y >= worldMapRef.tiles[0].length) {
        return { valid: false, reason: 'Out of bounds' };
    }

    // Check if tile is grass only (the only buildable tile)
    const tile = worldMapRef.tiles[x][y];
    if (tile !== TILE_TYPES.GRASS) {
        return { valid: false, reason: 'Can only build on grass' };
    }

    // Check if tile is in non-buildable set (extra safety)
    if (NON_BUILDABLE_TILES.has(tile)) {
        return { valid: false, reason: 'Cannot build on this tile type' };
    }

    // Check if already has building at this spot
    if (getBuildingAt(x, y)) {
        return { valid: false, reason: 'Building already exists here' };
    }

    // Check if obstacle
    if (worldMapRef.obstacles[x][y]) {
        return { valid: false, reason: 'Obstacle in the way' };
    }

    // Check distance to all existing buildings to prevent collision
    for (const building of buildingCache.values()) {
        const dist = Math.sqrt(Math.pow(x - building.x, 2) + Math.pow(y - building.y, 2));
        if (dist < MIN_BUILDING_DISTANCE) {
            return { valid: false, reason: `Too close to ${building.ownerName}'s house (min ${MIN_BUILDING_DISTANCE} tiles apart)` };
        }
    }

    // Check surrounding tiles to ensure building has space (3x3 area check)
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < worldMapRef.tiles.length && ny < worldMapRef.tiles[0].length) {
                const neighborTile = worldMapRef.tiles[nx][ny];
                // Don't build if adjacent to water, paths, gardens, or special tiles
                if (neighborTile === TILE_TYPES.WATER ||
                    neighborTile === TILE_TYPES.WATER_DEEP ||
                    neighborTile === TILE_TYPES.PATH ||
                    neighborTile === TILE_TYPES.STONE_PATH ||
                    neighborTile === TILE_TYPES.FOUNTAIN ||
                    neighborTile === TILE_TYPES.MARKET_STALL ||
                    neighborTile === TILE_TYPES.GARDEN ||
                    neighborTile === TILE_TYPES.FLOWER_FIELD ||
                    neighborTile === TILE_TYPES.STONE ||
                    neighborTile === TILE_TYPES.BENCH ||
                    neighborTile === TILE_TYPES.LAMP_POST) {
                    return { valid: false, reason: 'Too close to water, path, garden, or special area' };
                }
            }
        }
    }

    return { valid: true };
}

// Start building a house
export interface StartBuildResult {
    success: boolean;
    buildingId?: string;
    error?: string;
}

export function startBuilding(
    agentId: string,
    x: number,
    y: number,
    buildingType: string = 'house'
): StartBuildResult {
    // Get agent
    const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!agent) return { success: false, error: 'Agent not found' };

    // Check if agent already has a building
    const existingBuildings = getBuildingsByAgent(agentId);
    if (existingBuildings.length > 0) {
        return { success: false, error: 'You already have a building' };
    }

    // Check if position is valid
    const canBuild = canBuildAt(x, y);
    if (!canBuild.valid) {
        return { success: false, error: canBuild.reason };
    }

    // Check if agent has at least some wood to start
    const inventory = getInventory(agentId);
    if (inventory.wood < HOUSE_BUILD_CONTRIBUTION) {
        return { success: false, error: `Need at least ${HOUSE_BUILD_CONTRIBUTION} wood to start building` };
    }

    // Deduct initial wood
    removeWood(agentId, HOUSE_BUILD_CONTRIBUTION);

    // Create building
    const buildingId = uuidv4();
    const now = Date.now();

    const newBuilding: BuildingData = {
        id: buildingId,
        ownerAgentId: agentId,
        ownerName: agent.name,
        x,
        y,
        buildingType,
        state: 'foundation',
        woodUsed: HOUSE_BUILD_CONTRIBUTION,
        woodRequired: HOUSE_WOOD_COST,
        createdAt: now,
        completedAt: null,
    };

    // Save to DB
    db.insert(buildings).values({
        id: buildingId,
        ownerAgentId: agentId,
        ownerName: agent.name,
        x,
        y,
        buildingType,
        state: 'foundation',
        woodUsed: HOUSE_BUILD_CONTRIBUTION,
        woodRequired: HOUSE_WOOD_COST,
        createdAt: now,
        completedAt: null,
    }).run();

    // Add to cache
    buildingCache.set(buildingId, newBuilding);

    // Update map tile
    if (worldMapRef) {
        worldMapRef.tiles[x][y] = TILE_TYPES.BUILDING;
        worldMapRef.obstacles[x][y] = true;
    }

    // Emit event
    eventBus.emit('building_started', {
        buildingId,
        agentId,
        agentName: agent.name,
        x,
        y,
        buildingType,
        woodUsed: HOUSE_BUILD_CONTRIBUTION,
        woodRequired: HOUSE_WOOD_COST,
    });

    console.log(`[Buildings] ${agent.name} started building at (${x}, ${y})`);

    return { success: true, buildingId };
}

// Contribute wood to building
export interface ContributeResult {
    success: boolean;
    woodAdded?: number;
    newTotal?: number;
    newState?: BuildingState;
    completed?: boolean;
    error?: string;
}

export function contributeToBuilding(agentId: string, buildingId: string): ContributeResult {
    const building = buildingCache.get(buildingId);
    if (!building) return { success: false, error: 'Building not found' };

    // Only owner can contribute
    if (building.ownerAgentId !== agentId) {
        return { success: false, error: 'Only the owner can build' };
    }

    // Already complete?
    if (building.state === 'complete') {
        return { success: false, error: 'Building already complete' };
    }

    // Check agent
    const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!agent) return { success: false, error: 'Agent not found' };

    // Check energy
    if (agent.energy < BUILD_ENERGY_COST) {
        return { success: false, error: 'Not enough energy' };
    }

    // Check wood
    const inventory = getInventory(agentId);
    const woodToAdd = Math.min(HOUSE_BUILD_CONTRIBUTION, inventory.wood);
    if (woodToAdd === 0) {
        return { success: false, error: 'No wood to contribute' };
    }

    // Deduct wood and energy
    removeWood(agentId, woodToAdd);
    db.update(agents)
        .set({
            energy: agent.energy - BUILD_ENERGY_COST,
            lastActiveAt: Date.now(),
        })
        .where(eq(agents.id, agentId))
        .run();

    // Add wood to building
    building.woodUsed += woodToAdd;

    // Calculate new state based on progress
    const progress = building.woodUsed / building.woodRequired;
    let newState: BuildingState = building.state;

    if (progress >= 1.0) {
        newState = 'complete';
        building.completedAt = Date.now();
    } else if (progress >= 0.75) {
        newState = 'roof';
    } else if (progress >= 0.5) {
        newState = 'walls';
    } else if (progress >= 0.25) {
        newState = 'frame';
    }

    building.state = newState;

    // Update DB
    db.update(buildings)
        .set({
            woodUsed: building.woodUsed,
            state: newState,
            completedAt: building.completedAt,
        })
        .where(eq(buildings.id, buildingId))
        .run();

    // Emit events
    if (newState === 'complete') {
        eventBus.emit('building_completed', {
            buildingId,
            agentId,
            agentName: agent.name,
            x: building.x,
            y: building.y,
        });

        // Log to Solana - building completion is a major milestone!
        logActivity('build', agentId, agent.name, 'house_complete', building.woodUsed);

        console.log(`[Buildings] ${agent.name}'s house completed!`);
    } else {
        eventBus.emit('building_progress', {
            buildingId,
            agentId,
            woodUsed: building.woodUsed,
            woodRequired: building.woodRequired,
            state: newState,
            progress: Math.floor(progress * 100),
        });
    }

    // Emit activity for animation
    eventBus.emit('activity_start', {
        agentId,
        activity: 'building',
        targetX: building.x,
        targetY: building.y,
        duration: 2000,
        progress: Math.floor(progress * 100),
    });

    return {
        success: true,
        woodAdded: woodToAdd,
        newTotal: building.woodUsed,
        newState,
        completed: newState === 'complete',
    };
}

// Town center exclusion zone (no building near town plaza/fountain)
// Town plaza is at (35, 35) with 10x10 size, center around (40, 40)
const TOWN_CENTER = { x: 40, y: 40 };
const TOWN_CENTER_RADIUS = 18;

// Garden/park areas exclusion zones - based on actual World.ts map generation
const EXCLUSION_ZONES = [
    { x: 40, y: 40, radius: 18 },   // Town plaza with fountain (35,35 + 5 offset for center)
    { x: 14, y: 14, radius: 12 },   // Garden area (8,8 with 12x12 size, centered at 14,14)
    { x: 60, y: 10, radius: 10 },   // Beach area (keep houses off beach)
    { x: 10, y: 60, radius: 10 },   // Desert area
    { x: 60, y: 60, radius: 10 },   // Playground area
];

// Find nearest building site for an agent (avoiding restricted areas)
export function findBuildingSite(posX: number, posY: number, radius: number = 25): { x: number; y: number } | null {
    if (!worldMapRef) return null;

    const candidates: { x: number; y: number; dist: number }[] = [];

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            const x = Math.floor(posX) + dx;
            const y = Math.floor(posY) + dy;

            // Skip spots in exclusion zones
            let inExclusionZone = false;
            for (const zone of EXCLUSION_ZONES) {
                const distToZone = Math.sqrt(
                    Math.pow(x - zone.x, 2) + Math.pow(y - zone.y, 2)
                );
                if (distToZone < zone.radius) {
                    inExclusionZone = true;
                    break;
                }
            }
            if (inExclusionZone) continue;

            // Use the comprehensive canBuildAt check
            const canBuild = canBuildAt(x, y);
            if (canBuild.valid) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                candidates.push({ x, y, dist });
            }
        }
    }

    if (candidates.length === 0) return null;

    // Sort by distance and return closest valid spot
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates[0];
}
