/**
 * Script to relocate buildings that are on invalid tiles (roads, etc.)
 * Run with: npx tsx scripts/relocate-buildings.ts
 */

import Database from 'better-sqlite3';

const db = new Database('./moltlets-town.db');

// Tile type constants
const TILE_TYPES = {
    GRASS: 0,
    PATH: 1,
    WATER: 2,
    STONE: 3,
    FLOWER: 4,
    TREE: 5,
    BUILDING: 6,
    BRIDGE: 7,
    SAND: 8,
    DOCK: 9,
    FENCE: 10,
    GARDEN: 11,
    FLOWER_FIELD: 12,
    SAND_DUNE: 13,
    PALM_TREE: 14,
    CACTUS: 15,
    WATER_DEEP: 16,
    MARKET_STALL: 17,
    FOUNTAIN: 18,
    STONE_PATH: 19,
    SLIDE: 20,
    SWING: 21,
    PICNIC_TABLE: 22,
    LAMP_POST: 23,
    BENCH: 24,
};

async function main() {
    // Fetch world state from API to get tile data
    const response = await fetch('http://localhost:3000/api/world/state');
    const worldState = await response.json();
    const tiles: number[][] = worldState.map.tiles;

    // Get all buildings
    const buildings = db.prepare('SELECT * FROM buildings').all() as Array<{
        id: string;
        owner_agent_id: string;
        owner_name: string;
        x: number;
        y: number;
        building_type: string;
        state: string;
        wood_used: number;
        wood_required: number;
        created_at: number;
        completed_at: number | null;
    }>;

    console.log(`Found ${buildings.length} buildings\n`);

    // Check if a position has adjacent path tiles
    function hasAdjacentPath(x: number, y: number): boolean {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < tiles.length && ny < tiles[0].length) {
                    if (tiles[nx][ny] === TILE_TYPES.PATH ||
                        tiles[nx][ny] === TILE_TYPES.STONE_PATH) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Check if position is valid for building
    function isValidBuildLocation(x: number, y: number, excludePositions: Set<string>): boolean {
        const MIN_DISTANCE = 4;

        // Must be grass
        if (tiles[x]?.[y] !== TILE_TYPES.GRASS && tiles[x]?.[y] !== TILE_TYPES.BUILDING) {
            return false;
        }

        // Not adjacent to path
        if (hasAdjacentPath(x, y)) {
            return false;
        }

        // Check distance from other buildings
        for (const pos of excludePositions) {
            const [bx, by] = pos.split(',').map(Number);
            const dist = Math.sqrt(Math.pow(x - bx, 2) + Math.pow(y - by, 2));
            if (dist < MIN_DISTANCE) {
                return false;
            }
        }

        return true;
    }

    // Find a valid new location for a building
    function findNewLocation(excludePositions: Set<string>): { x: number; y: number } | null {
        // Try random positions
        for (let attempts = 0; attempts < 2000; attempts++) {
            const x = Math.floor(Math.random() * (tiles.length - 10)) + 5;
            const y = Math.floor(Math.random() * (tiles[0].length - 10)) + 5;

            if (isValidBuildLocation(x, y, excludePositions)) {
                return { x, y };
            }
        }
        return null;
    }

    // Track positions for distance checking
    const usedPositions = new Set<string>();

    // Tiles that are invalid for building (everything except GRASS)
    const INVALID_TILES = new Set([
        TILE_TYPES.PATH,
        TILE_TYPES.WATER,
        TILE_TYPES.WATER_DEEP,
        TILE_TYPES.STONE,
        TILE_TYPES.TREE,
        TILE_TYPES.BRIDGE,
        TILE_TYPES.DOCK,
        TILE_TYPES.FENCE,
        TILE_TYPES.GARDEN,
        TILE_TYPES.FLOWER_FIELD,
        TILE_TYPES.SAND_DUNE,
        TILE_TYPES.PALM_TREE,
        TILE_TYPES.CACTUS,
        TILE_TYPES.MARKET_STALL,
        TILE_TYPES.FOUNTAIN,
        TILE_TYPES.STONE_PATH,
        TILE_TYPES.SLIDE,
        TILE_TYPES.SWING,
        TILE_TYPES.PICNIC_TABLE,
        TILE_TYPES.LAMP_POST,
        TILE_TYPES.BENCH,
        TILE_TYPES.SAND,
        TILE_TYPES.FLOWER,
    ]);

    // Buildings to relocate
    const buildingsToRelocate: Array<{ building: typeof buildings[0]; reason: string }> = [];

    const tileNames: Record<number, string> = {
        [TILE_TYPES.PATH]: 'PATH/ROAD',
        [TILE_TYPES.WATER]: 'WATER',
        [TILE_TYPES.TREE]: 'TREE',
        [TILE_TYPES.PICNIC_TABLE]: 'PICNIC_TABLE',
        [TILE_TYPES.STONE_PATH]: 'STONE_PATH',
        [TILE_TYPES.SAND]: 'SAND',
        [TILE_TYPES.FLOWER]: 'FLOWER',
        [TILE_TYPES.GARDEN]: 'GARDEN',
    };

    for (const b of buildings) {
        const tileType = tiles[b.x]?.[b.y];

        // Check if on invalid tile (not GRASS or BUILDING)
        if (tileType !== TILE_TYPES.GRASS && tileType !== TILE_TYPES.BUILDING) {
            buildingsToRelocate.push({
                building: b,
                reason: `On invalid tile: ${tileNames[tileType] || `type ${tileType}`}`
            });
        } else if (hasAdjacentPath(b.x, b.y)) {
            buildingsToRelocate.push({
                building: b,
                reason: 'Adjacent to road (too close)'
            });
        } else {
            usedPositions.add(`${b.x},${b.y}`);
        }
    }

    console.log(`Buildings to relocate: ${buildingsToRelocate.length}\n`);

    if (buildingsToRelocate.length === 0) {
        console.log('All buildings are in valid locations!');
        process.exit(0);
    }

    // Relocate buildings
    const updateStmt = db.prepare('UPDATE buildings SET x = ?, y = ? WHERE id = ?');

    for (const { building, reason } of buildingsToRelocate) {
        console.log(`${building.owner_name}'s house at (${building.x}, ${building.y}) - ${reason}`);

        const newLoc = findNewLocation(usedPositions);
        if (newLoc) {
            console.log(`  → Moving to (${newLoc.x}, ${newLoc.y})`);
            updateStmt.run(newLoc.x, newLoc.y, building.id);
            usedPositions.add(`${newLoc.x},${newLoc.y}`);
        } else {
            console.log(`  ✗ Could not find valid location!`);
        }
    }

    console.log('\nDone! Refresh the page to see changes.');
}

main().catch(console.error);
