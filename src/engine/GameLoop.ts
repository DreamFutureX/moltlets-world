// ============================================================
// Moltlets Town - Main Game Loop (Server-Side)
// Optimized for high-load (500+ agents)
// ============================================================

import { world } from './World';
import { tickConversations } from './Conversation';
import { decayRelationships } from './Relationship';
import { eventBus } from './EventBus';
import { spawnNpcs, tickNpcBehavior, cleanupNpcConvos } from './NpcBrain';
import { tickTreeRegrowth, loadTreeStates, getTreeCache, setIsRainingFn } from './Resources';
import { initWorldTime, tickWeather, tickTime, tickTreeSpawning, setWorldMapRef, setTreeCacheRef, getWorldTime, isRaining } from './WorldTime';
import { loadBuildings, getAllBuildings, setWorldMapRefForBuildings } from './Buildings';
import { generateDiaries } from './Diary';
import { initSolana } from '@/lib/solana';
import { db, batchUpdate, runCheckpoint, cleanupOldEvents, safeDbOperation } from '@/db';
import { agents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  TICK_RATE_MS,
  WANDER_INTERVAL_MS,
  ENERGY_DECAY_PER_MINUTE,
  LOW_ENERGY_THRESHOLD,
  AGENT_INACTIVE_TIMEOUT_MS,
  EXP_PER_MESSAGE,
  EXP_PER_SLEEP_TICK,
  HAPPINESS_IDLE_DECAY,
  HAPPINESS_TALK_BONUS,
  getExpMultiplier,
  TREE_SPAWN_INTERVAL_MS,
  MAX_ENERGY,
} from '@/lib/constants';

class GameLoop {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private wanderInterval: ReturnType<typeof setInterval> | null = null;
  private npcInterval: ReturnType<typeof setInterval> | null = null;
  private decayInterval: ReturnType<typeof setInterval> | null = null;
  private resourceInterval: ReturnType<typeof setInterval> | null = null;
  private weatherInterval: ReturnType<typeof setInterval> | null = null;
  private treeSpawnInterval: ReturnType<typeof setInterval> | null = null;
  private maintenanceInterval: ReturnType<typeof setInterval> | null = null;
  private diaryInterval: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private running = false;
  private lastTickTime = 0;
  private tickOverruns = 0;

