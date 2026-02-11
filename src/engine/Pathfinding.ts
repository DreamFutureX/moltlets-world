// ============================================================
// Moltlets Town - A* Pathfinding on Isometric Grid
// ============================================================

import type { Position } from '@/types';

interface Node {
  x: number;
  y: number;
  g: number;  // cost from start
  h: number;  // heuristic to goal
  f: number;  // g + h
  parent: Node | null;
}

/**
 * A* pathfinding algorithm for grid-based movement.
 * Returns array of positions from start to end (exclusive of start).
 */
export function findPath(
  start: Position,
  end: Position,
  obstacles: boolean[][],
  worldWidth: number,
  worldHeight: number,
  agentPositions?: Position[], // treat other agents as soft obstacles
  maxIterations: number = 1000,
): Position[] {
  const endX = Math.round(end.x);
  const endY = Math.round(end.y);
  const startX = Math.round(start.x);
  const startY = Math.round(start.y);

  // If destination is blocked, find nearest walkable tile
  if (!isWalkable(endX, endY, obstacles, worldWidth, worldHeight)) {
    const alt = findNearestWalkable(end, obstacles, worldWidth, worldHeight);
    if (!alt) return [];
    return findPath(start, alt, obstacles, worldWidth, worldHeight, agentPositions, maxIterations);
  }

  const openSet: Node[] = [];
  const closedSet = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  // Agent position set for soft obstacle checking
  const agentPosSet = new Set<string>();
  if (agentPositions) {
    for (const ap of agentPositions) {
      const ax = Math.round(ap.x);
      const ay = Math.round(ap.y);
      if (ax !== endX || ay !== endY) { // don't block the destination
        agentPosSet.add(key(ax, ay));
      }
    }
  }

  const startNode: Node = {
    x: startX,
    y: startY,
    g: 0,
    h: heuristic(startX, startY, endX, endY),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  openSet.push(startNode);

  let bestNode = startNode; // track closest node to goal
  let iterations = 0;

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f
    let lowestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[lowestIdx].f) lowestIdx = i;
    }
    const current = openSet.splice(lowestIdx, 1)[0];

    // Reached goal
    if (current.x === endX && current.y === endY) {
      return reconstructPath(current);
    }

    // Track best candidate
    if (current.h < bestNode.h) bestNode = current;

    closedSet.add(key(current.x, current.y));

    // Check 4 cardinal neighbors
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const nb of neighbors) {
      if (closedSet.has(key(nb.x, nb.y))) continue;
      if (!isWalkable(nb.x, nb.y, obstacles, worldWidth, worldHeight)) continue;

      // Add slight cost for tiles with agents on them (soft obstacle)
      const agentCost = agentPosSet.has(key(nb.x, nb.y)) ? 5 : 0;
      const g = current.g + 1 + agentCost;
      const h = heuristic(nb.x, nb.y, endX, endY);

      // Check if this neighbor is already in open set with better g
      const existingIdx = openSet.findIndex(n => n.x === nb.x && n.y === nb.y);
      if (existingIdx >= 0 && openSet[existingIdx].g <= g) continue;

      const node: Node = { x: nb.x, y: nb.y, g, h, f: g + h, parent: current };

      if (existingIdx >= 0) {
        openSet[existingIdx] = node;
      } else {
        openSet.push(node);
      }
    }
  }

  // No perfect path found — return path to closest reachable point
  if (bestNode !== startNode) {
    return reconstructPath(bestNode);
  }
  return [];
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function isWalkable(
  x: number,
  y: number,
  obstacles: boolean[][],
  width: number,
  height: number,
): boolean {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  return !obstacles[y]?.[x];
}

function findNearestWalkable(
  pos: Position,
  obstacles: boolean[][],
  width: number,
  height: number,
): Position | null {
  const px = Math.round(pos.x);
  const py = Math.round(pos.y);

  for (let radius = 1; radius <= 5; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const nx = px + dx;
        const ny = py + dy;
        if (isWalkable(nx, ny, obstacles, width, height)) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
}

function reconstructPath(node: Node): Position[] {
  const path: Position[] = [];
  let current: Node | null = node;
  while (current?.parent) {
    path.unshift({ x: current.x, y: current.y });
    current = current.parent;
  }
  return path;
}
