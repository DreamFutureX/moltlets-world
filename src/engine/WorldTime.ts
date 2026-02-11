// ============================================================
// Moltlets Town - World Time & Weather System
// ============================================================

import { db } from '@/db';
import { worldMeta, treeStates } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { eventBus } from './EventBus';
import {
    GAME_TIME_SCALE,
    DAYS_PER_MONTH,
    MONTHS_PER_YEAR,
    SEASON_FOR_MONTH,
    WEATHER_TYPES,
    WEATHER_DURATION_MIN_MS,
    WEATHER_DURATION_MAX_MS,
    RAIN_CHANCE_BY_SEASON,
    STORM_CHANCE_WHEN_RAINY,
    TREE_SPAWN_INTERVAL_MS,
    TREE_SPAWN_CHANCE_BASE,
    TREE_MAX_POPULATION,
    RAIN_TREE_SPAWN_MULTIPLIER,
    TILE_TYPES,
    WOOD_PER_TREE_MIN,
    WOOD_PER_TREE_MAX,
} from '@/lib/constants';
import type { WeatherType, Season, WorldTimeData } from '@/types';

// In-memory state
let currentDay = 1;
let currentMonth = 1;
let currentYear = 1;
let currentWeather: WeatherType = 'sunny';
let weatherChangesAt = 0;
let gameStartedAt = Date.now();

// Reference to world map for tree spawning
let worldMapRef: { tiles: number[][]; obstacles: boolean[][] } | null = null;

// Tree cache reference for spawning
let treeCacheRef: Map<string, { state: string; regrowsAt: number | null }> | null = null;

export function setWorldMapRef(map: { tiles: number[][]; obstacles: boolean[][] }): void {
    worldMapRef = map;
}

export function setTreeCacheRef(cache: Map<string, { state: string; regrowsAt: number | null }>): void {
    treeCacheRef = cache;
}

// Initialize world time from DB or create new
export function initWorldTime(): void {
    try {
        const existing = db.select().from(worldMeta).where(eq(worldMeta.id, 'main')).get();

        if (existing) {
            currentDay = existing.currentDay;
            currentMonth = existing.currentMonth;
            currentYear = existing.currentYear;
            currentWeather = existing.weather as WeatherType;
            weatherChangesAt = existing.weatherChangesAt ?? Date.now() + randomWeatherDuration();
            gameStartedAt = existing.gameStartedAt;
            console.log(`[WorldTime] Loaded: Year ${currentYear}, Month ${currentMonth}, Day ${currentDay}, Weather: ${currentWeather}`);
        } else {
            // First time - create world meta
            const now = Date.now();
            gameStartedAt = now;
            weatherChangesAt = now + randomWeatherDuration();

            try {
                db.insert(worldMeta).values({
                    id: 'main',
                    gameStartedAt: now,
                    currentDay: 1,
                    currentMonth: 1,
                    currentYear: 1,
                    weather: 'sunny',
                    weatherChangesAt,
                }).run();
                console.log('[WorldTime] Initialized new world time');
            } catch (insertErr) {
                console.error('[WorldTime] Failed to insert world meta:', insertErr);
            }
        }
    } catch (err) {
        console.error('[WorldTime] Error initializing world time:', err);
        // Use defaults if DB fails
        const now = Date.now();
        gameStartedAt = now;
        weatherChangesAt = now + randomWeatherDuration();
    }

}

// Get current season from month
export function getSeason(): Season {
    return SEASON_FOR_MONTH[(currentMonth - 1) % 12] as Season;
}

// Get full time data
export function getWorldTime(): WorldTimeData {
    return {
        day: currentDay,
        month: currentMonth,
        year: currentYear,
        season: getSeason(),
        weather: currentWeather,
        isRaining: currentWeather === 'rainy' || currentWeather === 'stormy',
    };
}

// Check if currently raining
export function isRaining(): boolean {
    return currentWeather === 'rainy' || currentWeather === 'stormy';
}

// Random weather duration
function randomWeatherDuration(): number {
    return WEATHER_DURATION_MIN_MS + Math.random() * (WEATHER_DURATION_MAX_MS - WEATHER_DURATION_MIN_MS);
}

// Pick new weather based on season
function pickNewWeather(): WeatherType {
    const season = getSeason();
    const rainChance = RAIN_CHANCE_BY_SEASON[season];

    if (Math.random() < rainChance) {
        // Will rain - check if storm
        if (Math.random() < STORM_CHANCE_WHEN_RAINY) {
            return 'stormy';
        }
        return 'rainy';
    }

    // Not raining - sunny or cloudy
    return Math.random() < 0.6 ? 'sunny' : 'cloudy';
}

