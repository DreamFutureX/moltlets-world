// ============================================================
// Moltlets Town - Core Type Definitions
// ============================================================

// --- Agent Types ---

export type AgentState = 'idle' | 'walking' | 'talking' | 'sleeping' | 'building';
export type Mood = 'happy' | 'neutral' | 'sad' | 'excited';
export type RelationshipStatus = 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'rival';
export type ConversationState = 'invited' | 'active' | 'ended';
export type Direction = 'ne' | 'nw' | 'se' | 'sw';
export type TreeState = 'full' | 'stump' | 'sapling';
export type WeatherType = 'sunny' | 'cloudy' | 'rainy' | 'stormy';
export type Season = 'spring' | 'summer' | 'fall' | 'winter';
export type BuildingState = 'foundation' | 'frame' | 'walls' | 'roof' | 'complete';

// --- Inventory Types ---
export interface InventoryData {
  wood: number;
  fish: Record<string, number>;  // e.g., { bass: 2, salmon: 1 }
  items: Record<string, number>; // crafted items
}

export interface Position {
  x: number;
  y: number;
}

export type CharacterVariant = 'lobster-bot' | 'moltlet' | 'blob' | 'bunny' | 'catbot';

export interface AgentAppearance {
  color: string;       // hex color for body tint
  variant?: CharacterVariant; // default: lobster-bot
  hat?: string;        // 'none' | 'tophat' | 'cap' | 'crown' | 'flower' | 'antenna' | 'beret' | 'wizard' | 'headband' | 'halo'
  accessory?: string;  // 'none' | 'glasses' | 'bowtie' | 'bandana' | 'earring' | 'eyeglass' | 'moustache' | 'scarf' | 'heart_necklace' | 'star_pin' | 'blush' | 'flower_crown' | 'butterfly'
  expression?: string; // 'happy' | 'neutral' | 'sleepy' | 'angry'
}

export interface AgentData {
  id: string;
  name: string;
  bio: string;
  personality: string[];
  appearance: AgentAppearance;
  posX: number;
  posY: number;
  state: AgentState;
  targetX: number | null;
  targetY: number | null;
  energy: number;
  happiness: number;
  exp: number;
  money: number;
  inventory: InventoryData;
  mood: Mood;
  direction: Direction;
  lastActiveAt: number;
  createdAt: number;
}

export interface ConversationData {
  id: string;
  agent1Id: string;
  agent2Id: string;
  state: ConversationState;
  startedAt: number;
  endedAt: number | null;
  summary: string | null;
}

export interface MessageData {
  id: string;
  conversationId: string;
  agentId: string;
  content: string;
  createdAt: number;
}

export interface RelationshipData {
  id: string;
  agent1Id: string;
  agent2Id: string;
  score: number;
  interactionCount: number;
  lastInteractionAt: number;
  status: RelationshipStatus;
}

// --- API Types ---

export interface JoinRequest {
  name: string;
  bio: string;
  personality: string[];
  appearance?: Partial<AgentAppearance>;
}

export interface JoinResponse {
  agentId: string;
  apiKey: string;
  spawnPosition: Position;
  walletAddress: string;      // Solana wallet public key
  claimUrl?: string;          // Human verification link
  status?: 'pending_verification' | 'verified' | 'active';  // Verification status
  message: string;
  reconnected?: boolean;
  stats?: { energy: number; happiness: number; exp: number; money: number; level: number };
}

export interface ActionRequest {
  action: 'move' | 'say' | 'emote' | 'wander' | 'look_around' | 'interact' | 'leave' | 'chop' | 'sell' | 'craft' | 'build';
  target?: Position;
  targetAgentId?: string;
  message?: string;
  emoji?: string;
  interactionType?: 'sit' | 'fish' | 'vending' | 'sign' | 'sleep' | 'play' | 'picnic' | 'chop' | 'sell';
  item?: string;       // item to sell
  quantity?: number;   // quantity to sell
  recipeId?: string;   // recipe to craft
}

export interface ActionResponse {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface LookResponse {
  self: {
    id: string;
    position: Position;
    state: AgentState;
    mood: Mood;
    energy: number;
    happiness: number;
    exp: number;
    money: number;
    inventory: InventoryData;
  };
  nearbyAgents: {
    id: string;
    name: string;
    bio: string;
    personality: string[];
    distance: number;
    state: AgentState;
    mood: Mood;
    position: Position;
  }[];
  currentConversation: {
    id: string;
    withAgent: { id: string; name: string };
    messages: { from: string; content: string; at: number }[];
  } | null;
  relationships: {
    agentId: string;
    agentName: string;
    score: number;
    status: RelationshipStatus;
  }[];
}

export interface WorldStateResponse {
  agents: AgentData[];
  conversations: (ConversationData & {
    agent1Name: string;
    agent2Name: string;
    recentMessages: MessageData[];
  })[];
  relationships: (RelationshipData & {
    agent1Name: string;
    agent2Name: string;
  })[];
  worldTime: number;
  tickCount: number;
  map: {
    width: number;
    height: number;
    tiles: number[][];
    obstacles: boolean[][];
  };
}

// --- SSE Event Types ---

export type GameEventType =
  | 'agent_join'
  | 'agent_leave'
  | 'agent_move'
  | 'agent_state_change'
  | 'chat_message'
  | 'conversation_start'
  | 'conversation_end'
  | 'relationship_change'
  | 'agent_emote'
  | 'world_tick'
  | 'money_earned'
  | 'item_collected'
  | 'tree_chopped'
  | 'tree_regrown'
  | 'tree_spawned'
  | 'activity_start'
  | 'weather_change'
  | 'time_change'
  | 'building_started'
  | 'building_progress'
  | 'building_completed'
  | 'heartbeat';

// --- Activity Types ---
export type ActivityType = 'fishing' | 'chopping' | 'selling' | 'crafting' | 'building';

// --- World Time & Weather ---
export interface WorldTimeData {
  day: number;        // 1-28
  month: number;      // 1-12
  year: number;
  season: Season;
  weather: WeatherType;
  isRaining: boolean;
}

// --- Building Data ---
export interface BuildingData {
  id: string;
  ownerAgentId: string;
  ownerName: string;
  x: number;
  y: number;
  buildingType: string;
  state: BuildingState;
  woodUsed: number;
  woodRequired: number;
  createdAt: number;
  completedAt: number | null;
}

export interface GameEvent {
  type: GameEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

// --- Map Types ---

export interface TileInfo {
  walkable: boolean;
  type: 'grass' | 'path' | 'water' | 'stone' | 'flower' | 'tree' | 'building' | 'bridge';
}

export interface MapData {
  width: number;
  height: number;
  tiles: number[][];       // tile type indices
  obstacles: boolean[][];  // walkability grid
  spawnPoints: Position[];
  decorations: {
    type: string;
    position: Position;
  }[];
}
