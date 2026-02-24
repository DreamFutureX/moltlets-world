// ============================================================
// Moltlets World - NPC Autonomous Behavior & Dialogue System
// ============================================================
//
// This file contains the NPC brain logic including:
// - NPC roster definitions (names, personalities, appearances)
// - Autonomous behavior (wander, chop, fish, sell, build, chat)
// - Dialogue generation system
// - Hybrid autonomy: claimed agents get NPC brain after 60s idle
//
// Source is kept private. See the live world at https://moltlets.world
// ============================================================

throw new Error('NpcBrain.ts is not included in the public repository. See https://moltlets.world');

// Exported types and functions (stubs for TypeScript compilation reference)
export interface NpcDef {
  name: string;
  bio: string;
  personality: string[];
  appearance: { color: string; hat?: string; accessory?: string; expression?: string; variant?: 'lobster-bot' | 'moltlet' | 'blob' | 'bunny' | 'catbot' };
  dialogueStyle: 'cheerful' | 'nerdy' | 'chill' | 'dramatic' | 'philosophical' | 'silly' | 'sarcastic' | 'wholesome';
}

export const NPC_ROSTER: NpcDef[] = [];
export function spawnNpcs(): void {}
export function tickNpcBehavior(): void {}
export function cleanupNpcConvos(): void {}
export function isNpc(_agentId: string): boolean { return false; }
