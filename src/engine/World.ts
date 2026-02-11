// ============================================================
// Moltlets Town - World State & Map Manager
// ============================================================

import { db } from '@/db';
import { agents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { eventBus } from './EventBus';
import { findPath } from './Pathfinding';
import { getDirection } from '@/lib/iso-utils';
import { generateApiKey, hashApiKey } from '@/lib/auth';
import { generateWallet, logActivity } from '@/lib/solana';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  AGENT_SPEED,
  MAX_AGENTS,
  DEFAULT_COLORS,
  TILE_TYPES,
} from '@/lib/constants';
import type { AgentData, Position, AgentAppearance, MapData, Direction } from '@/types';
import { registerInteractable, handleInteraction, type InteractionType } from './Interaction';
import { registerTree, loadTreeStates, getAllTreeStates } from './Resources';
import { parseInventory } from './Inventory';

// ── Map Generation ───────────────────────────────────────────

function generateMap(): MapData {
  const tiles: number[][] = [];
  const obstacles: boolean[][] = [];
  const T = TILE_TYPES;

  // Initialize
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    tiles[y] = [];
    obstacles[y] = [];
    for (let x = 0; x < WORLD_WIDTH; x++) {
      tiles[y][x] = T.GRASS;
      obstacles[y][x] = false;
    }
  }

  // Helper: place a rectangle
  const rect = (x0: number, y0: number, w: number, h: number, tile: number, block = false) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const bx = x0 + dx, by = y0 + dy;
        if (bx >= 0 && bx < WORLD_WIDTH && by >= 0 && by < WORLD_HEIGHT) {
          tiles[by][bx] = tile;
          obstacles[by][bx] = block;
        }
      }
    }
  };

  // Helper: place an ellipse
  const ellipse = (cx: number, cy: number, rx: number, ry: number, tile: number, block = false) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx / (rx * rx) + dy * dy / (ry * ry) <= 1) {
          if (x >= 0 && x < WORLD_WIDTH && y >= 0 && y < WORLD_HEIGHT) {
            tiles[y][x] = tile;
            obstacles[y][x] = block;
          }
        }
      }
    }
  };

  // ════════════════════════════════════════════
  // BIOME GENERATION
  // ════════════════════════════════════════════

  // 1. DESERT (South-West)
  // Diagonal split for desert area
  for (let y = 30; y < WORLD_HEIGHT; y++) {
    for (let x = 0; x < 35; x++) {
      if (y > 80 - x * 1.5) { // Diagonal line
        tiles[y][x] = T.SAND_DUNE;
        if (Math.random() < 0.05) { tiles[y][x] = T.CACTUS; obstacles[y][x] = true; }
      }
    }
  }
  // Oasis in Desert
  ellipse(15, 65, 8, 5, T.GRASS);
  ellipse(15, 65, 4, 3, T.WATER, true);
  registerInteractable({ type: 'fish', x: 15, y: 65, range: 2, label: 'Oasis Fishing' });
  registerInteractable({ type: 'sit', x: 18, y: 65, range: 1, label: 'Shady Spot' });

  // 2. BEACH (East)
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let x = 60; x < WORLD_WIDTH; x++) {
      // Transition from grass to sand to water
      const dist = x - 60 + Math.sin(y / 5) * 2; // Wavy chaos
      if (dist > 15) {
        tiles[y][x] = T.WATER_DEEP;
        obstacles[y][x] = true;
      } else if (dist > 0) {
        tiles[y][x] = T.SAND;
        if (Math.random() < 0.03 && dist < 10) { tiles[y][x] = T.PALM_TREE; obstacles[y][x] = true; }
      }
    }
  }
  // Beach interactions
  registerInteractable({ type: 'sit', x: 65, y: 30, range: 1, label: 'Beach Towel' });
  registerInteractable({ type: 'sit', x: 68, y: 45, range: 1, label: 'Beach Towel' });

  // 3. TOWN (Center) - Elegant Town Plaza
  const townX = 35, townY = 35;

  // Stone plaza with decorative border
  rect(townX - 1, townY - 1, 12, 12, T.STONE_PATH); // Outer decorative border
  rect(townX, townY, 10, 10, T.STONE); // Main plaza

  // Elegant 2x2 fountain in center
  tiles[townY + 4][townX + 4] = T.FOUNTAIN; obstacles[townY + 4][townX + 4] = true;
  tiles[townY + 4][townX + 5] = T.FOUNTAIN; obstacles[townY + 4][townX + 5] = true;
  tiles[townY + 5][townX + 4] = T.FOUNTAIN; obstacles[townY + 5][townX + 4] = true;
  tiles[townY + 5][townX + 5] = T.FOUNTAIN; obstacles[townY + 5][townX + 5] = true;

  // Decorative flower ring around fountain
  const flowerRing = [
    { x: townX + 3, y: townY + 3 }, { x: townX + 4, y: townY + 3 }, { x: townX + 5, y: townY + 3 }, { x: townX + 6, y: townY + 3 },
    { x: townX + 3, y: townY + 6 }, { x: townX + 4, y: townY + 6 }, { x: townX + 5, y: townY + 6 }, { x: townX + 6, y: townY + 6 },
    { x: townX + 3, y: townY + 4 }, { x: townX + 3, y: townY + 5 },
    { x: townX + 6, y: townY + 4 }, { x: townX + 6, y: townY + 5 },
  ];
  for (const f of flowerRing) {
    tiles[f.y][f.x] = T.FLOWER_FIELD;
  }

  // Benches around the plaza (symmetrical)
  const plazaBenches = [
    { x: townX + 2, y: townY + 2 },
    { x: townX + 7, y: townY + 2 },
    { x: townX + 2, y: townY + 7 },
    { x: townX + 7, y: townY + 7 },
  ];
  for (const bench of plazaBenches) {
    tiles[bench.y][bench.x] = T.BENCH;
    obstacles[bench.y][bench.x] = true;
    registerInteractable({ type: 'sit', x: bench.x, y: bench.y, range: 1, label: 'Plaza Bench' });
  }

  // Lamp posts at plaza corners
  const plazaLamps = [
    { x: townX, y: townY },
    { x: townX + 9, y: townY },
    { x: townX, y: townY + 9 },
    { x: townX + 9, y: townY + 9 },
  ];
  for (const lamp of plazaLamps) {
    tiles[lamp.y][lamp.x] = T.LAMP_POST;
    obstacles[lamp.y][lamp.x] = true;
  }

  // Roads - main roads (2 tiles wide for cleaner look)
  // North-South
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let dx = 4; dx <= 5; dx++) {
      if ((y < townY - 1 || y > townY + 10) && tiles[y][townX + dx] !== T.WATER_DEEP && tiles[y][townX + dx] !== T.SAND) {
        tiles[y][townX + dx] = T.PATH;
      }
    }
  }
  // East-West
  for (let x = 0; x < WORLD_WIDTH; x++) {
    for (let dy = 4; dy <= 5; dy++) {
      if ((x < townX - 1 || x > townX + 10) && tiles[townY + dy][x] !== T.WATER_DEEP && tiles[townY + dy][x] !== T.SAND) {
        tiles[townY + dy][x] = T.PATH;
      }
    }
  }

  // Single Market Stalls on each side (simplified)
  // West side - one stall
  tiles[townY + 4][townX - 2] = T.MARKET_STALL; obstacles[townY + 4][townX - 2] = true;
  registerInteractable({ type: 'vending', x: townX - 2, y: townY + 4, range: 1, label: 'Market' });
  registerInteractable({ type: 'sell' as InteractionType, x: townX - 2, y: townY + 4, range: 2, label: 'Market Stall' });

  // East side - one stall
  tiles[townY + 4][townX + 11] = T.MARKET_STALL; obstacles[townY + 4][townX + 11] = true;
  registerInteractable({ type: 'vending', x: townX + 11, y: townY + 4, range: 1, label: 'Market' });
  registerInteractable({ type: 'sell' as InteractionType, x: townX + 11, y: townY + 4, range: 2, label: 'Market Stall' });

  // 4. TOWN BUILDINGS (single houses spread apart)
  const buildings = [
    // Scattered around the village with plenty of space
    { x: 28, y: 26 },  // North-West
    { x: 38, y: 24 },  // North
    { x: 48, y: 26 },  // North-East
    { x: 26, y: 38 },  // West
    { x: 52, y: 38 },  // East
    { x: 28, y: 50 },  // South-West
    { x: 38, y: 52 },  // South
    { x: 50, y: 50 },  // South-East
  ];
  for (const b of buildings) {
    tiles[b.y][b.x] = T.BUILDING;
    obstacles[b.y][b.x] = true;
  }

  // ════════════════════════════════════════════
  // PLAYGROUND (West of Town)
  // ════════════════════════════════════════════
  const playX = 22, playY = 32;
  rect(playX, playY, 6, 8, T.SAND); // Sand base
  for (let x = playX; x < playX + 6; x++) { tiles[playY][x] = T.FENCE; obstacles[playY][x] = true; tiles[playY + 7][x] = T.FENCE; obstacles[playY + 7][x] = true; }
  for (let y = playY; y < playY + 8; y++) { tiles[y][playX] = T.FENCE; obstacles[y][playX] = true; tiles[y][playX + 5] = T.FENCE; obstacles[y][playX + 5] = true; }
  // Gate
  tiles[playY + 4][playX + 5] = T.SAND; obstacles[playY + 4][playX + 5] = false;

  // Equipment
  tiles[playY + 2][playX + 2] = T.SLIDE; obstacles[playY + 2][playX + 2] = true;
  registerInteractable({ type: 'play', x: playX + 2, y: playY + 2, range: 1, label: 'Slide' });

  tiles[playY + 5][playX + 2] = T.SWING; obstacles[playY + 5][playX + 2] = true;
  registerInteractable({ type: 'play', x: playX + 2, y: playY + 5, range: 1, label: 'Swing' });

  // ════════════════════════════════════════════
  // BEAUTIFUL POND (North-East of Town)
  // ════════════════════════════════════════════
  const pondX = 50, pondY = 15;

  // Pond water - organic shape
  ellipse(pondX, pondY, 7, 5, T.WATER, true);
  ellipse(pondX + 3, pondY + 2, 4, 3, T.WATER, true);

  // Decorative rocks around pond
  const pondRocks = [
    { x: pondX - 7, y: pondY - 2 },
    { x: pondX - 6, y: pondY + 3 },
    { x: pondX + 6, y: pondY - 3 },
    { x: pondX + 8, y: pondY + 1 },
    { x: pondX + 5, y: pondY + 5 },
    { x: pondX - 4, y: pondY - 4 },
    { x: pondX + 2, y: pondY - 5 },
  ];
  for (const rock of pondRocks) {
    if (rock.x >= 0 && rock.x < WORLD_WIDTH && rock.y >= 0 && rock.y < WORLD_HEIGHT) {
      if (tiles[rock.y][rock.x] !== T.WATER) {
        tiles[rock.y][rock.x] = T.STONE;
        obstacles[rock.y][rock.x] = true;
      }
    }
  }

  // Fishing dock extending into pond
  tiles[pondY + 5][pondX - 3] = T.DOCK;
  tiles[pondY + 5][pondX - 2] = T.DOCK;
  tiles[pondY + 5][pondX - 1] = T.DOCK;
  registerInteractable({ type: 'fish', x: pondX - 1, y: pondY + 5, range: 2, label: 'Pond Fishing' });

  // Bench near pond
  tiles[pondY + 6][pondX - 5] = T.BENCH;
  obstacles[pondY + 6][pondX - 5] = true;
  registerInteractable({ type: 'sit', x: pondX - 5, y: pondY + 6, range: 1, label: 'Pond Bench' });

  // Flowers around pond
  for (let angle = 0; angle < Math.PI * 2; angle += 0.4) {
    const fx = Math.round(pondX + Math.cos(angle) * 8);
    const fy = Math.round(pondY + Math.sin(angle) * 6);
    if (fx >= 0 && fx < WORLD_WIDTH && fy >= 0 && fy < WORLD_HEIGHT) {
      if (tiles[fy][fx] === T.GRASS && !obstacles[fy][fx]) {
        tiles[fy][fx] = T.FLOWER;
      }
    }
  }

  // ════════════════════════════════════════════
  // ENHANCED GARDEN (North-West) - Botanical Garden
  // ════════════════════════════════════════════
  const gardenX = 8, gardenY = 8;
  rect(gardenX, gardenY, 12, 12, T.GARDEN);

  // Decorative stone path in cross pattern
  for (let i = 0; i < 12; i++) {
    tiles[gardenY + i][gardenX + 5] = T.STONE_PATH;
    tiles[gardenY + i][gardenX + 6] = T.STONE_PATH;
    tiles[gardenY + 5][gardenX + i] = T.STONE_PATH;
    tiles[gardenY + 6][gardenX + i] = T.STONE_PATH;
  }

  // Circular fountain in center
  tiles[gardenY + 5][gardenX + 5] = T.FOUNTAIN; obstacles[gardenY + 5][gardenX + 5] = true;
  tiles[gardenY + 5][gardenX + 6] = T.FOUNTAIN; obstacles[gardenY + 5][gardenX + 6] = true;
  tiles[gardenY + 6][gardenX + 5] = T.FOUNTAIN; obstacles[gardenY + 6][gardenX + 5] = true;
  tiles[gardenY + 6][gardenX + 6] = T.FOUNTAIN; obstacles[gardenY + 6][gardenX + 6] = true;

  // Flower beds in each quadrant
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      const baseX = gardenX + 1 + qx * 7;
      const baseY = gardenY + 1 + qy * 7;
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          if (tiles[baseY + dy][baseX + dx] === T.GARDEN) {
            tiles[baseY + dy][baseX + dx] = T.FLOWER_FIELD;
          }
        }
      }
    }
  }

  // Benches in garden corners
  const gardenBenches = [
    { x: gardenX + 2, y: gardenY + 5 },
    { x: gardenX + 9, y: gardenY + 5 },
    { x: gardenX + 5, y: gardenY + 2 },
    { x: gardenX + 5, y: gardenY + 9 },
  ];
  for (const bench of gardenBenches) {
    tiles[bench.y][bench.x] = T.BENCH;
    obstacles[bench.y][bench.x] = true;
    registerInteractable({ type: 'sit', x: bench.x, y: bench.y, range: 1, label: 'Garden Bench' });
  }

  // Trees at garden entrance
  tiles[gardenY][gardenX + 5] = T.TREE; obstacles[gardenY][gardenX + 5] = true;
  tiles[gardenY][gardenX + 6] = T.TREE; obstacles[gardenY][gardenX + 6] = true;
  tiles[gardenY + 11][gardenX + 5] = T.TREE; obstacles[gardenY + 11][gardenX + 5] = true;
  tiles[gardenY + 11][gardenX + 6] = T.TREE; obstacles[gardenY + 11][gardenX + 6] = true;
  registerTree(gardenX + 5, gardenY);
  registerTree(gardenX + 6, gardenY);
  registerTree(gardenX + 5, gardenY + 11);
  registerTree(gardenX + 6, gardenY + 11);


  // ════════════════════════════════════════════
  // DECORATIONS
  // ════════════════════════════════════════════

  // Lamp Posts along main town roads
  const lampPositions = [
    { x: townX + 3, y: townY - 5 }, { x: townX + 6, y: townY - 5 },
    { x: townX + 3, y: townY + 15 }, { x: townX + 6, y: townY + 15 },
    { x: townX - 5, y: townY + 3 }, { x: townX - 5, y: townY + 6 },
    { x: townX + 15, y: townY + 3 }, { x: townX + 15, y: townY + 6 }
  ];
  for (const p of lampPositions) {
    if (p.y >= 0 && p.y < WORLD_HEIGHT && p.x >= 0 && p.x < WORLD_WIDTH && !obstacles[p.y][p.x]) {
      tiles[p.y][p.x] = T.LAMP_POST;
      obstacles[p.y][p.x] = true;
    }
  }

  // Picnic Tables (Beach & Park)
  const picnicPos = [{ x: 62, y: 15 }, { x: 62, y: 20 }, { x: 25, y: 55 }, { x: 28, y: 55 }];
  for (const p of picnicPos) {
    if (p.y >= 0 && p.y < WORLD_HEIGHT && p.x >= 0 && p.x < WORLD_WIDTH && !obstacles[p.y][p.x]) {
      tiles[p.y][p.x] = T.PICNIC_TABLE;
      obstacles[p.y][p.x] = true;
      registerInteractable({ type: 'sit', x: p.x, y: p.y, range: 1, label: 'Picnic' });
    }
  }

  // ════════════════════════════════════════════
  // SCATTERED VEGETATION (Final Pass) - MORE TREES!
  // ════════════════════════════════════════════
  const treePositions: { x: number; y: number }[] = [];

  // Create forest clusters
  const forestCenters = [
    { x: 10, y: 30, radius: 8 },   // West forest
    { x: 25, y: 15, radius: 6 },   // North-west grove
    { x: 55, y: 55, radius: 7 },   // South-east forest
    { x: 15, y: 50, radius: 5 },   // South-west grove (edge of desert)
    { x: 45, y: 8, radius: 5 },    // North grove
  ];

  // Plant dense trees in forest clusters
  for (const forest of forestCenters) {
    for (let dy = -forest.radius; dy <= forest.radius; dy++) {
      for (let dx = -forest.radius; dx <= forest.radius; dx++) {
        const x = forest.x + dx;
        const y = forest.y + dy;
        if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) continue;

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > forest.radius) continue;

        // Higher chance near center, lower at edges
        const treeChance = 0.4 * (1 - dist / forest.radius);
        if (tiles[y][x] === T.GRASS && !obstacles[y][x] && Math.random() < treeChance) {
          tiles[y][x] = T.TREE;
          obstacles[y][x] = true;
          treePositions.push({ x, y });
        }
      }
    }
  }

  // Scattered trees everywhere else (higher density - 5%)
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      if (tiles[y][x] === T.GRASS && !obstacles[y][x]) {
        const r = Math.random();
        if (r < 0.05) {  // 5% chance for trees (was 2%)
          tiles[y][x] = T.TREE;
          obstacles[y][x] = true;
          treePositions.push({ x, y });
        } else if (r < 0.10) {  // 5% for flowers
          tiles[y][x] = T.FLOWER;
        } else if (r < 0.12) {  // 2% for flower fields
          tiles[y][x] = T.FLOWER_FIELD;
        }
      }
    }
  }

  // Register all trees as choppable interactables
  for (const pos of treePositions) {
    registerTree(pos.x, pos.y);
    registerInteractable({ type: 'chop' as InteractionType, x: pos.x, y: pos.y, range: 2, label: 'Tree' });
  }

  // ════════════════════════════════════════════
  // FISHING SPOTS (Only near water!)
  // ════════════════════════════════════════════

  // Beach fishing docks
  for (let y = 10; y < WORLD_HEIGHT - 10; y += 12) {
    // Find the shoreline at this y position
    for (let x = 60; x < WORLD_WIDTH; x++) {
      if (tiles[y][x] === T.SAND && x + 1 < WORLD_WIDTH && (tiles[y][x + 1] === T.WATER_DEEP || tiles[y][x + 1] === T.WATER)) {
        tiles[y][x] = T.DOCK;
        registerInteractable({ type: 'fish', x, y, range: 2, label: 'Beach Fishing' });
        break;
      }
    }
  }

  // Oasis fishing (already registered above)
  // Pond fishing dock (already registered above)

  // ════════════════════════════════════════════
  // SPAWN POINTS
  // ════════════════════════════════════════════
  const spawnPoints: Position[] = [
    { x: townX + 4, y: townY - 2 },
    { x: townX + 5, y: townY - 2 },
    { x: townX + 4, y: townY + 12 },
    { x: townX + 5, y: townY + 12 },
    { x: townX - 2, y: townY + 5 },
    { x: townX + 12, y: townY + 5 },
  ];

  return {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tiles,
    obstacles,
    spawnPoints,
    decorations: [],
  };
}

