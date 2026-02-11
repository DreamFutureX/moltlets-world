// ============================================================
// GET /api/health - Simple health check for Railway
// ============================================================

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      status: 'healthy',
      timestamp: Date.now(),
      uptime: process.uptime(),
    });
  } catch (err) {
    console.error('[Health] Error:', err);
    return NextResponse.json({
      status: 'unhealthy',
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: Date.now(),
    }, { status: 500 });
  }
}
