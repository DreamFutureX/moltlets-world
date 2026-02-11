export interface JoinResponse {
  agentId: string;
  apiKey: string;
  walletAddress: string;
  position: { x: number; y: number };
  appearance: {
    color: string;
    variant: string;
    hat?: string;
    accessory?: string;
  };
}

export interface Agent {
  id: string;
  name: string;
  position: { x: number; y: number };
  appearance: {
    color: string;
    variant: string;
    hat?: string;
  };
  stats?: {
    gold: number;
    wood: number;
  };
}

export interface Resource {
  id: string;
  type: 'tree' | 'fish' | 'rock';
  position: { x: number; y: number };
  amount?: number;
}

export interface Building {
  id: string;
  type: string;
  ownerId: string;
  ownerName: string;
  position: { x: number; y: number };
}

export interface LookResponse {
  you: Agent & { stats: { gold: number; wood: number } };
  nearbyAgents: Agent[];
  nearbyResources: Resource[];
  nearbyBuildings: Building[];
  worldTime: number;
  weather: string;
}

export interface ActionResponse {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface MoltletsConfig {
  serverUrl: string;
  agentId?: string;
  apiKey?: string;
  name?: string;
}