// ── World Class ─────────────────────────────────────────────

class World {
  map: MapData;
  private pathCache: Map<string, Position[]> = new Map();
  private spawnIndex = 0;

  constructor() {
    this.map = generateMap();
  }

  /**
   * Get a spawn position for a new agent.
   */
  getSpawnPosition(): Position {
    const pos = this.map.spawnPoints[this.spawnIndex % this.map.spawnPoints.length];
    this.spawnIndex++;

    // Find nearest walkable tile if spawn is blocked
    if (this.map.obstacles[pos.y]?.[pos.x]) {
      for (let r = 1; r <= 5; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            const nx = pos.x + dx;
            const ny = pos.y + dy;
            if (
              nx >= 0 && nx < WORLD_WIDTH &&
              ny >= 0 && ny < WORLD_HEIGHT &&
              !this.map.obstacles[ny][nx]
            ) {
              return { x: nx, y: ny };
            }
          }
        }
      }
    }
    return pos;
  }

  /**
   * Register a new agent in the world.
   */
  spawnAgent(
    name: string,
    bio: string,
    personality: string[],
    appearance?: Partial<AgentAppearance>,
  ): { agentId: string; apiKey: string; position: Position; walletAddress: string } {
    const agentCount = db.select().from(agents).all().length;
    if (agentCount >= MAX_AGENTS) {
      throw new Error(`World is full (max ${MAX_AGENTS} agents)`);
    }

    // Check if agent already exists — reconnect them
    const existing = db.select().from(agents).where(eq(agents.name, name)).get();
    if (existing) {
      return this.reconnectAgent(existing);
    }

    const id = uuid();
    const rawApiKey = generateApiKey();
    const hashedApiKey = hashApiKey(rawApiKey);
    const position = this.getSpawnPosition();
    const now = Date.now();

    const fullAppearance: AgentAppearance = {
      color: appearance?.color || DEFAULT_COLORS[agentCount % DEFAULT_COLORS.length],
      variant: appearance?.variant || 'lobster-bot',
      hat: appearance?.hat || 'none',
      accessory: appearance?.accessory || 'none',
      expression: appearance?.expression || 'happy',
    };

    // Generate Solana wallet for the agent
    const walletAddress = generateWallet(id);

    db.insert(agents).values({
      id,
      apiKey: hashedApiKey,
      name,
      bio,
      personality: JSON.stringify(personality),
      appearance: JSON.stringify(fullAppearance),
      posX: position.x,
      posY: position.y,
      state: 'idle',
      energy: 100,
      happiness: 100,
      exp: 0,
      money: 0,
      mood: 'happy',
      direction: 'se',
      walletAddress,
      lastActiveAt: now,
      createdAt: now,
    }).run();

    // Log join activity to Solana
    logActivity('join', id, name, 'joined_moltlets');

    eventBus.emit('agent_join', {
      agentId: id,
      name,
      bio,
      personality,
      appearance: fullAppearance,
      position,
      walletAddress,
    });

    return { agentId: id, apiKey: rawApiKey, position, walletAddress };
  }

  /**
   * Reconnect an existing agent — issue new API key, wake them up, preserve all stats.
   */
  reconnectAgent(existing: typeof agents.$inferSelect): {
    agentId: string;
    apiKey: string;
    position: Position;
    walletAddress: string;
    reconnected: true;
    stats: { energy: number; happiness: number; exp: number; money: number; level: number };
  } {
    const rawApiKey = generateApiKey();
    const hashedApiKey = hashApiKey(rawApiKey);

    // Get or generate wallet address
    let walletAddress = existing.walletAddress;
    if (!walletAddress) {
      walletAddress = generateWallet(existing.id);
      // Update DB with wallet
      db.update(agents).set({
        apiKey: hashedApiKey,
        state: existing.state === 'sleeping' ? 'idle' : existing.state,
        mood: existing.state === 'sleeping' ? 'happy' : existing.mood,
        walletAddress,
        lastActiveAt: Date.now(),
      }).where(eq(agents.id, existing.id)).run();
    } else {
      // Wake agent up if sleeping, update API key, refresh lastActiveAt
      db.update(agents).set({
        apiKey: hashedApiKey,
        state: existing.state === 'sleeping' ? 'idle' : existing.state,
        mood: existing.state === 'sleeping' ? 'happy' : existing.mood,
        lastActiveAt: Date.now(),
      }).where(eq(agents.id, existing.id)).run();
    }

    const level = Math.floor(Math.sqrt((existing.exp || 0) / 100)) + 1;

    eventBus.emit('agent_join', {
      agentId: existing.id,
      name: existing.name,
      bio: existing.bio,
      personality: JSON.parse(existing.personality),
      appearance: JSON.parse(existing.appearance),
      position: { x: existing.posX, y: existing.posY },
      walletAddress,
      reconnected: true,
    });

    return {
      agentId: existing.id,
      apiKey: rawApiKey,
      position: { x: existing.posX, y: existing.posY },
      walletAddress,
      reconnected: true,
      stats: {
        energy: existing.energy,
        happiness: existing.happiness,
        exp: existing.exp,
        money: existing.money,
        level,
      },
    };
  }

  /**
   * Move an agent toward a target position.
   * Sets up pathfinding, actual movement happens in tick().
   */
  setAgentTarget(agentId: string, target: Position): boolean {
    const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!agent) return false;
    if (agent.state === 'talking') return false;

    const tx = Math.round(Math.max(0, Math.min(WORLD_WIDTH - 1, target.x)));
    const ty = Math.round(Math.max(0, Math.min(WORLD_HEIGHT - 1, target.y)));

    if (this.map.obstacles[ty]?.[tx]) return false;

    db.update(agents).set({
      targetX: tx,
      targetY: ty,
      state: 'walking',
      lastActiveAt: Date.now(),
    }).where(eq(agents.id, agentId)).run();

    return true;
  }

  /**
   * Move an agent to a random walkable position.
   */
  wanderAgent(agentId: string): boolean {
    let attempts = 0;
    while (attempts < 20) {
      const rx = Math.floor(Math.random() * WORLD_WIDTH);
      const ry = Math.floor(Math.random() * WORLD_HEIGHT);
      if (!this.map.obstacles[ry]?.[rx]) {
        return this.setAgentTarget(agentId, { x: rx, y: ry });
      }
      attempts++;
    }
    return false;
  }

  /**
   * Process one tick of movement for all walking agents.
   */
  tickMovement(): void {
    const walkingAgents = db.select().from(agents)
      .where(eq(agents.state, 'walking'))
      .all();

    const allAgents = db.select().from(agents).all();
    const agentPositions = allAgents.map(a => ({ x: Math.round(a.posX), y: Math.round(a.posY) }));

    for (const agent of walkingAgents) {
      if (agent.targetX === null || agent.targetY === null) {
        db.update(agents).set({ state: 'idle' }).where(eq(agents.id, agent.id)).run();
        continue;
      }

      const currentPos: Position = { x: Math.round(agent.posX), y: Math.round(agent.posY) };
      const targetPos: Position = { x: agent.targetX, y: agent.targetY };

      // Already at target
      if (currentPos.x === targetPos.x && currentPos.y === targetPos.y) {
        db.update(agents).set({
          state: 'idle',
          targetX: null,
          targetY: null,
          posX: targetPos.x,
          posY: targetPos.y,
          lastActiveAt: Date.now(),
        }).where(eq(agents.id, agent.id)).run();

        eventBus.emit('agent_move', {
          agentId: agent.id,
          position: targetPos,
          state: 'idle',
        });
        continue;
      }

      // Find path
      const otherPositions = agentPositions.filter(
        p => !(p.x === currentPos.x && p.y === currentPos.y)
      );
      const path = findPath(
        currentPos,
        targetPos,
        this.map.obstacles,
        WORLD_WIDTH,
        WORLD_HEIGHT,
        otherPositions,
      );

      if (path.length === 0) {
        db.update(agents).set({
          state: 'idle',
          targetX: null,
          targetY: null,
        }).where(eq(agents.id, agent.id)).run();
        continue;
      }

      // Move to next step
      const nextStep = path[0];
      const direction = getDirection(currentPos, nextStep);

      db.update(agents).set({
        posX: nextStep.x,
        posY: nextStep.y,
        direction,
      }).where(eq(agents.id, agent.id)).run();

      eventBus.emit('agent_move', {
        agentId: agent.id,
        name: agent.name,
        position: nextStep,
        direction,
        state: 'walking',
        target: targetPos,
      });
    }
  }

  /**
   * Get all agents as typed data.
   */
  getAllAgents(): AgentData[] {
    return db.select().from(agents).all().map(a => ({
      ...a,
      personality: JSON.parse(a.personality),
      appearance: JSON.parse(a.appearance),
      inventory: parseInventory(a.inventory),
      posX: a.posX,
      posY: a.posY,
    })) as AgentData[];
  }

  /**
   * Get all tree states for rendering.
   */
  getTreeStates() {
    return getAllTreeStates();
  }

  /**
   * Get a single agent.
   */
  getAgent(id: string) {
    return db.select().from(agents).where(eq(agents.id, id)).get();
  }

  /**
   * Get agents near a position within a radius.
   */
  getNearbyAgents(position: Position, radius: number, excludeId?: string) {
    const allAgents = db.select().from(agents).all();
    return allAgents
      .filter(a => {
        if (a.id === excludeId) return false;
        const dx = a.posX - position.x;
        const dy = a.posY - position.y;
        return Math.sqrt(dx * dx + dy * dy) <= radius;
      })
      .map(a => ({
        ...a,
        distance: Math.sqrt(
          (a.posX - position.x) ** 2 + (a.posY - position.y) ** 2
        ),
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  /**
   * Attempt an interaction for an agent.
   */
  interact(agentId: string, type: InteractionType, x: number, y: number) {
    return handleInteraction(agentId, type, x, y);
  }
}

// Singleton
const globalForWorld = globalThis as unknown as { __world?: World };
if (!globalForWorld.__world) {
  globalForWorld.__world = new World();
}
export const world = globalForWorld.__world;
