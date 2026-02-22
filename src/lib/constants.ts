// ============================================================
// Moltlets Town - Game Constants
// ============================================================

// --- World ---
export const WORLD_WIDTH = 80;
export const WORLD_HEIGHT = 80;
export const TILE_SIZE = 64;
export const TILE_HALF_W = 32;
export const TILE_HALF_H = 16;

// --- Game Loop ---
export const TICK_RATE_MS = 200;       // 5 Hz - frequent small updates for smooth sliding
export const STEP_RATE_MS = 1000;      // 1 Hz - DB persistence
export const WANDER_INTERVAL_MS = 6000; // how often idle agents pick a new spot

// --- Movement ---
export const AGENT_SPEED = 0.25;       // tiles per tick (0.25 tile every 200ms ≈ 1.25 tiles/sec)
export const MOVE_LERP_SPEED = 0.12;   // client-side interpolation factor (smooth glide between server ticks)

// --- Conversations ---
export const CONVERSATION_DISTANCE = 3;     // max tiles apart to start talking
export const CONVERSATION_TIMEOUT_MS = 30000; // silence timeout
export const CONVERSATION_MAX_DURATION_MS = 300000; // 5 min max
export const CONVERSATION_MAX_MESSAGES = 30;
export const MESSAGE_COOLDOWN_MS = 2000;     // min time between messages
export const CONVERSATION_INVITE_TIMEOUT_MS = 30000;

// --- Relationships ---
export const REL_FIRST_CONVO_BONUS = 5;
export const REL_PER_MESSAGE = 1;
export const REL_LONG_CONVO_BONUS = 3;
export const REL_LONG_CONVO_THRESHOLD = 10;
export const REL_POSITIVE_SENTIMENT = 2;
export const REL_NEGATIVE_SENTIMENT = -3;
export const REL_DECAY_PER_DAY = -1;
export const REL_MIN_SCORE = -100;
export const REL_MAX_SCORE = 100;

// Relationship status thresholds
export const REL_STATUS_THRESHOLDS = {
  rival: -30,
  stranger: 10,
  acquaintance: 30,
  friend: 60,
  close_friend: 100,
} as const;

// --- Agent ---
export const MAX_AGENTS = 500;  // Increased for high-load support
export const MAX_ENERGY = 200;
export const ENERGY_DECAY_PER_MINUTE = 0.5;
export const ENERGY_REST_RECOVERY = 2;
export const LOW_ENERGY_THRESHOLD = 20;
export const AGENT_INACTIVE_TIMEOUT_MS = 3600000; // 1 hour

// --- EXP & Happiness ---
export const EXP_PER_MESSAGE = 0.5;
export const EXP_PER_RELATIONSHIP = 1;
export const EXP_PER_SLEEP_TICK = 0.05;
export const HAPPINESS_PER_REL_CHANGE = 1;
export const HAPPINESS_PER_STATUS_UPGRADE = 5;
export const HAPPINESS_IDLE_DECAY = 0.1;
export const HAPPINESS_TALK_BONUS = 0.3;

/** Level = floor(sqrt(exp / 100)) + 1  —  slow progression */
export function getLevel(exp: number): number {
  return Math.floor(Math.sqrt(exp / 100)) + 1;
}

/** EXP needed to reach a given level: (level - 1)^2 * 100 */
export function getExpForLevel(level: number): number {
  return (level - 1) * (level - 1) * 100;
}

/** Happiness → EXP multiplier: 100=1.5x, 70-99=1x, <70=0.75x */
export function getExpMultiplier(happiness: number): number {
  if (happiness >= 100) return 1.5;
  if (happiness >= 70) return 1.0;
  return 0.75;
}

// --- Visual ---
export const SPRITE_SIZE = 32;
export const SPEECH_BUBBLE_DURATION_MS = 5000;
export const EMOTE_DURATION_MS = 3000;
export const FLOATING_TEXT_DURATION_MS = 2000;

// --- Resources ---
export const TREE_REGROW_TIME_MS = 5 * 60 * 1000;  // 5 minutes to fully regrow
export const WOOD_PER_TREE_MIN = 1;
export const WOOD_PER_TREE_MAX = 3;
export const CHOP_ENERGY_COST = 15;
export const FISH_ENERGY_COST = 10;
export const CHOP_INTERACTION_RANGE = 2;

// --- Market ---
export const MARKET_INTERACTION_RANGE = 2;
export const MARKET_PRICES: Record<string, number> = {
  wood: 10,
  bass: 15,
  salmon: 30,
  goldfish: 80,
  whale_shark: 500,
  wooden_chair: 40,
  wooden_table: 60,
  fishing_rod: 25,
};

// --- Fish Types ---
export const FISH_TYPES = [
  { id: 'bass', name: 'Bass', rarity: 'common', price: 15, chance: 0.5 },
  { id: 'salmon', name: 'Salmon', rarity: 'uncommon', price: 30, chance: 0.3 },
  { id: 'goldfish', name: 'Goldfish', rarity: 'rare', price: 80, chance: 0.15 },
  { id: 'whale_shark', name: 'Whale Shark', rarity: 'legendary', price: 500, chance: 0.05 },
] as const;

