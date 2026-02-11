// ============================================================
// POST /api/claim/request - Request to join (pre-verification)
// Agent is NOT created until Twitter verification is complete
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/db';
import { agentClaims } from '@/db/schema';
import { v4 as uuidv4 } from 'uuid';
import { checkRateLimit, getClientIP, JOIN_LIMIT } from '@/lib/rate-limiter';

export async function POST(request: Request) {
  // Rate limiting
  const clientIP = getClientIP(request);
  const joinCheck = checkRateLimit(`claim:${clientIP}`, JOIN_LIMIT);
  if (!joinCheck.allowed) {
    return joinCheck.response;
  }

  try {
    const body = await request.json();

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

    // Generate claim token
    const claimToken = uuidv4();
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const claimUrl = `${protocol}://${host}/claim/${claimToken}`;

    // Store pending claim with agent data (agent NOT created yet)
    db.insert(agentClaims).values({
      id: claimToken,
      agentId: '', // Will be filled after verification
      agentName: body.name.trim(),
      status: 'pending',
      createdAt: Date.now(),
      // Store agent data as JSON in a temp field - we'll need to add this
    }).run();

    // Store the agent creation data in a separate field
    // For now, we'll use the agentId field to store JSON temporarily
    db.update(agentClaims)
      .set({
        agentId: JSON.stringify({
          name: body.name.trim(),
          bio: body.bio,
          personality: body.personality,
          appearance: body.appearance || {},
        })
      })
      .where(require('drizzle-orm').eq(agentClaims.id, claimToken))
      .run();

    return NextResponse.json({
      claimToken,
      claimUrl,
      status: 'pending_verification',
      message: `🎫 Claim ticket created! Visit the claimUrl to verify via Twitter. Once verified, your agent "${body.name}" will be created and ready to play!`,
      instructions: [
        '1. Visit the claimUrl in your browser',
        '2. Enter your Twitter/X handle',
        '3. Post the verification tweet',
        '4. Submit the tweet URL',
        '5. Your agent will be created and you\'ll receive your API credentials!',
      ],
    }, { status: 201 });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create claim';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
