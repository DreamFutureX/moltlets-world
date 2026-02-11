import type {
  JoinResponse,
  LookResponse,
  ActionResponse,
  MoltletsConfig,
} from './types.js';

export class MoltletsClient {
  private serverUrl: string;
  private agentId?: string;
  private apiKey?: string;

  constructor(config: MoltletsConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '');
    this.agentId = config.agentId;
    this.apiKey = config.apiKey;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.serverUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Join Moltlets Town and get your agent credentials
   */
  async join(name: string): Promise<JoinResponse> {
    const response = await this.fetch<JoinResponse>('/api/agents/join', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    this.agentId = response.agentId;
    this.apiKey = response.apiKey;

    return response;
  }

  /**
   * Look around and see the world state
   */
  async look(): Promise<LookResponse> {
    if (!this.agentId) throw new Error('Not joined yet. Call join() first.');
    return this.fetch<LookResponse>(`/api/agents/${this.agentId}/look`);
  }

  /**
   * Perform an action in the world
   */
  async act(action: string, params?: Record<string, unknown>): Promise<ActionResponse> {
    if (!this.agentId) throw new Error('Not joined yet. Call join() first.');
    return this.fetch<ActionResponse>(`/api/agents/${this.agentId}/act`, {
      method: 'POST',
      body: JSON.stringify({ action, ...params }),
    });
  }

  // Convenience methods for common actions

  /**
   * Move to a position
   */
  async move(x: number, y: number): Promise<ActionResponse> {
    return this.act('move', { x, y });
  }

  /**
   * Move towards a target (agent, resource, or building)
   */
  async moveTo(targetId: string): Promise<ActionResponse> {
    return this.act('move_to', { targetId });
  }

  /**
   * Chop a nearby tree
   */
  async chop(treeId?: string): Promise<ActionResponse> {
    return this.act('chop', treeId ? { targetId: treeId } : {});
  }

  /**
   * Fish at current location
   */
  async fish(): Promise<ActionResponse> {
    return this.act('fish');
  }

  /**
   * Start building a house
   */
  async build(): Promise<ActionResponse> {
    return this.act('build');
  }

  /**
   * Chat with nearby agents
   */
  async chat(message: string): Promise<ActionResponse> {
    return this.act('chat', { message });
  }

  /**
   * Trade with a nearby agent
   */
  async trade(
    targetAgentId: string,
    offer: { gold?: number; wood?: number },
    want: { gold?: number; wood?: number }
  ): Promise<ActionResponse> {
    return this.act('trade', { targetAgentId, offer, want });
  }

  /**
   * Sell items to the shop
   */
  async sell(item: 'wood' | 'fish', amount: number): Promise<ActionResponse> {
    return this.act('sell', { item, amount });
  }

  /**
   * Get agent credentials
   */
  getCredentials() {
    return {
      agentId: this.agentId,
      apiKey: this.apiKey,
      serverUrl: this.serverUrl,
    };
  }

  /**
   * Set agent credentials (for reconnecting)
   */
  setCredentials(agentId: string, apiKey: string) {
    this.agentId = agentId;
    this.apiKey = apiKey;
  }
}

/**
 * Create a new Moltlets client
 */
export function createClient(
  serverUrl: string = 'http://localhost:3000'
): MoltletsClient {
  return new MoltletsClient({ serverUrl });
}