// Update weather (called from tick)
export function tickWeather(): void {
    const now = Date.now();

    if (now >= weatherChangesAt) {
        const oldWeather = currentWeather;
        currentWeather = pickNewWeather();
        weatherChangesAt = now + randomWeatherDuration();

        // Save to DB
        db.update(worldMeta)
            .set({
                weather: currentWeather,
                weatherChangesAt,
            })
            .where(eq(worldMeta.id, 'main'))
            .run();

        // Emit event
        eventBus.emit('weather_change', {
            oldWeather,
            newWeather: currentWeather,
            season: getSeason(),
        });

        console.log(`[WorldTime] Weather changed: ${oldWeather} → ${currentWeather}`);
    }
}

// Update time (called from tick)
export function tickTime(): void {
    const now = Date.now();

    // Calculate total days elapsed since game started
    // 1 real minute = 1 game day (with GAME_TIME_SCALE = 60)
    const gameSecondsPerRealSecond = GAME_TIME_SCALE;
    const gameSecondsPerDay = 24 * 60; // 1440 game seconds per day
    const realMsPerDay = (gameSecondsPerDay / gameSecondsPerRealSecond) * 1000; // 24000ms = 24 real seconds = 1 game day

    const totalElapsed = now - gameStartedAt;
    const totalDays = Math.floor(totalElapsed / realMsPerDay);

    // Calculate what year/month/day we should be at
    const targetYear = Math.floor(totalDays / (DAYS_PER_MONTH * MONTHS_PER_YEAR)) + 1;
    const daysIntoYear = totalDays % (DAYS_PER_MONTH * MONTHS_PER_YEAR);
    const targetMonth = Math.floor(daysIntoYear / DAYS_PER_MONTH) + 1;
    const targetDay = (daysIntoYear % DAYS_PER_MONTH) + 1;

    // Only update if changed
    if (targetDay !== currentDay || targetMonth !== currentMonth || targetYear !== currentYear) {
        currentDay = targetDay;
        currentMonth = targetMonth;
        currentYear = targetYear;

        // Save to DB
        db.update(worldMeta)
            .set({
                currentDay,
                currentMonth,
                currentYear,
            })
            .where(eq(worldMeta.id, 'main'))
            .run();

        // Emit event
        eventBus.emit('time_change', {
            day: currentDay,
            month: currentMonth,
            year: currentYear,
            season: getSeason(),
        });

        console.log(`[WorldTime] Time updated: Year ${currentYear}, Month ${currentMonth}, Day ${currentDay}`);
    }
}


// Tree auto-generation (called from game loop)
export function tickTreeSpawning(): void {
    if (!worldMapRef || !treeCacheRef) return;

    const tiles = worldMapRef.tiles;
    const obstacles = worldMapRef.obstacles;

    // Count current trees
    let treeCount = 0;
    for (const [, data] of treeCacheRef.entries()) {
        if (data.state === 'full' || data.state === 'sapling') {
            treeCount++;
        }
    }

    // Don't spawn if at max
    if (treeCount >= TREE_MAX_POPULATION) return;

    // Calculate spawn chance (boosted during rain)
    let spawnChance = TREE_SPAWN_CHANCE_BASE;
    if (isRaining()) {
        spawnChance *= RAIN_TREE_SPAWN_MULTIPLIER;
    }

    // Scan grass tiles and randomly spawn trees
    let spawned = 0;
    const maxSpawnPerTick = 5; // Limit spawns per tick

    for (let x = 0; x < tiles.length && spawned < maxSpawnPerTick; x++) {
        for (let y = 0; y < tiles[0].length && spawned < maxSpawnPerTick; y++) {
            const tile = tiles[x][y];

            // Only spawn on grass
            if (tile !== TILE_TYPES.GRASS) continue;

            // Skip if already has tree or obstacle
            const key = `${x}_${y}`;
            if (treeCacheRef.has(key)) continue;
            if (obstacles[x]?.[y]) continue;

            // Random chance to spawn
            if (Math.random() < spawnChance) {
                spawnTree(x, y);
                spawned++;
            }
        }
    }
}

function spawnTree(x: number, y: number): void {
    if (!worldMapRef || !treeCacheRef) return;

    const key = `${x}_${y}`;

    // Add to tree cache
    treeCacheRef.set(key, { state: 'sapling', regrowsAt: Date.now() + 2 * 60 * 1000 }); // Sapling for 2 min

    // Add to DB
    db.insert(treeStates).values({
        id: key,
        x,
        y,
        state: 'sapling',
        resourceCount: Math.floor(Math.random() * (WOOD_PER_TREE_MAX - WOOD_PER_TREE_MIN + 1)) + WOOD_PER_TREE_MIN,
        regrowsAt: Date.now() + 2 * 60 * 1000,
    }).onConflictDoNothing().run();

    // Update map tile
    worldMapRef.tiles[x][y] = TILE_TYPES.TREE;
    worldMapRef.obstacles[x][y] = true;

    // Emit event
    eventBus.emit('tree_spawned', { x, y });

    console.log(`[WorldTime] New tree spawned at (${x}, ${y})`);
}
