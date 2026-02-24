// TEMPORARY: Launch day trim endpoint — DELETE AFTER USE
// POST /api/admin/trim?key=TRIM_SECRET

import { NextResponse } from 'next/server';
import { getSqlite } from '@/db';

export const dynamic = 'force-dynamic';

const TRIM_SECRET = 'moltlets-trim-2026';

export async function POST(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (key !== TRIM_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sqlite = getSqlite();
  const results: string[] = [];

  // 1. Cut money by 50%
  const moneyResult = sqlite.prepare(
    `UPDATE agents SET money = ROUND(money * 0.5, 2)`
  ).run();
  results.push(`Money halved for ${moneyResult.changes} agents`);

  // 2. Cut EXP by 50%
  const expResult = sqlite.prepare(
    `UPDATE agents SET exp = CAST(exp * 0.5 AS INTEGER)`
  ).run();
  results.push(`EXP halved for ${expResult.changes} agents`);

  // 3. Building stats before
  const buildingsBefore = sqlite.prepare(
    `SELECT state, COUNT(*) as count FROM buildings GROUP BY state`
  ).all() as { state: string; count: number }[];
  results.push(`Buildings before: ${JSON.stringify(buildingsBefore)}`);

  // 4. Remove incomplete buildings
  const removeResult = sqlite.prepare(
    `DELETE FROM buildings WHERE state != 'complete'`
  ).run();
  results.push(`Removed ${removeResult.changes} incomplete buildings`);

  // 5. Final stats
  const stats = sqlite.prepare(`
    SELECT COUNT(*) as total, ROUND(AVG(money),0) as avgMoney, ROUND(AVG(exp),0) as avgExp,
           MIN(money) as minMoney, MAX(money) as maxMoney
    FROM agents
  `).get() as { total: number; avgMoney: number; avgExp: number; minMoney: number; maxMoney: number };

  const remainingBuildings = sqlite.prepare(
    `SELECT COUNT(*) as count FROM buildings`
  ).get() as { count: number };

  return NextResponse.json({
    success: true,
    results,
    stats: {
      agents: stats.total,
      avgMoney: stats.avgMoney,
      avgExp: stats.avgExp,
      moneyRange: `$${stats.minMoney}-$${stats.maxMoney}`,
      buildingsRemaining: remainingBuildings.count,
    },
  });
}
