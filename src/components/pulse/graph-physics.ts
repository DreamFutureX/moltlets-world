// ============================================================
// Force-directed graph physics for relationship visualization
// Pure functions — no React, no DOM, no side effects
// ============================================================

export interface GraphNode {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  level: number;
  money: number;
  state: string;
  flashUntil: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  score: number;        // -100 to +100
  status: string;       // rival | stranger | acquaintance | friend | close_friend
  interactionCount: number;
  pulseT: number;       // 0-1 for animation
}

// ── Initialize nodes in a circle ────────────────────────────

export function initializeNodes(
  agents: { id: string; name: string; color: string; exp: number; money: number; state: string }[],
  w: number,
  h: number,
): GraphNode[] {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.35;

  return agents.map((a, i) => {
    const angle = (i / agents.length) * Math.PI * 2;
    const level = Math.floor(Math.sqrt((a.exp || 0) / 100)) + 1;
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
      y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
      radius: Math.max(6, Math.min(18, 6 + level * 1.5)),
      level,
      money: a.money,
      state: a.state || 'idle',
      flashUntil: 0,
    };
  });
}

// ── Build ALL edges (no filtering — visual layer decides what to show) ──

export function buildEdges(
  relationships: { agent1Id: string; agent2Id: string; score: number; status: string; interactionCount: number }[],
): GraphEdge[] {
  return relationships
    .filter(r => Math.abs(r.score) >= 3)
    .map(r => ({
      source: r.agent1Id,
      target: r.agent2Id,
      score: r.score,
      status: r.status,
      interactionCount: r.interactionCount,
      pulseT: Math.random(),
    }));
}

// ── Get top N edges for a specific node ──────────────────────

export function getEdgesForNode(edges: GraphEdge[], nodeId: string, max: number = 10): GraphEdge[] {
  return edges
    .filter(e => e.source === nodeId || e.target === nodeId)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, max);
}

// ── Pick a random edge for scanning beam animation ───────────

export function pickRandomEdge(edges: GraphEdge[]): GraphEdge | null {
  if (edges.length === 0) return null;
  // Prefer stronger relationships for visual interest
  const strong = edges.filter(e => Math.abs(e.score) >= 30);
  const pool = strong.length > 20 ? strong : edges;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Step the physics simulation ─────────────────────────────

const REPULSION = 800;
const ATTRACTION = 0.008;
const CENTERING = 0.0005;
const DAMPING = 0.92;
const CUTOFF = 400;
const IDEAL_LENGTH = 120;
const BOUNDARY_MARGIN = 40;
const BOUNDARY_FORCE = 0.5;

export function stepSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  w: number,
  h: number,
  dt: number,
): void {
  const n = nodes.length;
  const cx = w / 2;
  const cy = h / 2;

  const nodeIdx = new Map<string, number>();
  for (let i = 0; i < n; i++) nodeIdx.set(nodes[i].id, i);

  // 1. Repulsion between all node pairs
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq) || 1;

      if (dist > CUTOFF) continue;

      const force = REPULSION / distSq;
      const fx = (dx / dist) * force * dt;
      const fy = (dy / dist) * force * dt;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // 2. Attraction along edges
  for (const edge of edges) {
    const si = nodeIdx.get(edge.source);
    const ti = nodeIdx.get(edge.target);
    if (si === undefined || ti === undefined) continue;

    const a = nodes[si];
    const b = nodes[ti];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    const strengthMult = Math.abs(edge.score) / 50;
    const ideal = IDEAL_LENGTH / Math.max(0.5, strengthMult);
    const force = ATTRACTION * (dist - ideal) * dt;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // 3. Centering + damping + boundary + update positions
  for (const node of nodes) {
    node.vx += (cx - node.x) * CENTERING * dt;
    node.vy += (cy - node.y) * CENTERING * dt;

    if (node.x < BOUNDARY_MARGIN) node.vx += BOUNDARY_FORCE * dt;
    if (node.x > w - BOUNDARY_MARGIN) node.vx -= BOUNDARY_FORCE * dt;
    if (node.y < BOUNDARY_MARGIN) node.vy += BOUNDARY_FORCE * dt;
    if (node.y > h - BOUNDARY_MARGIN) node.vy -= BOUNDARY_FORCE * dt;

    node.vx *= DAMPING;
    node.vy *= DAMPING;

    node.x += node.vx * dt;
    node.y += node.vy * dt;

    node.x = Math.max(node.radius, Math.min(w - node.radius, node.x));
    node.y = Math.max(node.radius, Math.min(h - node.radius, node.y));
  }
}

// ── Gentle drift after settled ──────────────────────────────

export function applyDrift(nodes: GraphNode[], time: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const seed = i * 1.7;
    nodes[i].x += Math.sin(time * 0.0008 + seed) * 0.15;
    nodes[i].y += Math.cos(time * 0.0006 + seed * 1.3) * 0.12;
  }
}

// ── Advance edge pulse animations ───────────────────────────

export function advancePulses(edges: GraphEdge[], dt: number): void {
  for (const edge of edges) {
    if (edge.status === 'close_friend' || edge.status === 'friend') {
      edge.pulseT += 0.003 * dt;
      if (edge.pulseT > 1) edge.pulseT -= 1;
    }
  }
}

// ── Hit testing ─────────────────────────────────────────────

export function findNodeAtPoint(
  nodes: GraphNode[],
  x: number,
  y: number,
  scale: number = 1,
  offsetX: number = 0,
  offsetY: number = 0,
): GraphNode | null {
  const gx = (x - offsetX) / scale;
  const gy = (y - offsetY) / scale;

  let closest: GraphNode | null = null;
  let closestDist = Infinity;

  for (const node of nodes) {
    const dx = node.x - gx;
    const dy = node.y - gy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hitRadius = Math.max(node.radius + 6, 14);
    if (dist < hitRadius && dist < closestDist) {
      closest = node;
      closestDist = dist;
    }
  }

  return closest;
}

// ── Check if simulation has settled ─────────────────────────

export function isSettled(nodes: GraphNode[]): boolean {
  let totalV = 0;
  for (const n of nodes) {
    totalV += Math.abs(n.vx) + Math.abs(n.vy);
  }
  return totalV / nodes.length < 0.05;
}
