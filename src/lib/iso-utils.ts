// ============================================================
// Moltlets Town - Isometric Math Utilities
// ============================================================

import { TILE_HALF_W, TILE_HALF_H } from './constants';
import type { Position } from '@/types';

/**
 * Convert grid (tile) coordinates to isometric screen coordinates.
 * Origin is top-center of the map.
 */
export function gridToScreen(gridX: number, gridY: number): Position {
  return {
    x: (gridX - gridY) * TILE_HALF_W,
    y: (gridX + gridY) * TILE_HALF_H,
  };
}

/**
 * Convert screen coordinates back to grid (tile) coordinates.
 */
export function screenToGrid(screenX: number, screenY: number): Position {
  const gridX = (screenX / TILE_HALF_W + screenY / TILE_HALF_H) / 2;
  const gridY = (screenY / TILE_HALF_H - screenX / TILE_HALF_W) / 2;
  return { x: Math.round(gridX), y: Math.round(gridY) };
}

/**
 * Manhattan distance between two grid positions (good for isometric A*).
 */
export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Euclidean distance between two positions.
 */
export function euclideanDistance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Determine facing direction based on movement delta.
 */
export function getDirection(from: Position, to: Position): 'ne' | 'nw' | 'se' | 'sw' {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx >= 0 && dy < 0) return 'ne';
  if (dx < 0 && dy < 0) return 'nw';
  if (dx >= 0 && dy >= 0) return 'se';
  return 'sw';
}

/**
 * Clamp grid position to world bounds.
 */
export function clampToWorld(pos: Position, worldWidth: number, worldHeight: number): Position {
  return {
    x: Math.max(0, Math.min(worldWidth - 1, Math.round(pos.x))),
    y: Math.max(0, Math.min(worldHeight - 1, Math.round(pos.y))),
  };
}

/**
 * Linearly interpolate between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/**
 * Get the isometric depth sorting value for a position.
 * Higher values = rendered later (on top).
 */
export function getDepth(gridX: number, gridY: number): number {
  return gridX + gridY;
}

/**
 * Get neighbor positions (4 cardinal directions in grid space).
 */
export function getNeighbors(pos: Position): Position[] {
  return [
    { x: pos.x + 1, y: pos.y },     // east
    { x: pos.x - 1, y: pos.y },     // west
    { x: pos.x, y: pos.y + 1 },     // south
    { x: pos.x, y: pos.y - 1 },     // north
  ];
}