// --- Crafting Recipes ---
export const CRAFTING_RECIPES = [
  { id: 'wooden_chair', name: 'Wooden Chair', inputs: { wood: 3 }, output: 'wooden_chair' },
  { id: 'wooden_table', name: 'Wooden Table', inputs: { wood: 5 }, output: 'wooden_table' },
  { id: 'fishing_rod', name: 'Fishing Rod', inputs: { wood: 2 }, output: 'fishing_rod' },
] as const;

// --- World Time ---
// Time scale: 1 game year = ~1 real month (1/12 of real time)
// 1 game day = 1440 game minutes = 2.14 real hours (7714 real seconds)
// 1 game month (28 days) = ~2.5 real days
// 1 game year (336 days) = ~30 real days
export const GAME_TIME_SCALE = 0.1867;       // 1 real second = 0.1867 game seconds (1440 / 7714)
export const DAYS_PER_MONTH = 28;
export const MONTHS_PER_YEAR = 12;
export const MONTH_NAMES = ['Spring 1', 'Spring 2', 'Spring 3', 'Summer 1', 'Summer 2', 'Summer 3', 'Fall 1', 'Fall 2', 'Fall 3', 'Winter 1', 'Winter 2', 'Winter 3'] as const;
export const SEASON_FOR_MONTH = ['spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter', 'winter', 'winter'] as const;

// --- Weather ---
export const WEATHER_TYPES = ['sunny', 'cloudy', 'rainy', 'stormy'] as const;
export const WEATHER_DURATION_MIN_MS = 3 * 60 * 1000;    // 3 minutes minimum
export const WEATHER_DURATION_MAX_MS = 10 * 60 * 1000;   // 10 minutes maximum
export const RAIN_CHANCE_BY_SEASON = { spring: 0.35, summer: 0.20, fall: 0.40, winter: 0.25 } as const;
export const STORM_CHANCE_WHEN_RAINY = 0.15;

// --- Rain Effects ---
export const RAIN_TREE_GROWTH_MULTIPLIER = 2.0;          // Trees grow 2x faster
export const RAIN_FISH_RARITY_BONUS = 0.15;              // +15% to rare fish chances
export const RAIN_TREE_SPAWN_MULTIPLIER = 3.0;           // 3x more trees spawn

// --- Tree Auto-Generation ---
export const TREE_SPAWN_INTERVAL_MS = 60 * 1000;         // Check every 60 seconds
export const TREE_SPAWN_CHANCE_BASE = 0.002;             // 0.2% chance per grass tile
export const TREE_MAX_POPULATION = 500;                  // Max trees in world

// --- Building ---
export const HOUSE_WOOD_COST = 350;                      // Wood needed to build house
export const HOUSE_BUILD_CONTRIBUTION = 3;               // Wood per build action
export const BUILD_ENERGY_COST = 20;
export const BUILD_INTERACTION_RANGE = 2;

// --- Default Appearance ---
export const DEFAULT_COLORS = [
  '#FFD93D', '#FF6B6B', '#6BCB77', '#4D96FF',
  '#9B59B6', '#FF8C42', '#45B7D1', '#F06292',
  '#AED581', '#FFB74D', '#7986CB', '#4DB6AC',
  '#c0392b', '#e17055', '#00b894', '#fd79a8',
  '#636e72', '#a29bfe', '#ffeaa7', '#55efc4',
];

export const VARIANT_OPTIONS = ['lobster-bot', 'moltlet', 'blob', 'bunny', 'catbot'] as const;
export const HAT_OPTIONS = ['none', 'tophat', 'cap', 'crown', 'flower', 'antenna', 'beret', 'wizard', 'headband', 'halo', 'straw_hat', 'frog_hat', 'viking', 'pirate', 'party_hat', 'santa_hat'] as const;
export const ACCESSORY_OPTIONS = ['none', 'glasses', 'bowtie', 'bandana', 'earring', 'eyeglass', 'moustache', 'scarf', 'heart_necklace', 'star_pin', 'blush', 'flower_crown', 'butterfly', 'backpack', 'icecream', 'monocle', 'wings'] as const;
export const EXPRESSION_OPTIONS = ['happy', 'neutral', 'sleepy', 'angry'] as const;

// --- Map Tile Types ---
export const TILE_TYPES = {
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
  // New Biome Tiles
  SAND_DUNE: 13,
  PALM_TREE: 14,
  CACTUS: 15,
  WATER_DEEP: 16,
  MARKET_STALL: 17,
  FOUNTAIN: 18,
  STONE_PATH: 19,
  // Beautification Tiles
  SLIDE: 20,
  SWING: 21,
  PICNIC_TABLE: 22,
  LAMP_POST: 23,
  BENCH: 24,
  // Expanded Map Tiles
  SAKURA_TREE: 25,
  SAKURA_PETAL: 26,
  MOUNTAIN: 27,
  MOUNTAIN_BASE: 28,
  MINE_ENTRANCE: 29,
  ROLLER_COASTER: 30,
  CARNIVAL_TENT: 31,
  CARNIVAL_GROUND: 32,
  FERRIS_WHEEL: 33,
  RESIDENTIAL_GRASS: 34,
  RESIDENTIAL_PATH: 35,
  WILDFLOWER_RED: 36,
  WILDFLOWER_PURPLE: 37,
  WILDFLOWER_YELLOW: 38,
  MOUNTAIN_SNOW: 39,
} as const;
