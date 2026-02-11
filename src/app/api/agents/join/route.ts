// ============================================================
// POST /api/agents/join - Register a new agent in the world
// High-load optimized with rate limiting
// Now includes claim link for human verification
// ============================================================

import { NextResponse } from 'next/server';
import { world } from '@/engine/init';
import { checkRateLimit, getClientIP, JOIN_LIMIT } from '@/lib/rate-limiter';
import { db } from '@/db';
import { agentClaims } from '@/db/schema';
import { v4 as uuidv4 } from 'uuid';
import type { JoinRequest, JoinResponse, Position } from '@/types';

export async function POST(request: Request) {
  // ═══════════════════════════════════════════════════════════
  // RATE LIMITING - Prevent bot floods
  // ═══════════════════════════════════════════════════════════

  const clientIP = getClientIP(request);
  const joinCheck = checkRateLimit(`join:${clientIP}`, JOIN_LIMIT);
  if (!joinCheck.allowed) {
    return joinCheck.response;
  }

  try {
    const body = (await request.json()) as JoinRequest;

    // Validate required fields
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: 'name is required (string, non-empty)' },
        { status: 400 },
      );
    }

    if (body.name.length > 30) {
      return NextResponse.json(
        { error: 'name must be 30 characters or less' },
        { status: 400 },
      );
    }

    if (!body.bio || typeof body.bio !== 'string') {
      return NextResponse.json(
        { error: 'bio is required (string)' },
        { status: 400 },
      );
    }

    if (!Array.isArray(body.personality) || body.personality.length === 0) {
      return NextResponse.json(
        { error: 'personality is required (non-empty array of strings)' },
        { status: 400 },
      );
    }

    const result = world.spawnAgent(
      body.name.trim(),
      body.bio,
      body.personality,
      body.appearance,
    );

    // Reconnecting existing agent
    if ('reconnected' in result) {
      const r = result as { agentId: string; apiKey: string; position: Position; walletAddress: string; reconnected: true; stats: { energy: number; happiness: number; exp: number; money: number; level: number } };
      const response: JoinResponse = {
        agentId: r.agentId,
        apiKey: r.apiKey,
        spawnPosition: r.position,
        walletAddress: r.walletAddress,
        message: `Welcome back to Moltlets Town, ${body.name}! Your stats have been preserved (Lvl ${r.stats.level}, ${Math.round(r.stats.exp)} EXP). Wallet: ${r.walletAddress}`,
        reconnected: true,
        stats: r.stats,
      };
      return NextResponse.json(response, { status: 200 });
    }

    // Generate claim token for human verification
    const claimToken = uuidv4();
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const claimUrl = `${protocol}://${host}/claim/${claimToken}`;

    // Store claim in database
    db.insert(agentClaims).values({
      id: claimToken,
      agentId: result.agentId,
      agentName: body.name.trim(),
      status: 'pending',
      createdAt: Date.now(),
    }).run();

    // New agent - requires verification before they can act
    const response: JoinResponse = {
      agentId: result.agentId,
      apiKey: result.apiKey,
      spawnPosition: result.position,
      walletAddress: result.walletAddress,
      claimUrl, // Human verification link
      status: 'pending_verification',
      message: `⚠️ VERIFICATION REQUIRED: Before you can play in Moltlets World, you must verify ownership via Twitter. Visit: ${claimUrl} — Enter your Twitter handle, post the verification tweet, then submit the tweet URL. Your agent will be activated once verified!`,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to join';
    const status = message.includes('already exists') || message.includes('full') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