  get isRunning(): boolean {
    return this.running;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get stats(): { ticks: number; overruns: number; avgTickTime: number } {
    return {
      ticks: this.tickCount,
      overruns: this.tickOverruns,
      avgTickTime: this.lastTickTime,
    };
  }

  /**
   * Start the game loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    console.log('[GameLoop] Starting game loop...');

    // Set references for world systems FIRST (before loading data that needs them)
    setWorldMapRef(world.map);
    setTreeCacheRef(getTreeCache());
    setWorldMapRefForBuildings(world.map);
    setIsRainingFn(isRaining);

    // Load tree states from DB
    loadTreeStates();

    // Initialize world time and weather
    initWorldTime();

    // Load buildings (must be AFTER setWorldMapRefForBuildings to mark tiles correctly)
    loadBuildings();

    // Spawn NPC agents
    spawnNpcs();

    // Initialize Solana on-chain logging
    initSolana();

    // Main tick: movement + conversation updates
    this.tickInterval = setInterval(() => {
      this.tick();
    }, TICK_RATE_MS);

    // Wander tick: idle agents pick random destinations
    this.wanderInterval = setInterval(() => {
      this.wanderTick();
    }, WANDER_INTERVAL_MS);

    // NPC behavior tick: autonomous activities every 3 seconds
    this.npcInterval = setInterval(() => {
      try {
        tickNpcBehavior();
      } catch (err) {
        console.error('[GameLoop] NPC tick error:', err);
      }
    }, 3000);

    // NPC conversation cleanup every 30 seconds
    setInterval(() => {
      try { cleanupNpcConvos(); } catch {}
    }, 30000);

    // Relationship decay: once per hour
    this.decayInterval = setInterval(() => {
      decayRelationships();
    }, 60 * 60 * 1000);

    // Resource regrowth: every 30 seconds
    this.resourceInterval = setInterval(() => {
      try {
        tickTreeRegrowth();
      } catch (err) {
        console.error('[GameLoop] Resource tick error:', err);
      }
    }, 30000);

    // Weather and time: every 10 seconds
    this.weatherInterval = setInterval(() => {
      try {
        tickWeather();
        tickTime();
      } catch (err) {
        console.error('[GameLoop] Weather/time tick error:', err);
      }
    }, 10000);

    // Tree spawning: every 60 seconds
    this.treeSpawnInterval = setInterval(() => {
      try {
        tickTreeSpawning();
      } catch (err) {
        console.error('[GameLoop] Tree spawn tick error:', err);
      }
    }, TREE_SPAWN_INTERVAL_MS);

    // Database maintenance: every 5 minutes
    this.maintenanceInterval = setInterval(() => {
      try {
        // Checkpoint WAL to prevent unbounded growth
        runCheckpoint();
        // Clean up old events (keep 24 hours)
        const deleted = cleanupOldEvents(24 * 60 * 60 * 1000);
        if (deleted > 0) {
          console.log(`[GameLoop] Cleaned up ${deleted} old events`);
        }
      } catch (err) {
        console.error('[GameLoop] Maintenance error:', err);
      }
    }, 5 * 60 * 1000);

    // Diary generation: every 4 hours (also run once at startup for missed periods)
    this.diaryInterval = setInterval(() => {
      try {
        generateDiaries();
      } catch (err) {
        console.error('[GameLoop] Diary generation error:', err);
      }
    }, 4 * 60 * 60 * 1000);

    // Generate any missed diaries on startup (delayed 30s to let things settle)
    setTimeout(() => {
      try { generateDiaries(); } catch {}
    }, 30000);

    console.log('[GameLoop] All systems initialized');
  }

  /**
   * Stop the game loop.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.wanderInterval) clearInterval(this.wanderInterval);
    if (this.npcInterval) clearInterval(this.npcInterval);
    if (this.decayInterval) clearInterval(this.decayInterval);
    if (this.resourceInterval) clearInterval(this.resourceInterval);
    if (this.weatherInterval) clearInterval(this.weatherInterval);
    if (this.treeSpawnInterval) clearInterval(this.treeSpawnInterval);
    if (this.maintenanceInterval) clearInterval(this.maintenanceInterval);
    if (this.diaryInterval) clearInterval(this.diaryInterval);

    this.tickInterval = null;
    this.wanderInterval = null;
    this.npcInterval = null;
    this.decayInterval = null;
    this.resourceInterval = null;
    this.weatherInterval = null;
    this.treeSpawnInterval = null;
    this.maintenanceInterval = null;
    this.diaryInterval = null;

    // Final checkpoint before shutdown
    try {
      runCheckpoint();
    } catch {}

    console.log('[GameLoop] Stopped.');
  }

  /**
   * Main tick function - called every TICK_RATE_MS.
   */
  private tick(): void {
    const tickStart = Date.now();
    this.tickCount++;

    try {
      // 1. Process movement
      world.tickMovement();

      // 2. Process conversations (timeouts, etc.)
      tickConversations();

      // 3. Update stats: energy, happiness, exp (every ~30 ticks = 6 seconds)
      if (this.tickCount % 30 === 0) {
        this.updateStats();
      }

      // 4. Broadcast world tick event (every 5 ticks = 1 second)
      if (this.tickCount % 5 === 0) {
        const allAgents = world.getAllAgents();
        const worldTime = getWorldTime();
        eventBus.emit('world_tick', {
          tickCount: this.tickCount,
          agentCount: allAgents.length,
          spectators: eventBus.connectionCount,
          timestamp: Date.now(),
          time: worldTime,
        });
      }

      // Track tick timing
      this.lastTickTime = Date.now() - tickStart;
      if (this.lastTickTime > TICK_RATE_MS) {
        this.tickOverruns++;
        if (this.tickOverruns % 10 === 0) {
          console.warn(`[GameLoop] Tick overrun: ${this.lastTickTime}ms (${this.tickOverruns} total overruns)`);
        }
      }
    } catch (err) {
      console.error('[GameLoop] Tick error:', err);
    }
  }

  /**
   * Wander tick - idle agents pick random destinations.
   */
  private wanderTick(): void {
    try {
      const idleAgents = db.select().from(agents)
        .where(eq(agents.state, 'idle'))
        .all();

      const now = Date.now();
      for (const agent of idleAgents) {
        // Skip agents with low energy (they rest)
        if (agent.energy < LOW_ENERGY_THRESHOLD) continue;

        // Don't wander if agent was recently active (API-driven in last 20s)
        if (now - agent.lastActiveAt < 20000) continue;

        // 50% chance to wander each interval
        if (Math.random() < 0.5) {
          world.wanderAgent(agent.id);
        }
      }
    } catch (err) {
      console.error('[GameLoop] Wander tick error:', err);
    }
  }

  /**
   * Update agent stats: energy, happiness, exp.
   * Uses batched updates for better performance with many agents.
   */
  private updateStats(): void {
    const allAgents = safeDbOperation(() => db.select().from(agents).all(), []);
    if (allAgents.length === 0) return;

    const now = Date.now();
    const updates: (() => void)[] = [];
    const stateChangeEvents: Array<{
      agentId: string;
      name: string;
      oldState: string;
      newState: string;
      energy: number;
      happiness: number;
      exp: number;
      mood: string;
    }> = [];

    for (const agent of allAgents) {
      let newEnergy = agent.energy;
      let newHappiness = agent.happiness;
      let newExp = agent.exp;
      let newState = agent.state;
      let newMood = agent.mood;
      const mult = getExpMultiplier(newHappiness);

      // --- Energy ---
      // Walking and talking drain energy
      if (agent.state === 'walking' || agent.state === 'talking') {
        newEnergy = Math.max(0, newEnergy - ENERGY_DECAY_PER_MINUTE);
      }
      // Idle agents recover faster, sleeping recovers even faster
      if (agent.state === 'idle') {
        newEnergy = Math.min(MAX_ENERGY, newEnergy + 2);
      }
      if (agent.state === 'sleeping') {
        newEnergy = Math.min(MAX_ENERGY, newEnergy + 3);
      }

      // --- EXP ---
      // Talking earns EXP (per stat tick while talking)
      if (agent.state === 'talking') {
        newExp = Math.floor(newExp + EXP_PER_MESSAGE * mult);
      }
      // Sleeping earns a little EXP (rest & reflect)
      if (agent.state === 'sleeping') {
        newExp = Math.floor(newExp + EXP_PER_SLEEP_TICK * mult);
      }

      // --- Happiness ---
      // Talking gives happiness
      if (agent.state === 'talking') {
        newHappiness = Math.min(100, newHappiness + HAPPINESS_TALK_BONUS);
      }
      // Idle and alone → happiness slowly decays
      if (agent.state === 'idle') {
        newHappiness = Math.max(0, newHappiness - HAPPINESS_IDLE_DECAY);
      }
      // Sleeping slowly restores a bit of happiness
      if (agent.state === 'sleeping') {
        newHappiness = Math.min(100, newHappiness + 0.1);
      }

      // --- State transitions ---
      // Only sleep at VERY low energy (allows agents to stay active longer)
      if (newEnergy <= 2 && agent.state !== 'sleeping' && agent.state !== 'talking') {
        newState = 'sleeping';
      }
      // Wake up earlier (at 20 energy instead of 50)
      if (agent.state === 'sleeping' && newEnergy >= 20) {
        newState = 'idle';
      }
      // Inactive timeout - only sleep after much longer inactivity (5 mins)
      if (now - agent.lastActiveAt > AGENT_INACTIVE_TIMEOUT_MS * 3 && agent.state === 'idle') {
        newState = 'sleeping';
      }

      // --- Mood derived from happiness ---
      if (newHappiness > 70) newMood = 'happy';
      else if (newHappiness > 40) newMood = 'neutral';
      else if (newHappiness > 15) newMood = 'sad';
      else newMood = 'sad';

      const changed = newEnergy !== agent.energy || newState !== agent.state
        || newMood !== agent.mood || newHappiness !== agent.happiness || newExp !== agent.exp;

      if (changed) {
        // Queue the update for batch processing
        const finalEnergy = newEnergy;
        const finalHappiness = newHappiness;
        const finalExp = newExp;
        const finalState = newState;
        const finalMood = newMood;
        const agentId = agent.id;

        updates.push(() => {
          db.update(agents).set({
            energy: finalEnergy,
            happiness: finalHappiness,
            exp: finalExp,
            state: finalState,
            mood: finalMood,
          }).where(eq(agents.id, agentId)).run();
        });

        if (newState !== agent.state) {
          stateChangeEvents.push({
            agentId: agent.id,
            name: agent.name,
            oldState: agent.state,
            newState,
            energy: newEnergy,
            happiness: newHappiness,
            exp: newExp,
            mood: newMood,
          });
        }
      }
    }

    // Execute all updates in a single transaction
    if (updates.length > 0) {
      batchUpdate(updates);
    }

    // Emit state change events (outside transaction)
    for (const event of stateChangeEvents) {
      eventBus.emit('agent_state_change', event);
    }
  }
}

// Singleton
const globalForLoop = globalThis as unknown as { __gameLoop?: GameLoop };
if (!globalForLoop.__gameLoop) {
  globalForLoop.__gameLoop = new GameLoop();
}
export const gameLoop = globalForLoop.__gameLoop;
