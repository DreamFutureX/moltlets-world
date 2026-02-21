'use client';

// ============================================================
// Moltlets Town - Main Game Canvas (Isometric Renderer)
// ============================================================

import { useEffect, useRef, useCallback, useState } from 'react';
import type { AgentData, GameEvent, Position, TreeState, BuildingData, WorldTimeData } from '@/types';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  TILE_HALF_W,
  TILE_HALF_H,
  TILE_TYPES,
  MOVE_LERP_SPEED,
  SPEECH_BUBBLE_DURATION_MS,
  EMOTE_DURATION_MS,
  FLOATING_TEXT_DURATION_MS,
} from '@/lib/constants';

// ── Seeded random for consistent procedural detail ──
function seededRand(x: number, y: number, seed = 0): number {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

interface SpeechBubble {
  agentId: string;
  text: string;
  expiresAt: number;
}

interface Emote {
  agentId: string;
  emoji: string;
  expiresAt: number;
}

interface FloatingText {
  agentId: string;
  text: string;
  color: string;
  startedAt: number;
  expiresAt: number;
}

interface AgentActivity {
  agentId: string;
  activity: 'fishing' | 'chopping' | 'selling' | 'crafting' | 'building';
  startedAt: number;
  duration: number;
  targetX?: number;
  targetY?: number;
  extra?: Record<string, unknown>;
}

interface AgentRenderState {
  displayX: number;
  displayY: number;
  targetX: number;
  targetY: number;
}

interface GameCanvasProps {
  onAgentClick?: (agentId: string) => void;
  selectedAgentId?: string | null;
  focusAgentId?: string | null;
  focusKey?: number;
  onZoomChange?: (zoom: number) => void;
  zoomValue?: number;
}

export default function GameCanvas({ onAgentClick, selectedAgentId, focusAgentId, focusKey, onZoomChange, zoomValue }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const agentsRef = useRef<AgentData[]>([]);
  const tilesRef = useRef<number[][]>([]);
  const obstaclesRef = useRef<boolean[][]>([]);
  const speechBubblesRef = useRef<SpeechBubble[]>([]);
  const emotesRef = useRef<Emote[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const agentActivitiesRef = useRef<Map<string, AgentActivity>>(new Map());
  const treeStatesRef = useRef<Record<string, TreeState>>({});
  const buildingsRef = useRef<BuildingData[]>([]);
  const worldTimeRef = useRef<WorldTimeData | null>(null);
  const renderStatesRef = useRef<Map<string, AgentRenderState>>(new Map());
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, animating: false, trackingAgentId: null as string | null });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0 });
  const hoveredAgentRef = useRef<string | null>(null);
  const [, forceUpdate] = useState(0);

  // ── Performance optimization: indexed lookups ──
  const speechBubbleMapRef = useRef<Map<string, SpeechBubble>>(new Map());
  const emoteMapRef = useRef<Map<string, Emote>>(new Map());
  const buildingMapRef = useRef<Map<string, BuildingData>>(new Map()); // key: "x,y"

  // ── Viewport culling helpers ──
  const getVisibleBounds = useCallback((
    width: number,
    height: number,
    camX: number,
    camY: number,
    zoom: number
  ) => {
    // Calculate visible area in world coordinates
    // Screen transform: translate(width/2 + camX, 80 + camY) then scale(zoom)
    // Inverse: world = (screen - translate) / zoom

    const padding = 100; // Extra padding for tall objects like trees/buildings
    const left = (-width / 2 - camX - padding) / zoom;
    const right = (width / 2 - camX + padding) / zoom;
    const top = (-80 - camY - padding) / zoom;
    const bottom = (height - 80 - camY + padding) / zoom;

    return { left, right, top, bottom };
  }, []);

  // Convert screen bounds to grid tile range (approximate for isometric)
  const getVisibleTileRange = useCallback((
    bounds: { left: number; right: number; top: number; bottom: number }
  ) => {
    // Isometric: screenX = (gx - gy) * TILE_HALF_W, screenY = (gx + gy) * TILE_HALF_H
    // Inverse: gx = (screenX/TILE_HALF_W + screenY/TILE_HALF_H) / 2
    //          gy = (screenY/TILE_HALF_H - screenX/TILE_HALF_W) / 2

    const corners = [
      { x: bounds.left, y: bounds.top },
      { x: bounds.right, y: bounds.top },
      { x: bounds.left, y: bounds.bottom },
      { x: bounds.right, y: bounds.bottom },
    ];

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const c of corners) {
      const gx = (c.x / TILE_HALF_W + c.y / TILE_HALF_H) / 2;
      const gy = (c.y / TILE_HALF_H - c.x / TILE_HALF_W) / 2;
      minX = Math.min(minX, gx);
      maxX = Math.max(maxX, gx);
      minY = Math.min(minY, gy);
      maxY = Math.max(maxY, gy);
    }

    return {
      minX: Math.max(0, Math.floor(minX) - 2),
      maxX: Math.min(WORLD_WIDTH - 1, Math.ceil(maxX) + 2),
      minY: Math.max(0, Math.floor(minY) - 2),
      maxY: Math.min(WORLD_HEIGHT - 1, Math.ceil(maxY) + 2),
    };
  }, []);

  // Check if a screen point is visible (with padding for objects)
  const isScreenPointVisible = useCallback((
    sx: number,
    sy: number,
    bounds: { left: number; right: number; top: number; bottom: number },
    objectHeight: number = 100
  ) => {
    return sx >= bounds.left && sx <= bounds.right &&
           sy - objectHeight <= bounds.bottom && sy >= bounds.top;
  }, []);

  // ── Isometric projection ──
  const gridToScreen = useCallback((gx: number, gy: number) => ({
    x: (gx - gy) * TILE_HALF_W,
    y: (gx + gy) * TILE_HALF_H,
  }), []);

  // ── Sync zoom from external slider ──
  useEffect(() => {
    if (zoomValue !== undefined && Math.abs(cameraRef.current.zoom - zoomValue) > 0.01) {
      cameraRef.current.zoom = zoomValue;
    }
  }, [zoomValue]);

  // ── Focus camera on agent and start tracking ──
  useEffect(() => {
    if (!focusAgentId || !focusKey) return;
    const agent = agentsRef.current.find(a => a.id === focusAgentId);
    if (!agent) return;

    const screen = gridToScreen(agent.posX, agent.posY);
    const cam = cameraRef.current;
    const canvas = canvasRef.current;
    const canvasH = canvas ? canvas.clientHeight : 600;

    // Transform is: translate(w/2 + cam.x, 80 + cam.y) → scale(zoom)
    // World point (sx,sy) → screen (w/2 + cam.x + sx*zoom, 80 + cam.y + sy*zoom)
    // To center at (w/2, canvasH/2): cam.x = -sx*zoom, cam.y = canvasH/2 - 80 - sy*zoom
    cam.targetX = -screen.x * cam.zoom;
    cam.targetY = (canvasH / 2 - 80) - screen.y * cam.zoom;
    cam.animating = true;
    cam.trackingAgentId = focusAgentId; // Start continuous tracking
  }, [focusKey, focusAgentId, gridToScreen]);

  // ── Stop tracking when selectedAgentId is cleared ──
  useEffect(() => {
    if (!selectedAgentId) {
      cameraRef.current.trackingAgentId = null;
    }
  }, [selectedAgentId]);

  // ── Draw isometric diamond tile ──
  const drawTile = useCallback((
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    topColor: string,
    leftColor: string,
    rightColor: string,
    height: number = 0,
  ) => {
    const hw = TILE_HALF_W;
    const hh = TILE_HALF_H;

    ctx.fillStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(sx, sy - height);
    ctx.lineTo(sx + hw, sy + hh - height);
    ctx.lineTo(sx, sy + hh * 2 - height);
    ctx.lineTo(sx - hw, sy + hh - height);
    ctx.closePath();
    ctx.fill();

    if (height > 0) {
      ctx.fillStyle = leftColor;
      ctx.beginPath();
      ctx.moveTo(sx - hw, sy + hh - height);
      ctx.lineTo(sx, sy + hh * 2 - height);
      ctx.lineTo(sx, sy + hh * 2);
      ctx.lineTo(sx - hw, sy + hh);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = rightColor;
      ctx.beginPath();
      ctx.moveTo(sx + hw, sy + hh - height);
      ctx.lineTo(sx, sy + hh * 2 - height);
      ctx.lineTo(sx, sy + hh * 2);
      ctx.lineTo(sx + hw, sy + hh);
      ctx.closePath();
      ctx.fill();
    }
  }, []);

  // ── Draw Grass (Procedural) ──
  const drawGrass = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = seededRand(x, y, 1);
    const shade = r > 0.7 ? '#95e06a' : r > 0.4 ? '#8fd860' : '#88d058';
    const side = r > 0.7 ? '#7ec850' : r > 0.4 ? '#76c048' : '#6eb840';
    drawTile(ctx, sx, sy, shade, side, darkenColor(side, 0.1), 0);

    // Grass blades/extras
    if (r > 0.82) {
      ctx.strokeStyle = '#6ab840';
      ctx.lineWidth = 1;
      const ox = (seededRand(x, y, 2) - 0.5) * 16;
      const oy = (seededRand(x, y, 3) - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(sx + ox, sy + TILE_HALF_H + oy);
      ctx.lineTo(sx + ox - 2, sy + TILE_HALF_H + oy - 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx + ox + 3, sy + TILE_HALF_H + oy);
      ctx.lineTo(sx + ox + 4, sy + TILE_HALF_H + oy - 4);
      ctx.stroke();
    }
  }, [drawTile]);

  // ── Draw path with pebbles ──
  const drawPath = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = seededRand(x, y, 5);
    const shade = r > 0.6 ? '#e8d4b0' : '#e0c8a8';
    drawTile(ctx, sx, sy, shade, '#c8b090', '#baa880', 1);

    if (r > 0.6) {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.beginPath();
      ctx.arc(sx + (seededRand(x, y, 6) - 0.5) * 14, sy + TILE_HALF_H + (seededRand(x, y, 7) - 0.5) * 5, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (r > 0.8) {
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.beginPath();
      ctx.arc(sx + (seededRand(x, y, 8) - 0.5) * 12 + 6, sy + TILE_HALF_H + (seededRand(x, y, 9) - 0.5) * 4 + 2, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [drawTile]);

  // ── Draw water with ripples ──
  const drawWater = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number, now: number) => {
    const wobble = Math.sin(now / 800 + x * 0.5 + y * 0.3) * 1;
    const r = seededRand(x, y, 10);
    const base = r > 0.5 ? '#6eb0e8' : '#64a8e0';
    drawTile(ctx, sx, sy + wobble, base, '#4a8cc0', '#5499d0', 0);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(sx + Math.sin(now / 1200 + x) * 4 + (r - 0.5) * 10, sy + TILE_HALF_H + wobble - 2 + Math.cos(now / 1000 + y) * 2, 4, 2, 0.3, 0, Math.PI * 2);
    ctx.fill();

    if (r > 0.6) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(sx - 6 + Math.sin(now / 1500 + x * 0.7) * 3, sy + TILE_HALF_H + wobble + 3 + Math.cos(now / 900 + y * 0.8) * 2, 3, 1.5, -0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [drawTile]);

  // ── Draw stone plaza tile ──
  const drawStone = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = seededRand(x, y, 20);
    const shade = r > 0.5 ? '#c8c8c8' : '#bfbfbf';
    drawTile(ctx, sx, sy, shade, '#a8a8a8', '#9a9a9a', 3);

    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    if (r > 0.4) {
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy + TILE_HALF_H - 1);
      ctx.lineTo(sx + 8, sy + TILE_HALF_H - 1);
      ctx.stroke();
    }
  }, [drawTile]);

  // ── Draw tree (Detailed) - with state support ──
  const drawTree = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const treeKey = `${Math.floor(x)}_${Math.floor(y)}`;
    const treeState = treeStatesRef.current[treeKey] || 'full';
    const r = seededRand(x, y, 30);
    const isPine = r < 0.35;
    const hasApples = r > 0.85;
    const tc = r > 0.5 ? '#6D4C41' : '#5D4037';

    // === STUMP STATE ===
    if (treeState === 'stump') {
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.beginPath();
      ctx.ellipse(sx + 2, sy + 6, 10, 5, 0.1, 0, Math.PI * 2);
      ctx.fill();

      // Stump base (short trunk)
      ctx.fillStyle = tc;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Top cut surface (lighter wood)
      ctx.fillStyle = '#A1887F';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Annual rings on top
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 3, 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();

      return;
    }

    // === SAPLING STATE ===
    if (treeState === 'sapling') {
      // Small shadow
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.beginPath();
      ctx.ellipse(sx + 1, sy + 4, 6, 3, 0.1, 0, Math.PI * 2);
      ctx.fill();

      // Thin stem
      ctx.strokeStyle = '#5D4037';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - 12);
      ctx.stroke();

      // Small leaves
      ctx.fillStyle = '#66BB6A';
      ctx.beginPath();
      ctx.ellipse(sx - 4, sy - 10, 4, 3, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(sx + 4, sy - 12, 4, 3, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(sx, sy - 16, 3, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      return;
    }

    // === FULL TREE STATE ===
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(sx + 4, sy + 8, 16, 7, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Trunk with bark texture
    ctx.fillStyle = tc;
    ctx.beginPath();
    ctx.moveTo(sx - 4, sy + 2);
    ctx.lineTo(sx - 5, sy - 24);
    ctx.quadraticCurveTo(sx, sy - 28, sx + 5, sy - 24);
    ctx.lineTo(sx + 4, sy + 2);
    ctx.closePath();
    ctx.fill();
    // Bark lines
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.8;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - 3 + i * 2, sy - 2);
      ctx.lineTo(sx - 2 + i * 1.5, sy - 20);
      ctx.stroke();
    }
    // Highlight
    ctx.fillStyle = lightenColor(tc, 0.25);
    ctx.fillRect(sx - 2, sy - 22, 2, 20);

    if (isPine) {
      // Pine tree layers
      const layers = [
        { y: -22, w: 16, c: '#1B5E20' },
        { y: -30, w: 14, c: '#2E7D32' },
        { y: -38, w: 11, c: '#388E3C' },
        { y: -44, w: 7, c: '#43A047' },
      ];
      for (const l of layers) {
        ctx.fillStyle = l.c;
        ctx.beginPath();
        ctx.moveTo(sx, sy + l.y - 10);
        ctx.lineTo(sx + l.w, sy + l.y);
        ctx.lineTo(sx - l.w, sy + l.y);
        ctx.closePath();
        ctx.fill();
      }
      // Snow tip
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 54);
      ctx.lineTo(sx + 4, sy - 48);
      ctx.lineTo(sx - 4, sy - 48);
      ctx.closePath();
      ctx.fill();
    } else {
      // Round canopy with depth
      const canopyLayers = [
        { ox: -8, oy: -28, r: 12, c: '#1B5E20' },
        { ox: 8, oy: -30, r: 11, c: '#2E7D32' },
        { ox: 0, oy: -36, r: 13, c: '#388E3C' },
        { ox: -5, oy: -42, r: 10, c: '#43A047' },
        { ox: 5, oy: -44, r: 9, c: '#4CAF50' },
        { ox: 0, oy: -48, r: 7, c: '#66BB6A' },
      ];
      for (const l of canopyLayers) {
        ctx.fillStyle = l.c;
        ctx.beginPath();
        ctx.arc(sx + l.ox, sy + l.oy, l.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(sx - 4, sy - 50, 5, 0, Math.PI * 2); ctx.fill();

      // Apples
      if (hasApples) {
        ctx.fillStyle = '#E53935';
        ctx.beginPath(); ctx.arc(sx - 6, sy - 32, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + 7, sy - 36, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(sx - 2, sy - 40, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }, []);

  // ── Draw flower ──
  const drawFlower = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const colorSets = [
      { petals: '#ff6b8a', center: '#ffe066' },
      { petals: '#ffb347', center: '#fff45c' },
      { petals: '#dda0dd', center: '#ffe4e1' },
      { petals: '#87ceeb', center: '#fff8dc' },
      { petals: '#ff9ff3', center: '#ffeaa7' },
    ];
    const ci = Math.abs(Math.round(seededRand(x, y, 40) * 100)) % colorSets.length;
    const c = colorSets[ci];
    const s = 0.8 + seededRand(x, y, 41) * 0.4;

    ctx.strokeStyle = '#3a7a2f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + 1, sy - 4 * s, sx, sy - 8 * s);
    ctx.stroke();

    if (seededRand(x, y, 42) > 0.5) {
      ctx.fillStyle = '#4a8c3f';
      ctx.beginPath();
      ctx.ellipse(sx + 3, sy - 3.2 * s, 3 * s, 1.5 * s, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = c.petals;
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + seededRand(x, y, 43) * 0.3;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(angle) * 3 * s, sy - 8 * s + Math.sin(angle) * 3 * s, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = c.center;
    ctx.beginPath();
    ctx.arc(sx, sy - 8 * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  // ── Draw Building (Animal Crossing Style) ──
  const drawBuilding = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = seededRand(x, y, 50);
    const bh = 32;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(sx + 3, sy + TILE_HALF_H + 4, 22, 8, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // ── Wall Colors (Pastel) ──
    const wallPalettes = [
      { front: '#FFF8E1', side: '#FFE0B2', trim: '#FFCC80' }, // Cream
      { front: '#E3F2FD', side: '#BBDEFB', trim: '#90CAF9' }, // Sky Blue
      { front: '#FCE4EC', side: '#F8BBD9', trim: '#F48FB1' }, // Pink
      { front: '#E8F5E9', side: '#C8E6C9', trim: '#A5D6A7' }, // Mint
      { front: '#FFF3E0', side: '#FFE0B2', trim: '#FFAB91' }, // Peach
    ];
    const wp = wallPalettes[Math.floor(r * 5) % 5];

    // ── Front Wall ──
    ctx.fillStyle = wp.front;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bh);
    ctx.lineTo(sx + TILE_HALF_W - 2, sy + TILE_HALF_H - bh);
    ctx.lineTo(sx + TILE_HALF_W - 2, sy + TILE_HALF_H);
    ctx.lineTo(sx, sy + TILE_HALF_H * 2);
    ctx.closePath();
    ctx.fill();
    // Front wall outline
    ctx.strokeStyle = darkenColor(wp.front, 0.1); ctx.lineWidth = 1;
    ctx.stroke();

    // ── Side Wall ──
    ctx.fillStyle = wp.side;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bh);
    ctx.lineTo(sx - TILE_HALF_W + 2, sy + TILE_HALF_H - bh);
    ctx.lineTo(sx - TILE_HALF_W + 2, sy + TILE_HALF_H);
    ctx.lineTo(sx, sy + TILE_HALF_H * 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = darkenColor(wp.side, 0.1); ctx.lineWidth = 1;
    ctx.stroke();

    // ── Roof Colors ──
    const roofPalettes = [
      { main: '#5D4037', light: '#795548', dark: '#3E2723' }, // Brown
      { main: '#1565C0', light: '#1E88E5', dark: '#0D47A1' }, // Blue
      { main: '#C62828', light: '#E53935', dark: '#B71C1C' }, // Red
      { main: '#2E7D32', light: '#43A047', dark: '#1B5E20' }, // Green
      { main: '#6A1B9A', light: '#8E24AA', dark: '#4A148C' }, // Purple
    ];
    const rp = roofPalettes[Math.floor(r * 5) % 5];

    // ── Roof (rounded shingle style) ──
    // Back part
    ctx.fillStyle = rp.dark;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bh - 12);
    ctx.lineTo(sx - TILE_HALF_W - 4, sy + TILE_HALF_H - bh + 2);
    ctx.lineTo(sx, sy + TILE_HALF_H * 2 - bh);
    ctx.closePath();
    ctx.fill();

    // Front part (highlight)
    ctx.fillStyle = rp.main;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bh - 12);
    ctx.lineTo(sx + TILE_HALF_W + 4, sy + TILE_HALF_H - bh + 2);
    ctx.lineTo(sx, sy + TILE_HALF_H * 2 - bh);
    ctx.closePath();
    ctx.fill();

    // Roof edge highlight
    ctx.fillStyle = rp.light;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bh - 12);
    ctx.lineTo(sx + TILE_HALF_W + 4, sy + TILE_HALF_H - bh + 2);
    ctx.lineTo(sx + TILE_HALF_W + 4, sy + TILE_HALF_H - bh + 5);
    ctx.lineTo(sx, sy - bh - 9);
    ctx.closePath();
    ctx.fill();

    // Shingle lines
    ctx.strokeStyle = darkenColor(rp.main, 0.15); ctx.lineWidth = 0.5;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - i * 5, sy - bh - 10 + i * 5);
      ctx.lineTo(sx + TILE_HALF_W - i * 3, sy + TILE_HALF_H - bh - 2 + i * 3);
      ctx.stroke();
    }

    // ── Door (isometric on front wall) ──
    // Front wall goes from (sx, sy-bh) to (sx+TILE_HALF_W-2, sy+TILE_HALF_H-bh) at top
    // and (sx, sy+TILE_HALF_H*2) to (sx+TILE_HALF_W-2, sy+TILE_HALF_H) at bottom
    const doorBaseY = sy + TILE_HALF_H * 2 - 2; // Bottom of door at ground level
    const doorHeight = 16;
    const doorWidth = 8;
    // Position door at center-right of front wall
    const doorOffsetX = 6; // How far from center
    const doorOffsetY = -doorOffsetX * 0.5; // Isometric offset

    // Door background (isometric parallelogram)
    ctx.fillStyle = '#5D4037';
    ctx.beginPath();
    ctx.moveTo(sx + doorOffsetX, doorBaseY + doorOffsetY);
    ctx.lineTo(sx + doorOffsetX + doorWidth, doorBaseY + doorOffsetY - doorWidth * 0.5);
    ctx.lineTo(sx + doorOffsetX + doorWidth, doorBaseY + doorOffsetY - doorWidth * 0.5 - doorHeight);
    ctx.lineTo(sx + doorOffsetX, doorBaseY + doorOffsetY - doorHeight);
    ctx.closePath();
    ctx.fill();

    // Door (slightly inset)
    ctx.fillStyle = '#8D6E63';
    ctx.beginPath();
    ctx.moveTo(sx + doorOffsetX + 1, doorBaseY + doorOffsetY - 0.5);
    ctx.lineTo(sx + doorOffsetX + doorWidth - 1, doorBaseY + doorOffsetY - doorWidth * 0.5 + 0.5);
    ctx.lineTo(sx + doorOffsetX + doorWidth - 1, doorBaseY + doorOffsetY - doorWidth * 0.5 - doorHeight + 2);
    ctx.lineTo(sx + doorOffsetX + 1, doorBaseY + doorOffsetY - doorHeight + 2);
    ctx.closePath();
    ctx.fill();

    // Door knob (positioned on right side of door in isometric)
    ctx.fillStyle = '#FFD54F';
    const knobX = sx + doorOffsetX + doorWidth - 2;
    const knobY = doorBaseY + doorOffsetY - doorWidth * 0.5 - doorHeight * 0.4;
    ctx.beginPath();
    ctx.arc(knobX, knobY, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // ── Awning over door (isometric) ──
    ctx.fillStyle = wp.trim;
    const awningY = doorBaseY + doorOffsetY - doorHeight - 1;
    ctx.beginPath();
    ctx.moveTo(sx + doorOffsetX - 2, awningY + 1);
    ctx.lineTo(sx + doorOffsetX + doorWidth + 2, awningY - doorWidth * 0.5);
    ctx.lineTo(sx + doorOffsetX + doorWidth + 4, awningY - doorWidth * 0.5 + 3);
    ctx.lineTo(sx + doorOffsetX, awningY + 4);
    ctx.closePath();
    ctx.fill();

    // ── Window (isometric on side/left wall) ──
    // Side wall: going LEFT means going UP (for every -1 in X, -0.5 in Y)
    // The left side of the wall is "further back" in perspective
    const winW = 10; // width along the wall (isometric horizontal)
    const winH = 10; // height (vertical)
    // Position window on the left/side wall
    const winRightX = sx - 6; // right edge of window (closer to center of house)
    const winTopRightY = sy + 2; // top-right corner Y position

    // Window frame (white, isometric parallelogram matching side wall angle)
    // Going left on side wall: X decreases, Y DECREASES by half that amount (goes UP)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(winRightX, winTopRightY); // top-right
    ctx.lineTo(winRightX - winW, winTopRightY - winW * 0.5); // top-left (UP-left slope)
    ctx.lineTo(winRightX - winW, winTopRightY - winW * 0.5 + winH); // bottom-left
    ctx.lineTo(winRightX, winTopRightY + winH); // bottom-right
    ctx.closePath();
    ctx.fill();

    // Window glass (blue, isometric - slightly inset)
    ctx.fillStyle = '#81D4FA';
    ctx.beginPath();
    ctx.moveTo(winRightX - 1, winTopRightY + 1); // top-right
    ctx.lineTo(winRightX - winW + 1, winTopRightY - (winW - 1) * 0.5 + 1); // top-left
    ctx.lineTo(winRightX - winW + 1, winTopRightY - (winW - 1) * 0.5 + winH - 1); // bottom-left
    ctx.lineTo(winRightX - 1, winTopRightY + winH - 1); // bottom-right
    ctx.closePath();
    ctx.fill();

    // Window shine (top-left corner highlight - that's where light hits)
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(winRightX - winW + 2, winTopRightY - winW * 0.5 + 2);
    ctx.lineTo(winRightX - winW + 5, winTopRightY - winW * 0.5 + 2 + 1.5);
    ctx.lineTo(winRightX - winW + 5, winTopRightY - winW * 0.5 + 5 + 1.5);
    ctx.lineTo(winRightX - winW + 2, winTopRightY - winW * 0.5 + 5);
    ctx.closePath();
    ctx.fill();

    // Cross bars (isometric, matching wall angle)
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    // Vertical bar (straight up-down)
    ctx.beginPath();
    const winMidX = winRightX - winW / 2;
    const winMidYTop = winTopRightY - (winW / 2) * 0.5;
    ctx.moveTo(winMidX, winMidYTop + 1);
    ctx.lineTo(winMidX, winMidYTop + winH - 1);
    ctx.stroke();
    // Horizontal bar (follows isometric slope - goes UP to the left)
    ctx.beginPath();
    const winMidY = winTopRightY + winH / 2;
    ctx.moveTo(winRightX - 1, winMidY);
    ctx.lineTo(winRightX - winW + 1, winMidY - (winW - 2) * 0.5);
    ctx.stroke();

    // ── Flower pot (positioned properly on ground near door) ──
    if (r > 0.3) {
      // Position pot on ground level, to the right of the door
      const potBaseX = sx + doorOffsetX + doorWidth + 6;
      const potBaseY = doorBaseY + doorOffsetY - doorWidth * 0.5 + 2;

      // Pot (isometric trapezoid)
      ctx.fillStyle = '#D84315';
      ctx.beginPath();
      ctx.moveTo(potBaseX - 3, potBaseY - 7);
      ctx.lineTo(potBaseX + 3, potBaseY - 7 - 1.5);
      ctx.lineTo(potBaseX + 2, potBaseY - 1.5);
      ctx.lineTo(potBaseX - 2, potBaseY);
      ctx.closePath();
      ctx.fill();

      // Pot rim
      ctx.fillStyle = '#BF360C';
      ctx.beginPath();
      ctx.moveTo(potBaseX - 3.5, potBaseY - 7);
      ctx.lineTo(potBaseX + 3.5, potBaseY - 8.5);
      ctx.lineTo(potBaseX + 3, potBaseY - 7 - 1.5);
      ctx.lineTo(potBaseX - 3, potBaseY - 7);
      ctx.closePath();
      ctx.fill();

      // Flowers
      const fc = ['#E91E63', '#FFEB3B', '#FF9800'][Math.floor(r * 3)];
      ctx.fillStyle = fc;
      ctx.beginPath(); ctx.arc(potBaseX - 1, potBaseY - 12, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(potBaseX + 2, potBaseY - 13.5, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(potBaseX - 2.5, potBaseY - 10.5, 2, 0, Math.PI * 2); ctx.fill();

      // Flower centers
      ctx.fillStyle = '#FFF59D';
      ctx.beginPath(); ctx.arc(potBaseX - 1, potBaseY - 12, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(potBaseX + 2, potBaseY - 13.5, 0.8, 0, Math.PI * 2); ctx.fill();

      // Leaves/stems
      ctx.fillStyle = '#4CAF50';
      ctx.strokeStyle = '#388E3C';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(potBaseX, potBaseY - 8);
      ctx.quadraticCurveTo(potBaseX - 1, potBaseY - 10, potBaseX - 1, potBaseY - 11);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(potBaseX, potBaseY - 8);
      ctx.quadraticCurveTo(potBaseX + 2, potBaseY - 11, potBaseX + 2, potBaseY - 12.5);
      ctx.stroke();
    }

    // ── Mailbox ──
    if (r > 0.5) {
      const mbX = sx - 20, mbY = sy + TILE_HALF_H + 4;
      // Post
      ctx.fillStyle = '#8D6E63';
      ctx.fillRect(mbX - 1, mbY - 8, 2, 10);
      // Box
      ctx.fillStyle = '#5D4037';
      ctx.fillRect(mbX - 4, mbY - 12, 6, 5);
      // Flag
      ctx.fillStyle = '#F44336';
      ctx.fillRect(mbX + 2, mbY - 12, 1, 3);
      ctx.beginPath();
      ctx.moveTo(mbX + 3, mbY - 12);
      ctx.lineTo(mbX + 6, mbY - 10.5);
      ctx.lineTo(mbX + 3, mbY - 9);
      ctx.closePath();
      ctx.fill();
    }

  }, []);

  // ── Draw Player Building (with construction states) ──
  const drawPlayerBuilding = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, building: BuildingData) => {
    const progress = building.woodUsed / building.woodRequired;
    const bh = 32;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(sx + 3, sy + TILE_HALF_H + 4, 22, 8, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Construction site colors
    const woodColor = '#C8A860';
    const frameColor = '#A08040';
    const scaffoldColor = '#8B7355';

    if (building.state === 'foundation') {
      // Just wooden planks on ground
      ctx.fillStyle = woodColor;
      ctx.beginPath();
      ctx.moveTo(sx - TILE_HALF_W + 4, sy + TILE_HALF_H - 2);
      ctx.lineTo(sx + TILE_HALF_W - 4, sy + TILE_HALF_H - 2);
      ctx.lineTo(sx, sy + TILE_HALF_H * 2 - 2);
      ctx.lineTo(sx, sy + TILE_HALF_H * 2 - 2);
      ctx.closePath();
      ctx.fill();
      // Wood planks lines
      ctx.strokeStyle = darkenColor(woodColor, 0.15);
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(sx - TILE_HALF_W + 8 + i * 8, sy + TILE_HALF_H);
        ctx.lineTo(sx - 4 + i * 8, sy + TILE_HALF_H * 2 - 4);
        ctx.stroke();
      }
    } else if (building.state === 'frame') {
      // Wooden frame skeleton
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 3;
      // Corner posts
      ctx.beginPath();
      ctx.moveTo(sx - 12, sy + TILE_HALF_H);
      ctx.lineTo(sx - 12, sy - bh / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx + 12, sy + TILE_HALF_H);
      ctx.lineTo(sx + 12, sy - bh / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx, sy + TILE_HALF_H * 2 - 4);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      // Top beam
      ctx.beginPath();
      ctx.moveTo(sx - 12, sy - bh / 2);
      ctx.lineTo(sx + 12, sy - bh / 2);
      ctx.stroke();
    } else if (building.state === 'walls') {
      // Partial walls with frame visible
      ctx.fillStyle = '#FFF8E1';
      ctx.globalAlpha = 0.7;
      // Front wall (partial)
      ctx.beginPath();
      ctx.moveTo(sx, sy - bh / 2);
      ctx.lineTo(sx + TILE_HALF_W - 4, sy + TILE_HALF_H - bh / 2);
      ctx.lineTo(sx + TILE_HALF_W - 4, sy + TILE_HALF_H);
      ctx.lineTo(sx, sy + TILE_HALF_H * 2);
      ctx.closePath();
      ctx.fill();
      // Side wall
      ctx.fillStyle = '#E8E0D0';
      ctx.beginPath();
      ctx.moveTo(sx, sy - bh / 2);
      ctx.lineTo(sx - TILE_HALF_W + 4, sy + TILE_HALF_H - bh / 2);
      ctx.lineTo(sx - TILE_HALF_W + 4, sy + TILE_HALF_H);
      ctx.lineTo(sx, sy + TILE_HALF_H * 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      // Scaffolding
      ctx.strokeStyle = scaffoldColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx + TILE_HALF_W, sy);
      ctx.lineTo(sx + TILE_HALF_W, sy - bh);
      ctx.stroke();
    } else if (building.state === 'roof') {
      // Nearly complete - walls done, roof outline
      ctx.fillStyle = '#FFF8E1';
      // Front wall
      ctx.beginPath();
      ctx.moveTo(sx, sy - bh);
      ctx.lineTo(sx + TILE_HALF_W - 2, sy + TILE_HALF_H - bh);
      ctx.lineTo(sx + TILE_HALF_W - 2, sy + TILE_HALF_H);
      ctx.lineTo(sx, sy + TILE_HALF_H * 2);
      ctx.closePath();
      ctx.fill();
      // Side wall
      ctx.fillStyle = '#E8E0D0';
      ctx.beginPath();
      ctx.moveTo(sx, sy - bh);
      ctx.lineTo(sx - TILE_HALF_W + 2, sy + TILE_HALF_H - bh);
      ctx.lineTo(sx - TILE_HALF_W + 2, sy + TILE_HALF_H);
      ctx.lineTo(sx, sy + TILE_HALF_H * 2);
      ctx.closePath();
      ctx.fill();
      // Partial roof frame
      ctx.strokeStyle = '#8B4513';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - bh - 10);
      ctx.lineTo(sx + TILE_HALF_W, sy + TILE_HALF_H - bh);
      ctx.moveTo(sx, sy - bh - 10);
      ctx.lineTo(sx - TILE_HALF_W, sy + TILE_HALF_H - bh);
      ctx.stroke();
    } else if (building.state === 'complete') {
      // Use full building rendering - redirect to standard building
      drawBuilding(ctx, sx, sy, building.x, building.y);
    }

    // Progress bar for incomplete buildings
    if (building.state !== 'complete') {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.roundRect(sx - 25, sy - bh - 20, 50, 12, 4);
      ctx.fill();
      ctx.fillStyle = '#4CAF50';
      ctx.beginPath();
      ctx.roundRect(sx - 23, sy - bh - 18, 46 * progress, 8, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '8px Inter, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.floor(progress * 100)}%`, sx, sy - bh - 11);
    }

    // Owner name tag (small and subtle, positioned lower on the house)
    ctx.font = '7px Inter, system-ui';
    const ownerLabel = `${building.ownerName}'s`;
    const tagWidth = ctx.measureText(ownerLabel).width + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(sx - tagWidth / 2, sy - bh - (building.state === 'complete' ? 8 : 30), tagWidth, 12, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(ownerLabel, sx, sy - bh + (building.state === 'complete' ? 1 : -21));
  }, [drawBuilding]);

  // ── Draw bridge ──
  const drawBridge = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number) => {
    drawTile(ctx, sx, sy, '#b89060', '#9a7848', '#8a6838', 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - TILE_HALF_W + 8, sy + TILE_HALF_H - 4 + i * 3);
      ctx.lineTo(sx + TILE_HALF_W - 8, sy + TILE_HALF_H - 4 + i * 3);
      ctx.stroke();
    }
    ctx.strokeStyle = '#6a5030';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - TILE_HALF_W + 4, sy + TILE_HALF_H - 8);
    ctx.lineTo(sx - TILE_HALF_W + 4, sy + TILE_HALF_H - 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + TILE_HALF_W - 4, sy + TILE_HALF_H - 8);
    ctx.lineTo(sx + TILE_HALF_W - 4, sy + TILE_HALF_H - 14);
    ctx.stroke();
  }, [drawTile]);

  // ── Draw sand ──
  const drawSand = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = ((x * 17 + y * 31) % 100) / 100;
    const shade = r > 0.5 ? '#e8d8a8' : '#e0d098';
    drawTile(ctx, sx, sy, shade, '#c8b880', '#baa870', 0);
    // Tiny shell / pebble detail
    if (r > 0.7) {
      ctx.fillStyle = 'rgba(200,180,140,0.5)';
      ctx.beginPath();
      ctx.arc(sx - 5 + r * 10, sy + 3, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [drawTile]);

  // ── Draw dock (wooden plank) ──
  const drawDock = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number) => {
    drawTile(ctx, sx, sy, '#a08050', '#8a6838', '#7a5828', 2);
    // Wood plank lines
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - TILE_HALF_W + 10, sy + TILE_HALF_H - 6 + i * 4);
      ctx.lineTo(sx + TILE_HALF_W - 10, sy + TILE_HALF_H - 6 + i * 4);
      ctx.stroke();
    }
    // Dock post
    ctx.fillStyle = '#6a4820';
    ctx.fillRect(sx - 2, sy - 8, 4, 10);
  }, [drawTile]);

  // ── Draw fence ──
  const drawFence = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number) => {
    drawTile(ctx, sx, sy, '#8ab060', '#6a9040', '#5a8030', 0);
    // Vertical fence posts
    ctx.fillStyle = '#b09070';
    ctx.fillRect(sx - 8, sy - 10, 2, 12);
    ctx.fillRect(sx + 6, sy - 10, 2, 12);
    // Horizontal rails
    ctx.fillStyle = '#c8a880';
    ctx.fillRect(sx - 8, sy - 9, 16, 2);
    ctx.fillRect(sx - 8, sy - 4, 16, 2);
  }, [drawTile]);

  // ── Draw garden soil ──
  const drawGarden = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = ((x * 13 + y * 29) % 100) / 100;
    const shade = r > 0.5 ? '#8a7050' : '#7a6040';
    drawTile(ctx, sx, sy, shade, '#6a5030', '#5a4020', 0);
    // Soil furrow lines
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy + TILE_HALF_H - 5 + i * 3);
      ctx.lineTo(sx + 10, sy + TILE_HALF_H - 5 + i * 3);
      ctx.stroke();
    }
    // Small green sprout
    if (r > 0.3) {
      ctx.fillStyle = '#6a9a40';
      ctx.beginPath();
      ctx.arc(sx - 3 + r * 6, sy + 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [drawTile]);

  // ── Draw flower field (dense colorful patch) ──
  const drawFlowerField = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = ((x * 23 + y * 37) % 100) / 100;
    drawTile(ctx, sx, sy, r > 0.5 ? '#7ab050' : '#6aa040', '#5a8a30', '#4a7a20', 0);
    // Dense flowers
    const colors = ['#ff6b8a', '#ffe066', '#ff9a5c', '#c084fc', '#60d8f0', '#ff8a9a'];
    for (let i = 0; i < 5; i++) {
      const fx = sx - 10 + ((x * 7 + i * 13) % 20);
      const fy = sy - 2 + ((y * 11 + i * 7) % 8);
      ctx.fillStyle = colors[(x + y + i) % colors.length];
      ctx.beginPath();
      ctx.arc(fx, fy, 2, 0, Math.PI * 2);
      ctx.fill();
      // Tiny stem
      ctx.strokeStyle = '#4a7a20';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(fx, fy + 2);
      ctx.lineTo(fx, fy + 5);
      ctx.stroke();
    }
  }, [drawTile]);

  // ── Draw Palm Tree ──
  const drawPalmTree = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    // Trunk - leaning slightly
    const r = seededRand(x, y, 60);
    const lean = (r - 0.5) * 6;
    ctx.strokeStyle = '#8B5E3C';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + lean, sy - 20, sx + lean * 2, sy - 40);
    ctx.stroke();

    // Fronds
    const fx = sx + lean * 2;
    const fy = sy - 40;
    ctx.fillStyle = '#4CAF50';
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + r;
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(angle) * 10, fy + Math.sin(angle) * 6, 12, 4, angle, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  // ── Draw Cactus ──
  const drawCactus = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const h = 20 + seededRand(x, y, 61) * 10;
    ctx.fillStyle = '#66BB6A';
    ctx.fillRect(sx - 3, sy - h, 6, h);
    // Arms
    if (seededRand(x, y, 62) > 0.4) {
      ctx.fillRect(sx + 3, sy - h + 5, 5, 3);
      ctx.fillRect(sx + 8, sy - h - 2, 3, 10);
    }
    if (seededRand(x, y, 63) > 0.6) {
      ctx.fillRect(sx - 8, sy - h + 10, 5, 3);
      ctx.fillRect(sx - 11, sy - h + 3, 3, 10);
    }
    // Prickles
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i < 5; i++) ctx.fillRect(sx - 1, sy - h + i * 4, 2, 1);
  }, []);

  // ── Draw Market Stall (Simple & Cute) ──
  const drawMarketStall = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = seededRand(x, y, 64);
    const isFruit = r > 0.5;

    // Soft shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 8, 14, 5, 0, 0, Math.PI * 2); ctx.fill();

    // Simple wooden crate/barrel base
    ctx.fillStyle = '#A1887F';
    ctx.beginPath();
    ctx.roundRect(sx - 10, sy - 4, 20, 12, 2);
    ctx.fill();
    // Wood grain lines
    ctx.strokeStyle = '#8D6E63'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy - 2); ctx.lineTo(sx - 8, sy + 6);
    ctx.moveTo(sx, sy - 2); ctx.lineTo(sx, sy + 6);
    ctx.moveTo(sx + 8, sy - 2); ctx.lineTo(sx + 8, sy + 6);
    ctx.stroke();

    // Goods displayed on top
    if (isFruit) {
      // Cute stacked fruits (apples & oranges)
      ctx.fillStyle = '#E53935'; // Red apple
      ctx.beginPath(); ctx.arc(sx - 5, sy - 6, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FF9800'; // Orange
      ctx.beginPath(); ctx.arc(sx + 4, sy - 5, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4CAF50'; // Green apple on top
      ctx.beginPath(); ctx.arc(sx - 1, sy - 11, 3, 0, Math.PI * 2); ctx.fill();
      // Little leaf
      ctx.fillStyle = '#2E7D32';
      ctx.beginPath(); ctx.ellipse(sx, sy - 14, 2, 1, 0.5, 0, Math.PI * 2); ctx.fill();
    } else {
      // Cute fish in bucket
      ctx.fillStyle = '#78909C'; // Bucket
      ctx.beginPath();
      ctx.moveTo(sx - 7, sy - 3); ctx.lineTo(sx - 5, sy - 10);
      ctx.lineTo(sx + 5, sy - 10); ctx.lineTo(sx + 7, sy - 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#90A4AE';
      ctx.beginPath(); ctx.ellipse(sx, sy - 10, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      // Fish peeking out
      ctx.fillStyle = '#42A5F5';
      ctx.beginPath(); ctx.ellipse(sx - 2, sy - 11, 4, 2, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#64B5F6'; // Second fish
      ctx.beginPath(); ctx.ellipse(sx + 2, sy - 13, 3, 1.5, 0.3, 0, Math.PI * 2); ctx.fill();
      // Tiny eye
      ctx.fillStyle = '#1565C0';
      ctx.beginPath(); ctx.arc(sx - 4, sy - 11, 0.8, 0, Math.PI * 2); ctx.fill();
    }

    // Simple sign hanging
    ctx.fillStyle = '#EFEBE9';
    ctx.beginPath(); ctx.roundRect(sx - 8, sy - 22, 16, 8, 1); ctx.fill();
    ctx.strokeStyle = '#8D6E63'; ctx.lineWidth = 0.5;
    ctx.strokeRect(sx - 8, sy - 22, 16, 8);

    // Sign text
    ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#5D4037';
    ctx.fillText(isFruit ? 'FRUIT' : 'FISH', sx, sy - 16);
  }, []);

  // ── Draw Fountain (Elegant 2x2) ──
  const drawFountain = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, now: number) => {
    // Soft shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 4, 18, 9, 0, 0, Math.PI * 2); ctx.fill();

    // Stone base ring (outer)
    ctx.fillStyle = '#B0BEC5';
    ctx.beginPath(); ctx.ellipse(sx, sy, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
    // Inner rim
    ctx.fillStyle = '#CFD8DC';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, 14, 7, 0, 0, Math.PI * 2); ctx.fill();

    // Pool water with gentle shimmer
    const shimmer = Math.sin(now / 200) * 0.1 + 0.9;
    ctx.fillStyle = `rgba(79, 195, 247, ${shimmer})`;
    ctx.beginPath(); ctx.ellipse(sx, sy - 2, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
    // Water highlight
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.ellipse(sx - 4, sy - 3, 4, 2, -0.3, 0, Math.PI * 2); ctx.fill();

    // Elegant center pedestal
    ctx.fillStyle = '#ECEFF1';
    ctx.beginPath();
    ctx.moveTo(sx - 4, sy - 3); ctx.lineTo(sx - 3, sy - 16);
    ctx.lineTo(sx + 3, sy - 16); ctx.lineTo(sx + 4, sy - 3);
    ctx.closePath(); ctx.fill();
    // Pedestal highlight
    ctx.fillStyle = '#FAFAFA';
    ctx.beginPath();
    ctx.moveTo(sx - 3, sy - 4); ctx.lineTo(sx - 2, sy - 15);
    ctx.lineTo(sx, sy - 15); ctx.lineTo(sx, sy - 4);
    ctx.closePath(); ctx.fill();

    // Upper bowl
    ctx.fillStyle = '#B0BEC5';
    ctx.beginPath(); ctx.ellipse(sx, sy - 16, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#81D4FA';
    ctx.beginPath(); ctx.ellipse(sx, sy - 17, 4, 2, 0, 0, Math.PI * 2); ctx.fill();

    // Elegant spout top (like a flower or ornament)
    ctx.fillStyle = '#ECEFF1';
    ctx.beginPath(); ctx.ellipse(sx, sy - 20, 2, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(sx - 1, sy - 24, 2, 4);
    // Decorative finial
    ctx.beginPath(); ctx.arc(sx, sy - 25, 2, 0, Math.PI * 2); ctx.fill();

    // Animated water streams - gentle arcs
    const t = now / 120;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.2;

    // 4 graceful water arcs falling into pool
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI / 2) + t * 0.3;
      const spread = 8 + Math.sin(t + i) * 2;
      const dx = Math.cos(angle) * spread;
      const dy = Math.sin(angle) * spread * 0.5;

      ctx.beginPath();
      ctx.moveTo(sx, sy - 18);
      ctx.quadraticCurveTo(sx + dx * 0.5, sy - 12, sx + dx * 0.8, sy - 4 + dy * 0.3);
      ctx.stroke();
    }

    // Sparkle effect on water
    const sparklePhase = (now / 300) % 1;
    if (sparklePhase < 0.3) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      const sparkleX = sx + Math.sin(now / 150) * 6;
      const sparkleY = sy - 3 + Math.cos(now / 180) * 2;
      ctx.beginPath(); ctx.arc(sparkleX, sparkleY, 1, 0, Math.PI * 2); ctx.fill();
    }
  }, []);

  // ── Draw Bench (Detailed) ──
  const drawBench = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number) => {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 6, 18, 6, 0, 0, Math.PI * 2); ctx.fill();

    // Cast Iron Legs (ornate)
    ctx.fillStyle = '#2E2E2E';
    // Left leg with curve
    ctx.beginPath();
    ctx.moveTo(sx - 14, sy + 5);
    ctx.quadraticCurveTo(sx - 16, sy - 5, sx - 14, sy - 10);
    ctx.lineTo(sx - 12, sy - 10);
    ctx.quadraticCurveTo(sx - 14, sy - 5, sx - 12, sy + 5);
    ctx.closePath(); ctx.fill();
    // Right leg
    ctx.beginPath();
    ctx.moveTo(sx + 14, sy + 5);
    ctx.quadraticCurveTo(sx + 16, sy - 5, sx + 14, sy - 10);
    ctx.lineTo(sx + 12, sy - 10);
    ctx.quadraticCurveTo(sx + 14, sy - 5, sx + 12, sy + 5);
    ctx.closePath(); ctx.fill();

    // Wooden slats for seat (with grain)
    const woodColors = ['#A1887F', '#8D6E63', '#795548'];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = woodColors[i];
      ctx.fillRect(sx - 16, sy - 8 + i * 4, 32, 3);
      // Grain lines
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - 14, sy - 7 + i * 4);
      ctx.lineTo(sx + 14, sy - 7 + i * 4);
      ctx.stroke();
    }

    // Backrest
    ctx.fillStyle = '#6D4C41';
    ctx.fillRect(sx - 16, sy - 22, 32, 4);
    ctx.fillStyle = '#795548';
    ctx.fillRect(sx - 16, sy - 17, 32, 4);
    // Backrest grain
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(sx - 14, sy - 20); ctx.lineTo(sx + 14, sy - 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 14, sy - 15); ctx.lineTo(sx + 14, sy - 15); ctx.stroke();

    // Armrests
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(sx - 18, sy - 12, 4, 8);
    ctx.fillRect(sx + 14, sy - 12, 4, 8);
    // Armrest tops
    ctx.fillStyle = '#4E342E';
    ctx.fillRect(sx - 19, sy - 14, 6, 3);
    ctx.fillRect(sx + 13, sy - 14, 6, 3);
  }, []);

  // ── Draw Stone Path ──
  const drawStonePath = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    const r = seededRand(x, y, 65);
    const shade = r > 0.5 ? '#BDBDBD' : '#9E9E9E';
    drawTile(ctx, sx, sy, shade, '#757575', '#616161', 0);
  }, [drawTile]);

  // ── Draw Slide ──
  const drawSlide = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number) => {
    // Platform base (wooden deck at top)
    ctx.fillStyle = '#8D6E63';
    ctx.beginPath();
    ctx.moveTo(sx - 18, sy - 38);
    ctx.lineTo(sx + 6, sy - 44);
    ctx.lineTo(sx + 14, sy - 38);
    ctx.lineTo(sx - 10, sy - 32);
    ctx.closePath();
    ctx.fill();

    // Platform side panel
    ctx.fillStyle = '#6D4C41';
    ctx.beginPath();
    ctx.moveTo(sx - 18, sy - 38);
    ctx.lineTo(sx - 10, sy - 32);
    ctx.lineTo(sx - 10, sy - 26);
    ctx.lineTo(sx - 18, sy - 32);
    ctx.closePath();
    ctx.fill();

    // Support posts (4 sturdy legs)
    ctx.fillStyle = '#5D4037';
    // Back left post
    ctx.fillRect(sx - 17, sy - 32, 3, 38);
    // Back right post
    ctx.fillRect(sx + 10, sy - 38, 3, 44);
    // Front left post
    ctx.fillRect(sx - 11, sy - 26, 3, 32);
    // Front right post (behind slide)
    ctx.fillRect(sx + 4, sy - 32, 3, 38);

    // Cross braces for stability
    ctx.strokeStyle = '#5D4037';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 16, sy - 10);
    ctx.lineTo(sx - 9, sy - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + 5, sy - 10);
    ctx.lineTo(sx + 12, sy - 20);
    ctx.stroke();

    // Ladder rails (metal/wood)
    ctx.fillStyle = '#78909C';
    ctx.fillRect(sx - 20, sy - 36, 2, 42);
    ctx.fillRect(sx - 12, sy - 30, 2, 36);

    // Ladder rungs (6 steps)
    ctx.fillStyle = '#90A4AE';
    for (let i = 0; i < 6; i++) {
      const runY = sy - 28 + i * 6;
      ctx.fillRect(sx - 19, runY, 8, 2);
    }

    // Safety handles at top of ladder
    ctx.strokeStyle = '#FFD54F';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx - 19, sy - 36);
    ctx.lineTo(sx - 19, sy - 44);
    ctx.lineTo(sx - 14, sy - 44);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - 11, sy - 30);
    ctx.lineTo(sx - 11, sy - 38);
    ctx.lineTo(sx - 6, sy - 38);
    ctx.stroke();

    // Slide chute - main body (bright colorful)
    const gradient = ctx.createLinearGradient(sx, sy - 40, sx + 28, sy + 8);
    gradient.addColorStop(0, '#FF7043');
    gradient.addColorStop(0.5, '#FF5722');
    gradient.addColorStop(1, '#E64A19');
    ctx.fillStyle = gradient;

    // Slide surface (curved shape)
    ctx.beginPath();
    ctx.moveTo(sx, sy - 36);
    ctx.quadraticCurveTo(sx + 8, sy - 20, sx + 24, sy + 4);
    ctx.lineTo(sx + 30, sy + 8);
    ctx.quadraticCurveTo(sx + 14, sy - 16, sx + 12, sy - 36);
    ctx.closePath();
    ctx.fill();

    // Slide side rails (safety bumpers)
    ctx.fillStyle = '#FFCA28';
    // Left rail
    ctx.beginPath();
    ctx.moveTo(sx - 1, sy - 38);
    ctx.quadraticCurveTo(sx + 6, sy - 22, sx + 22, sy + 2);
    ctx.lineTo(sx + 24, sy + 4);
    ctx.quadraticCurveTo(sx + 8, sy - 20, sx + 1, sy - 38);
    ctx.closePath();
    ctx.fill();
    // Right rail
    ctx.beginPath();
    ctx.moveTo(sx + 11, sy - 38);
    ctx.quadraticCurveTo(sx + 16, sy - 22, sx + 28, sy + 6);
    ctx.lineTo(sx + 30, sy + 8);
    ctx.quadraticCurveTo(sx + 18, sy - 20, sx + 13, sy - 38);
    ctx.closePath();
    ctx.fill();

    // Slide end curve (landing zone)
    ctx.fillStyle = '#FF8A65';
    ctx.beginPath();
    ctx.moveTo(sx + 24, sy + 4);
    ctx.quadraticCurveTo(sx + 28, sy + 10, sx + 26, sy + 12);
    ctx.lineTo(sx + 32, sy + 14);
    ctx.quadraticCurveTo(sx + 34, sy + 10, sx + 30, sy + 8);
    ctx.closePath();
    ctx.fill();

    // Shine/highlight on slide
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(sx + 4, sy - 32);
    ctx.quadraticCurveTo(sx + 10, sy - 20, sx + 26, sy + 4);
    ctx.lineTo(sx + 27, sy + 2);
    ctx.quadraticCurveTo(sx + 11, sy - 22, sx + 5, sy - 34);
    ctx.closePath();
    ctx.fill();

    // Platform railing (safety)
    ctx.strokeStyle = '#FFD54F';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 16, sy - 42);
    ctx.lineTo(sx + 2, sy - 48);
    ctx.lineTo(sx + 12, sy - 42);
    ctx.stroke();

    // Railing posts
    ctx.fillStyle = '#FFD54F';
    ctx.fillRect(sx - 17, sy - 44, 2, 6);
    ctx.fillRect(sx + 1, sy - 50, 2, 6);
    ctx.fillRect(sx + 11, sy - 44, 2, 6);
  }, []);

  // ── Draw Swing ──
  const drawSwing = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, now: number) => {
    drawTile(ctx, sx, sy, '#Aed581', '#9CCC65', '#8BC34A', 0); // Grass base

    // Frame
    ctx.strokeStyle = '#795548'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx - 15, sy + 5); ctx.lineTo(sx - 10, sy - 35); ctx.lineTo(sx + 10, sy - 35); ctx.lineTo(sx + 15, sy + 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 10, sy - 35); ctx.lineTo(sx - 5, sy + 5); ctx.stroke(); // Support
    ctx.beginPath(); ctx.moveTo(sx + 10, sy - 35); ctx.lineTo(sx + 5, sy + 5); ctx.stroke(); // Support

    // Seats (swinging slightly)
    const swing = Math.sin(now / 800) * 5;
    ctx.strokeStyle = '#3E2723'; ctx.lineWidth = 1;

    // Seat 1
    const s1x = sx - 5;
    ctx.beginPath(); ctx.moveTo(s1x, sy - 35); ctx.lineTo(s1x + swing, sy - 10); ctx.stroke();
    ctx.fillStyle = '#EF5350'; ctx.fillRect(s1x + swing - 3, sy - 10, 6, 3);

    // Seat 2
    const s2x = sx + 5;
    ctx.beginPath(); ctx.moveTo(s2x, sy - 35); ctx.lineTo(s2x + swing, sy - 10); ctx.stroke();
    ctx.fillStyle = '#42A5F5'; ctx.fillRect(s2x + swing - 3, sy - 10, 6, 3);
  }, [drawTile]);

  // ── Draw Picnic Table (Detailed) ──
  const drawPicnicTable = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number) => {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 8, 20, 8, 0, 0, Math.PI * 2); ctx.fill();

    // Table legs (A-frame style)
    ctx.fillStyle = '#6D4C41';
    // Left A-frame
    ctx.beginPath();
    ctx.moveTo(sx - 14, sy + 6); ctx.lineTo(sx - 10, sy - 12);
    ctx.lineTo(sx - 8, sy - 12); ctx.lineTo(sx - 12, sy + 6);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx - 6, sy + 6); ctx.lineTo(sx - 10, sy - 12);
    ctx.lineTo(sx - 8, sy - 12); ctx.lineTo(sx - 4, sy + 6);
    ctx.closePath(); ctx.fill();
    // Right A-frame
    ctx.beginPath();
    ctx.moveTo(sx + 14, sy + 6); ctx.lineTo(sx + 10, sy - 12);
    ctx.lineTo(sx + 8, sy - 12); ctx.lineTo(sx + 12, sy + 6);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx + 6, sy + 6); ctx.lineTo(sx + 10, sy - 12);
    ctx.lineTo(sx + 8, sy - 12); ctx.lineTo(sx + 4, sy + 6);
    ctx.closePath(); ctx.fill();

    // Cross beam
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(sx - 12, sy - 4, 24, 3);

    // Benches (front and back)
    ctx.fillStyle = '#8D6E63';
    ctx.fillRect(sx - 18, sy - 1, 36, 4); // Front bench
    ctx.fillRect(sx - 18, sy - 20, 36, 4); // Back bench
    // Bench wood grain
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(sx - 16, sy); ctx.lineTo(sx + 16, sy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 16, sy - 19); ctx.lineTo(sx + 16, sy - 19); ctx.stroke();

    // Tabletop (isometric perspective)
    ctx.fillStyle = '#A1887F';
    ctx.beginPath();
    ctx.moveTo(sx - 16, sy - 14);
    ctx.lineTo(sx + 16, sy - 10);
    ctx.lineTo(sx + 16, sy - 6);
    ctx.lineTo(sx - 16, sy - 10);
    ctx.closePath(); ctx.fill();

    // Tablecloth (checkered pattern)
    const clothColors = ['#FFFFFF', '#E53935'];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = clothColors[(i + j) % 2];
        const cx = sx - 15 + i * 4;
        const cy = sy - 14 + j * 4 + (i * 0.25);
        ctx.fillRect(cx, cy, 3.5, 3.5);
      }
    }

    // Food items on table
    // Plate
    ctx.fillStyle = '#ECEFF1';
    ctx.beginPath(); ctx.ellipse(sx - 4, sy - 12, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
    // Sandwich
    ctx.fillStyle = '#FFCC80';
    ctx.fillRect(sx - 6, sy - 14, 4, 2);
    ctx.fillStyle = '#8BC34A';
    ctx.fillRect(sx - 6, sy - 15, 4, 1);

    // Cup
    ctx.fillStyle = '#42A5F5';
    ctx.fillRect(sx + 4, sy - 14, 3, 4);
    ctx.fillStyle = '#2196F3';
    ctx.beginPath(); ctx.ellipse(sx + 5.5, sy - 14, 1.5, 0.8, 0, 0, Math.PI * 2); ctx.fill();

    // Basket
    ctx.fillStyle = '#8D6E63';
    ctx.beginPath();
    ctx.moveTo(sx + 10, sy - 10);
    ctx.lineTo(sx + 14, sy - 10);
    ctx.lineTo(sx + 13, sy - 15);
    ctx.lineTo(sx + 11, sy - 15);
    ctx.closePath(); ctx.fill();
    // Basket handle
    ctx.strokeStyle = '#6D4C41'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + 11, sy - 15);
    ctx.quadraticCurveTo(sx + 12, sy - 18, sx + 13, sy - 15);
    ctx.stroke();
  }, []);

  // ── Draw Lamp Post ──
  const drawLampPost = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number, now: number) => {
    // Post
    ctx.fillStyle = '#37474F';
    ctx.fillRect(sx - 2, sy - 40, 4, 40);
    // Base
    ctx.fillStyle = '#546E7A';
    ctx.beginPath(); ctx.ellipse(sx, sy, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    // Lamp head
    ctx.fillStyle = '#FFECB3';
    ctx.beginPath(); ctx.arc(sx, sy - 42, 6, 0, Math.PI * 2); ctx.fill();
    // Glow pulse
    const alpha = 0.2 + Math.sin(now / 1000) * 0.1;
    ctx.fillStyle = `rgba(255, 238, 88, ${alpha})`;
    ctx.beginPath(); ctx.arc(sx, sy - 42, 12, 0, Math.PI * 2); ctx.fill();
  }, []);

  // ── Draw Agent Character ──
  const drawAgent = useCallback((
    ctx: CanvasRenderingContext2D, agent: AgentData, sx: number, sy: number, isHovered: boolean, isSelected: boolean,
  ) => {
    const appearance = typeof agent.appearance === 'string' ? JSON.parse(agent.appearance) : agent.appearance;
    const color = appearance.color || '#FFD93D';
    const variant = appearance.variant || 'lobster-bot';
    const now = Date.now();

    // Derived colors used across all variants
    const dk1 = darkenColor(color, 0.3);
    const dk2 = darkenColor(color, 0.15);
    const lt1 = lightenColor(color, 0.3);
    const lt2 = lightenColor(color, 0.5);
    const lt3 = lightenColor(color, 0.15);

    // ── Double-layer shadow ──
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 3, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 2, 10, 5, 0, 0, Math.PI * 2); ctx.fill();

    // ── Selection ring ──
    if (isSelected || isHovered) {
      ctx.strokeStyle = isSelected ? '#00ff88' : '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 14, 7, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // ══════════════════════════════════════════════
    //   PRE-BODY ACCESSORIES (render behind body)
    // ══════════════════════════════════════════════
    if (appearance.accessory === 'butterfly') {
      // ── Butterfly Wings: Fairy-like translucent wings (behind body) ──
      // Left wing (top)
      ctx.fillStyle = 'rgba(180,100,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy - 10);
      ctx.bezierCurveTo(sx - 18, sy - 18, sx - 20, sy - 2, sx - 4, sy - 6);
      ctx.closePath(); ctx.fill();
      // Left wing (bottom)
      ctx.fillStyle = 'rgba(140,80,220,0.35)';
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy - 4);
      ctx.bezierCurveTo(sx - 14, sy - 2, sx - 14, sy + 8, sx - 4, sy + 2);
      ctx.closePath(); ctx.fill();
      // Right wing (top)
      ctx.fillStyle = 'rgba(180,100,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy - 10);
      ctx.bezierCurveTo(sx + 18, sy - 18, sx + 20, sy - 2, sx + 4, sy - 6);
      ctx.closePath(); ctx.fill();
      // Right wing (bottom)
      ctx.fillStyle = 'rgba(140,80,220,0.35)';
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy - 4);
      ctx.bezierCurveTo(sx + 14, sy - 2, sx + 14, sy + 8, sx + 4, sy + 2);
      ctx.closePath(); ctx.fill();
      // Wing patterns (circles)
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(sx - 12, sy - 10, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 12, sy - 10, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx - 10, sy, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 10, sy, 1.5, 0, Math.PI * 2); ctx.fill();
      // Wing edges
      ctx.strokeStyle = 'rgba(150,80,200,0.5)'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy - 10);
      ctx.bezierCurveTo(sx - 18, sy - 18, sx - 20, sy - 2, sx - 4, sy - 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy - 10);
      ctx.bezierCurveTo(sx + 18, sy - 18, sx + 20, sy - 2, sx + 4, sy - 6);
      ctx.stroke();
    }
    if (appearance.accessory === 'wings') {
      // ── Wings: Small fairy/angel wings on back (behind body) ──
      // Left wing
      ctx.fillStyle = 'rgba(200,230,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy - 10);
      ctx.bezierCurveTo(sx - 20, sy - 20, sx - 22, sy - 4, sx - 4, sy - 4);
      ctx.closePath(); ctx.fill();
      // Left wing inner
      ctx.fillStyle = 'rgba(220,240,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 9);
      ctx.bezierCurveTo(sx - 16, sy - 16, sx - 17, sy - 5, sx - 5, sy - 5);
      ctx.closePath(); ctx.fill();
      // Right wing
      ctx.fillStyle = 'rgba(200,230,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy - 10);
      ctx.bezierCurveTo(sx + 20, sy - 20, sx + 22, sy - 4, sx + 4, sy - 4);
      ctx.closePath(); ctx.fill();
      // Right wing inner
      ctx.fillStyle = 'rgba(220,240,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(sx + 5, sy - 9);
      ctx.bezierCurveTo(sx + 16, sy - 16, sx + 17, sy - 5, sx + 5, sy - 5);
      ctx.closePath(); ctx.fill();
      // Wing shimmer dots
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(sx - 14, sy - 12, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 14, sy - 12, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx - 10, sy - 6, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 10, sy - 6, 0.8, 0, Math.PI * 2); ctx.fill();
      // Wing outlines
      ctx.strokeStyle = 'rgba(180,210,240,0.4)'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy - 10);
      ctx.bezierCurveTo(sx - 20, sy - 20, sx - 22, sy - 4, sx - 4, sy - 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy - 10);
      ctx.bezierCurveTo(sx + 20, sy - 20, sx + 22, sy - 4, sx + 4, sy - 4);
      ctx.stroke();
    }

    // ══════════════════════════════════════════════
    //   VARIANT-SPECIFIC BODY
    // ══════════════════════════════════════════════

    if (variant === 'lobster-bot') {
      // ── Lobster-Bot: Blob-style translucent carapace ──

      // Antennae (behind body, soft)
      ctx.strokeStyle = dk2; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(sx - 4, sy - 22); ctx.quadraticCurveTo(sx - 10, sy - 32, sx - 13, sy - 35); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 4, sy - 22); ctx.quadraticCurveTo(sx + 10, sy - 32, sx + 13, sy - 35); ctx.stroke();
      // Antenna tips
      ctx.fillStyle = dk1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(sx - 13, sy - 35, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 13, sy - 35, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // ── Main body (translucent) ──
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 11, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Inner glow layers
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.ellipse(sx - 1, sy - 10, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Pulsing carapace markings
      const shellPulse1 = 0.1 + Math.sin(now / 2000) * 0.1;
      const shellPulse2 = 0.1 + Math.sin(now / 2000 + 1) * 0.1;
      ctx.strokeStyle = dk2; ctx.lineWidth = 0.8;
      ctx.globalAlpha = shellPulse1;
      ctx.beginPath(); ctx.arc(sx, sy - 9, 8, Math.PI + 0.4, -0.4); ctx.stroke();
      ctx.globalAlpha = shellPulse2;
      ctx.beginPath(); ctx.arc(sx, sy - 9, 5, Math.PI + 0.6, -0.6); ctx.stroke();
      ctx.globalAlpha = 1;

      // Soft outline
      ctx.strokeStyle = darkenColor(color, 0.15); ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 11, 12, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      // ── Simplified claws (single soft path each, animated sway) ──
      const clawSway = Math.sin(now / 1200) * 1.5;
      // Left claw
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.moveTo(sx - 11, sy - 6);
      ctx.quadraticCurveTo(sx - 18 + clawSway, sy - 10, sx - 16 + clawSway, sy - 5);
      ctx.quadraticCurveTo(sx - 18 + clawSway, sy, sx - 11, sy - 4);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(sx - 15 + clawSway, sy - 7, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Right claw
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.moveTo(sx + 11, sy - 6);
      ctx.quadraticCurveTo(sx + 18 - clawSway, sy - 10, sx + 16 - clawSway, sy - 5);
      ctx.quadraticCurveTo(sx + 18 - clawSway, sy, sx + 11, sy - 4);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(sx + 15 - clawSway, sy - 7, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // ── Leg nubs (blob-style) ──
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(sx - 5, sy + 2, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 5, sy + 2, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(sx - 5, sy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 5, sy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

    } else if (variant === 'moltlet') {
      // ── Moltlet: Blob-style warm, round, breathing ──

      const breathe = Math.sin(now / 1800) * 0.8;
      const bodyY = sy - 9 + breathe;
      const armBob = Math.sin(now / 700) * 1.2;

      // Warm underglow (pulsing)
      const warmPulse = 0.08 + Math.sin(now / 1800) * 0.04;
      ctx.fillStyle = lt1; ctx.globalAlpha = warmPulse;
      ctx.beginPath(); ctx.ellipse(sx, bodyY + 10, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Main body (translucent, perfectly round)
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(sx, bodyY, 11, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Inner glow layers
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(sx, bodyY, 8, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.ellipse(sx - 1, bodyY - 1, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Cheek warmth (derived, pulsing)
      const cheekGlow = 0.25 + Math.sin(now / 2500) * 0.08;
      ctx.fillStyle = lt1; ctx.globalAlpha = cheekGlow;
      ctx.beginPath(); ctx.arc(sx - 8, bodyY, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 8, bodyY, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Soft outline
      ctx.strokeStyle = darkenColor(color, 0.15); ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, bodyY, 11, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      // Nub arms (blob-style, bobbing)
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.ellipse(sx - 12, bodyY + 2 + armBob, 3, 4, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 12, bodyY + 2 - armBob, 3, 4, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(sx - 11, bodyY + 1 + armBob, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 11, bodyY + 1 - armBob, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Feet nubs
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(sx - 5, sy + 2, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 5, sy + 2, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(sx - 5, sy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 5, sy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

    } else if (variant === 'blob') {
      // ── Blob: Translucent, jiggly, glowing ──

      // Base puddle
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 13, 4, 0, 0, Math.PI * 2); ctx.fill();

      // Drips at bottom edge
      const dripPhase = now / 1500;
      ctx.fillStyle = darkenColor(color, 0.05);
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(sx - 6, sy + 2 + Math.sin(dripPhase) * 1.5, 2, 3 + Math.sin(dripPhase) * 1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 4, sy + 3 + Math.sin(dripPhase + 2) * 1, 1.5, 2.5 + Math.sin(dripPhase + 1) * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Main body (translucent)
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(sx, sy - 8, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Inner glow layers (bright center)
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(sx, sy - 8, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.ellipse(sx - 1, sy - 9, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Floating particles inside
      ctx.fillStyle = lightenColor(color, 0.6);
      for (let i = 0; i < 4; i++) {
        const px = sx - 5 + Math.sin(now / 2000 + i * 1.8) * 5;
        const py = sy - 10 + Math.cos(now / 2500 + i * 2.1) * 4;
        const pr = 1 + Math.sin(now / 1800 + i) * 0.5;
        ctx.globalAlpha = 0.5 + Math.sin(now / 1500 + i * 1.3) * 0.2;
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Soft outline (semi-transparent)
      ctx.strokeStyle = darkenColor(color, 0.15); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, sy - 8, 12, 10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      // ── Jiggly nubs with highlights ──
      const nubBob = Math.sin(now / 600) * 1.5;
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.ellipse(sx - 12, sy - 4 + nubBob, 3.5, 4.5, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 12, sy - 4 - nubBob, 3.5, 4.5, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(sx - 11, sy - 5 + nubBob, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 11, sy - 5 - nubBob, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

    } else if (variant === 'bunny') {
      // ── Bunny: Blob-style with tall ears, hop animation ──

      const twitchGate = Math.max(0, Math.sin(now / 3000));
      const earTwitch = Math.sin(now / 800) * 0.08 * twitchGate;
      const hop = Math.abs(Math.sin(now / 1000)) * 1.5;
      const bodyY = sy - 9 - hop;

      // Cotton tail (behind body, single soft ellipse)
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(sx + 9, bodyY + 8, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lightenColor(color, 0.6); ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(sx + 8.5, bodyY + 7, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Ears (behind body, soft translucent)
      ctx.fillStyle = color; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.ellipse(sx - 6, bodyY - 19, 3.5, 9, 0.15 + earTwitch, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 6, bodyY - 19, 3.5, 9, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Inner ear (derived color)
      ctx.fillStyle = lt1; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.ellipse(sx - 6, bodyY - 19, 1.5, 6, 0.15 + earTwitch, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 6, bodyY - 19, 1.5, 6, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Ear soft outlines
      ctx.strokeStyle = darkenColor(color, 0.15); ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(sx - 6, bodyY - 19, 3.5, 9, 0.15 + earTwitch, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(sx + 6, bodyY - 19, 3.5, 9, -0.15, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      // Main body (translucent)
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(sx, bodyY, 10, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Inner glow layers
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(sx, bodyY, 7, 7.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.ellipse(sx - 1, bodyY - 1, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Soft outline
      ctx.strokeStyle = darkenColor(color, 0.15); ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, bodyY, 10, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      // Nub paws (blob-style)
      const pawBob = Math.sin(now / 800) * 0.8;
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.ellipse(sx - 11, bodyY + 3 + pawBob, 3, 4, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 11, bodyY + 3 - pawBob, 3, 4, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(sx - 10, bodyY + 2 + pawBob, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 10, bodyY + 2 - pawBob, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Feet nubs
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(sx - 5, sy + 2, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 5, sy + 2, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(sx - 5, sy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 5, sy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

    } else if (variant === 'catbot') {
      // ── Catbot: Blob-style with tail swish, whisker twitch ──

      const tailSwish = Math.sin(now / 1000) * 6;
      const whiskerTwitchL = Math.sin(now / 600) * 0.8;
      const whiskerTwitchR = Math.sin(now / 600 + Math.PI) * 0.8;

      // Tail (behind body, single soft bezier stroke, animated)
      ctx.strokeStyle = dk2; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx + 9, sy - 3);
      ctx.bezierCurveTo(sx + 15, sy - 6, sx + 20 + tailSwish * 0.5, sy - 14, sx + 16 + tailSwish, sy - 20);
      ctx.stroke();
      // Tail tip
      ctx.fillStyle = dk1; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(sx + 16 + tailSwish, sy - 20, 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Pointed ears (behind body, soft)
      ctx.fillStyle = color; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(sx - 10, sy - 19); ctx.lineTo(sx - 6, sy - 32); ctx.lineTo(sx - 1, sy - 19); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx + 1, sy - 19); ctx.lineTo(sx + 6, sy - 32); ctx.lineTo(sx + 10, sy - 19); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      // Inner ear (derived)
      ctx.fillStyle = lt1; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.moveTo(sx - 8, sy - 20); ctx.lineTo(sx - 6, sy - 29); ctx.lineTo(sx - 3, sy - 20); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx + 3, sy - 20); ctx.lineTo(sx + 6, sy - 29); ctx.lineTo(sx + 8, sy - 20); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      // Ear soft outlines
      ctx.strokeStyle = darkenColor(color, 0.15); ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.moveTo(sx - 10, sy - 19); ctx.lineTo(sx - 6, sy - 32); ctx.lineTo(sx - 1, sy - 19); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 1, sy - 19); ctx.lineTo(sx + 6, sy - 32); ctx.lineTo(sx + 10, sy - 19); ctx.stroke();
      ctx.globalAlpha = 1;

      // Main body (translucent, slightly sleeker)
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 10, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Inner glow layers
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.ellipse(sx - 1, sy - 10, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Soft outline
      ctx.strokeStyle = darkenColor(color, 0.15); ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 10, 12, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      // Whiskers (short, soft, twitching)
      ctx.strokeStyle = dk2; ctx.lineWidth = 0.6; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(sx - 9, sy - 8); ctx.lineTo(sx - 16, sy - 9 + whiskerTwitchL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 9, sy - 6); ctx.lineTo(sx - 15, sy - 5 + whiskerTwitchL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 9, sy - 8); ctx.lineTo(sx + 16, sy - 9 + whiskerTwitchR); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 9, sy - 6); ctx.lineTo(sx + 15, sy - 5 + whiskerTwitchR); ctx.stroke();
      ctx.globalAlpha = 1;

      // Nub paws (blob-style)
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.ellipse(sx - 11, sy - 2, 3, 4, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 11, sy - 2, 3, 4, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(sx - 10, sy - 3, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 10, sy - 3, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Feet nubs
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(sx - 5, sy + 2, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 5, sy + 2, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(sx - 5, sy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 5, sy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

    } else {
      // ── Default / Unknown: blob-style moltlet ──
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 10, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 7, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt2; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.ellipse(sx - 1, sy - 10, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = darkenColor(color, 0.15); ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, sy - 9, 10, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      // Nub arms
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.ellipse(sx - 12, sy - 5, 3, 4, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 12, sy - 5, 3, 4, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Feet
      ctx.fillStyle = dk2; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(sx - 5, sy + 2, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 5, sy + 2, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ══════════════════════════════════════════════
    //   SHARED FACE (Eyes, Nose, Mouth)
    // ══════════════════════════════════════════════

    const eyeY = sy - 14;
    const eyeSpacing = 5;
    const isCat = variant === 'catbot';
    const dirOff = ({ ne: { x: 1, y: -1 }, nw: { x: -1, y: -1 }, se: { x: 1, y: 1 }, sw: { x: -1, y: 1 } } as Record<string, { x: number; y: number }>)[agent.direction] || { x: 0, y: 0 };

    // ── Eyes: sclera (larger) ──
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(sx - eyeSpacing, eyeY, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx + eyeSpacing, eyeY, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();

    // ── Iris ring (colored, derived from body) ──
    const irisColor = darkenColor(color, 0.05);
    if (isCat) {
      // Cat: golden-green iris
      ctx.fillStyle = '#8fa840';
      ctx.beginPath(); ctx.ellipse(sx - eyeSpacing + dirOff.x * 0.8, eyeY + dirOff.y * 0.4, 2.2, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + eyeSpacing + dirOff.x * 0.8, eyeY + dirOff.y * 0.4, 2.2, 3, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = irisColor;
      ctx.beginPath(); ctx.arc(sx - eyeSpacing + dirOff.x * 0.8, eyeY + dirOff.y * 0.4, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + eyeSpacing + dirOff.x * 0.8, eyeY + dirOff.y * 0.4, 2.8, 0, Math.PI * 2); ctx.fill();
    }

    // ── Pupils ──
    ctx.fillStyle = '#1a1a2e';
    if (isCat) {
      ctx.beginPath(); ctx.ellipse(sx - eyeSpacing + dirOff.x * 0.8, eyeY + dirOff.y * 0.4, 1, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + eyeSpacing + dirOff.x * 0.8, eyeY + dirOff.y * 0.4, 1, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(sx - eyeSpacing + dirOff.x * 0.8, eyeY + dirOff.y * 0.4, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + eyeSpacing + dirOff.x * 0.8, eyeY + dirOff.y * 0.4, 1.8, 0, Math.PI * 2); ctx.fill();
    }

    // ── Eye shine (double highlight) ──
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(sx - eyeSpacing + 1.2, eyeY - 1.2, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + eyeSpacing + 1.2, eyeY - 1.2, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx - eyeSpacing - 0.8, eyeY + 0.8, 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + eyeSpacing - 0.8, eyeY + 0.8, 0.7, 0, Math.PI * 2); ctx.fill();

    // ── Eyelid line ──
    ctx.strokeStyle = dk2; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(sx - eyeSpacing, eyeY, 4, Math.PI + 0.5, -0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 4, Math.PI + 0.5, -0.5); ctx.stroke();

    // ── Nose ──
    const noseY = sy - 9;
    if (isCat) {
      // Cat nose: inverted triangle (derived color)
      ctx.fillStyle = lt1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(sx - 1.5, noseY); ctx.lineTo(sx + 1.5, noseY); ctx.lineTo(sx, noseY + 2); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (variant === 'bunny') {
      // Bunny nose: small oval (derived color)
      ctx.fillStyle = lt1; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, noseY + 1, 2, 1.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // Others: tiny dot
      ctx.fillStyle = dk1;
      ctx.beginPath(); ctx.arc(sx, noseY + 1, 1, 0, Math.PI * 2); ctx.fill();
    }

    // ── Mouth & Expressions ──
    const mouthY = sy - 6;
    ctx.lineCap = 'round';
    if (agent.mood === 'happy') {
      // Wide smile with tongue peek
      ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, mouthY - 2, 3.5, 0.15, Math.PI - 0.15); ctx.stroke();
      // Tiny tongue
      ctx.fillStyle = '#ff8a9a';
      ctx.beginPath(); ctx.arc(sx, mouthY, 1.5, 0, Math.PI); ctx.fill();
    } else if (agent.mood === 'excited') {
      // Open smile with teeth
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath(); ctx.arc(sx, mouthY - 1, 3.5, 0.1, Math.PI - 0.1); ctx.fill();
      // Teeth
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - 2, mouthY - 1, 1.5, 2);
      ctx.fillRect(sx + 0.5, mouthY - 1, 1.5, 2);
    } else if (agent.mood === 'sad') {
      // Wobbly frown
      ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, mouthY + 2.5, 3, Math.PI + 0.3, -0.3); ctx.stroke();
      // Tear drop on left eye
      ctx.fillStyle = 'rgba(100,180,255,0.6)';
      ctx.beginPath(); ctx.ellipse(sx - eyeSpacing - 2, eyeY + 5, 1, 2, 0.2, 0, Math.PI * 2); ctx.fill();
    } else {
      // Neutral: slight curve (not flat)
      ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(sx - 3, mouthY); ctx.quadraticCurveTo(sx, mouthY + 1, sx + 3, mouthY); ctx.stroke();
    }

    // Bunny buck teeth
    if (variant === 'bunny' && agent.mood !== 'excited') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.roundRect(sx - 1.5, mouthY - 1, 1.5, 2.5, 0.5); ctx.fill();
      ctx.beginPath(); ctx.roundRect(sx + 0, mouthY - 1, 1.5, 2.5, 0.5); ctx.fill();
    }

    // ══════════════════════════════════════════════
    //   HATS (preserved, positions adjusted)
    // ══════════════════════════════════════════════
    const hasEars = variant === 'bunny' || variant === 'catbot';
    if (appearance.hat === 'tophat') {
      // ── Top Hat: Glossy silk with ribbon ──
      // Brim (wider, with depth)
      ctx.fillStyle = '#0e0e1e';
      ctx.beginPath(); ctx.ellipse(sx, sy - 22, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      // Hat body
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath(); ctx.roundRect(sx - 6, sy - 40, 12, 18, [2, 2, 0, 0]); ctx.fill();
      // Top of hat
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath(); ctx.ellipse(sx, sy - 40, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      // Silk sheen (left highlight)
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.roundRect(sx - 5, sy - 39, 4, 16, 2); ctx.fill();
      // Hat band (rich satin ribbon)
      ctx.fillStyle = '#8b2252';
      ctx.fillRect(sx - 6, sy - 28, 12, 3);
      ctx.fillStyle = '#a0336a';
      ctx.fillRect(sx - 6, sy - 28, 12, 1.5);
      // Brim highlight
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.ellipse(sx, sy - 22.5, 9, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      // Brim outline
      ctx.strokeStyle = '#0a0a18'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(sx, sy - 22, 11, 4.5, 0, 0, Math.PI); ctx.stroke();

    } else if (appearance.hat === 'crown') {
      // ── Crown: Ornate golden with jewels and velvet ──
      // Crown base (velvet interior visible)
      ctx.fillStyle = '#8b1a1a';
      ctx.beginPath(); ctx.roundRect(sx - 8, sy - 25, 16, 4, 1); ctx.fill();
      // Gold frame
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 25); ctx.lineTo(sx - 8, sy - 32); ctx.lineTo(sx - 5, sy - 28);
      ctx.lineTo(sx - 2, sy - 34); ctx.lineTo(sx, sy - 29); ctx.lineTo(sx + 2, sy - 34);
      ctx.lineTo(sx + 5, sy - 28); ctx.lineTo(sx + 8, sy - 32); ctx.lineTo(sx + 8, sy - 25);
      ctx.closePath(); ctx.fill();
      // Gold highlight (lighter left side)
      ctx.fillStyle = '#ffe44d';
      ctx.beginPath();
      ctx.moveTo(sx - 7, sy - 25); ctx.lineTo(sx - 7, sy - 31); ctx.lineTo(sx - 5, sy - 28);
      ctx.lineTo(sx - 2, sy - 33); ctx.lineTo(sx - 1, sy - 28); ctx.lineTo(sx - 1, sy - 25);
      ctx.closePath(); ctx.fill();
      // Outline
      ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 25); ctx.lineTo(sx - 8, sy - 32); ctx.lineTo(sx - 5, sy - 28);
      ctx.lineTo(sx - 2, sy - 34); ctx.lineTo(sx, sy - 29); ctx.lineTo(sx + 2, sy - 34);
      ctx.lineTo(sx + 5, sy - 28); ctx.lineTo(sx + 8, sy - 32); ctx.lineTo(sx + 8, sy - 25);
      ctx.stroke();
      // Point orbs
      ctx.fillStyle = '#FFD700';
      ctx.beginPath(); ctx.arc(sx - 8, sy - 32, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx - 2, sy - 34, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 2, sy - 34, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 8, sy - 32, 1.5, 0, Math.PI * 2); ctx.fill();
      // Center ruby (large)
      ctx.fillStyle = '#cc1111';
      ctx.beginPath(); ctx.ellipse(sx, sy - 26, 2, 1.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,100,100,0.5)';
      ctx.beginPath(); ctx.arc(sx - 0.5, sy - 26.5, 0.8, 0, Math.PI * 2); ctx.fill();
      // Side sapphires
      ctx.fillStyle = '#2255cc';
      ctx.beginPath(); ctx.arc(sx - 5, sy - 26, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 5, sy - 26, 1, 0, Math.PI * 2); ctx.fill();
      // Sapphire shines
      ctx.fillStyle = 'rgba(100,150,255,0.5)';
      ctx.beginPath(); ctx.arc(sx - 5.3, sy - 26.3, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 4.7, sy - 26.3, 0.4, 0, Math.PI * 2); ctx.fill();

    } else if (appearance.hat === 'flower' && !hasEars) {
      // ── Flower: Multi-petal with stem and leaves ──
      const fx = sx + 5, fy = sy - 22;
      // Stem
      ctx.strokeStyle = '#3d8b37'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fx, fy + 4); ctx.quadraticCurveTo(fx + 2, fy + 2, fx, fy); ctx.stroke();
      // Leaves
      ctx.fillStyle = '#4CAF50';
      ctx.beginPath(); ctx.ellipse(fx + 3, fy + 2, 3, 1.2, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#66BB6A';
      ctx.beginPath(); ctx.ellipse(fx + 2.5, fy + 1.5, 2, 0.8, 0.5, 0, Math.PI * 2); ctx.fill();
      // Leaf vein
      ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.moveTo(fx + 1.5, fy + 2); ctx.lineTo(fx + 4.5, fy + 2); ctx.stroke();
      // Outer petals (5 petals in circle)
      ctx.fillStyle = '#ff6b8a';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath(); ctx.ellipse(fx + Math.cos(a) * 3, fy + Math.sin(a) * 3, 2.5, 1.8, a, 0, Math.PI * 2); ctx.fill();
      }
      // Inner petals highlight
      ctx.fillStyle = '#ff8fa6';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath(); ctx.ellipse(fx + Math.cos(a) * 2, fy + Math.sin(a) * 2, 1.5, 1, a, 0, Math.PI * 2); ctx.fill();
      }
      // Center (pollen)
      ctx.fillStyle = '#ffe066';
      ctx.beginPath(); ctx.arc(fx, fy, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath(); ctx.arc(fx - 0.5, fy - 0.5, 1.5, 0, Math.PI * 2); ctx.fill();
      // Tiny pollen dots
      ctx.fillStyle = '#e6a800';
      ctx.beginPath(); ctx.arc(fx + 0.8, fy + 0.5, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(fx - 0.5, fy + 0.8, 0.4, 0, Math.PI * 2); ctx.fill();

    } else if (appearance.hat === 'cap') {
      // ── Baseball Cap: Structured with stitching and emblem ──
      // Cap dome
      ctx.fillStyle = '#3558b8';
      ctx.beginPath(); ctx.arc(sx, sy - 23, 9, Math.PI, 0); ctx.fill();
      // Cap body (front panel slightly lighter)
      ctx.fillStyle = '#4169E1';
      ctx.beginPath(); ctx.arc(sx, sy - 23, 8.5, Math.PI + 0.2, -0.2); ctx.fill();
      // Brim (extends forward)
      ctx.fillStyle = '#3558b8';
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy - 22); ctx.quadraticCurveTo(sx, sy - 19, sx + 12, sy - 22);
      ctx.lineTo(sx + 11, sy - 23); ctx.lineTo(sx - 8, sy - 23); ctx.closePath(); ctx.fill();
      // Brim underside (darker)
      ctx.fillStyle = '#2a4590';
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 22); ctx.quadraticCurveTo(sx + 2, sy - 20, sx + 11, sy - 22);
      ctx.lineTo(sx + 10, sy - 22.5); ctx.lineTo(sx - 7, sy - 22.5); ctx.closePath(); ctx.fill();
      // Stitching lines
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(sx, sy - 31); ctx.lineTo(sx, sy - 23); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy - 23, 7, Math.PI + 0.3, -0.3); ctx.stroke();
      // Top button
      ctx.fillStyle = '#5179F1';
      ctx.beginPath(); ctx.arc(sx, sy - 31, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath(); ctx.arc(sx - 0.3, sy - 31.3, 0.7, 0, Math.PI * 2); ctx.fill();
      // Small emblem (star)
      ctx.fillStyle = '#FFD700';
      ctx.beginPath(); ctx.arc(sx + 2, sy - 26, 1.5, 0, Math.PI * 2); ctx.fill();

    } else if (appearance.hat === 'antenna') {
      // ── Antenna: Robot antenna with energy orb ──
      // Base plate on head
      ctx.fillStyle = '#666';
      ctx.beginPath(); ctx.ellipse(sx, sy - 22, 4, 1.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#888';
      ctx.beginPath(); ctx.ellipse(sx, sy - 22.5, 3, 1, 0, 0, Math.PI * 2); ctx.fill();
      // Antenna stalk (metallic)
      ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy - 23); ctx.lineTo(sx, sy - 35); ctx.stroke();
      ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx - 0.5, sy - 23); ctx.lineTo(sx - 0.5, sy - 35); ctx.stroke();
      // Joint rings
      ctx.fillStyle = '#777';
      ctx.beginPath(); ctx.ellipse(sx, sy - 28, 2, 0.8, 0, 0, Math.PI * 2); ctx.fill();
      // Energy orb (pulsing glow)
      const antPulse = 0.7 + Math.sin(now / 500) * 0.3;
      ctx.fillStyle = `rgba(255,68,68,${0.15 * antPulse})`;
      ctx.beginPath(); ctx.arc(sx, sy - 36, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,68,68,${0.3 * antPulse})`;
      ctx.beginPath(); ctx.arc(sx, sy - 36, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff4444';
      ctx.beginPath(); ctx.arc(sx, sy - 36, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff8888';
      ctx.beginPath(); ctx.arc(sx - 0.8, sy - 37, 1.2, 0, Math.PI * 2); ctx.fill();

    } else if (appearance.hat === 'beret') {
      // ── Beret: Flat French beret, droops to one side ──
      // Flat disc body (wide, thin — sits on top of head)
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.ellipse(sx + 1, sy - 20, 12, 3, 0.1, 0, Math.PI * 2); ctx.fill();
      // Slight puff on top (very flat, offset to the right for droop)
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.ellipse(sx + 3, sy - 22, 9, 2.5, 0.1, 0, Math.PI * 2); ctx.fill();
      // Highlight on top
      ctx.fillStyle = '#d44940';
      ctx.beginPath(); ctx.ellipse(sx + 2, sy - 22.5, 5, 1.8, 0.1, 0, Math.PI * 2); ctx.fill();
      // Small nub (stem) on top center
      ctx.fillStyle = '#a83228';
      ctx.beginPath(); ctx.arc(sx, sy - 23.5, 1.5, 0, Math.PI * 2); ctx.fill();
      // Fabric texture
      ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.moveTo(sx - 6, sy - 21); ctx.quadraticCurveTo(sx + 2, sy - 23.5, sx + 8, sy - 21); ctx.stroke();
      // Thin band at base
      ctx.strokeStyle = '#8b2020'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.ellipse(sx + 1, sy - 20, 12, 3, 0.1, 0, Math.PI * 2); ctx.stroke();

    } else if (appearance.hat === 'wizard') {
      // ── Wizard Hat: Starry pointed hat with brim ──
      // Brim (wide, dark)
      ctx.fillStyle = '#4a2370';
      ctx.beginPath(); ctx.ellipse(sx, sy - 22, 13, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      // Brim highlight
      ctx.fillStyle = '#5a2d85';
      ctx.beginPath(); ctx.ellipse(sx - 1, sy - 22.5, 10, 2, 0, 0, Math.PI * 2); ctx.fill();
      // Cone body
      ctx.fillStyle = '#6c3483';
      ctx.beginPath(); ctx.moveTo(sx - 10, sy - 22); ctx.quadraticCurveTo(sx - 3, sy - 30, sx + 2, sy - 44);
      ctx.quadraticCurveTo(sx + 5, sy - 30, sx + 10, sy - 22); ctx.closePath(); ctx.fill();
      // Cone left highlight
      ctx.fillStyle = '#7d3e94';
      ctx.beginPath(); ctx.moveTo(sx - 8, sy - 22); ctx.quadraticCurveTo(sx - 2, sy - 30, sx + 1, sy - 42);
      ctx.lineTo(sx - 1, sy - 42); ctx.quadraticCurveTo(sx - 4, sy - 30, sx - 3, sy - 22); ctx.closePath(); ctx.fill();
      // Stars and moons
      ctx.fillStyle = '#f1c40f';
      // Big star (4-point)
      const starX = sx + 1, starY = sy - 31;
      ctx.beginPath();
      ctx.moveTo(starX, starY - 2.5); ctx.lineTo(starX + 1, starY - 0.5); ctx.lineTo(starX + 2.5, starY);
      ctx.lineTo(starX + 1, starY + 0.5); ctx.lineTo(starX, starY + 2.5); ctx.lineTo(starX - 1, starY + 0.5);
      ctx.lineTo(starX - 2.5, starY); ctx.lineTo(starX - 1, starY - 0.5); ctx.closePath(); ctx.fill();
      // Small stars
      ctx.beginPath(); ctx.arc(sx - 4, sy - 27, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 4, sy - 36, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx - 2, sy - 38, 0.8, 0, Math.PI * 2); ctx.fill();
      // Crescent moon
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath(); ctx.arc(sx + 5, sy - 26, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6c3483';
      ctx.beginPath(); ctx.arc(sx + 5.8, sy - 26.5, 1.5, 0, Math.PI * 2); ctx.fill();
      // Brim outline
      ctx.strokeStyle = '#3d1a5c'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(sx, sy - 22, 13, 3.5, 0, 0, Math.PI); ctx.stroke();
      // Tip glow
      ctx.fillStyle = 'rgba(241,196,15,0.3)';
      ctx.beginPath(); ctx.arc(sx + 2, sy - 44, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath(); ctx.arc(sx + 2, sy - 44, 1.5, 0, Math.PI * 2); ctx.fill();

    } else if (appearance.hat === 'headband') {
      // ── Headband: Athletic with sweatband texture ──
      // Main band (wraps around head)
      ctx.fillStyle = '#c0513e';
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 20); ctx.lineTo(sx + 10, sy - 20);
      ctx.lineTo(sx + 10, sy - 23); ctx.quadraticCurveTo(sx, sy - 24, sx - 10, sy - 23);
      ctx.closePath(); ctx.fill();
      // Fabric highlight
      ctx.fillStyle = '#e17055';
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy - 20.5); ctx.lineTo(sx + 9, sy - 20.5);
      ctx.lineTo(sx + 9, sy - 22); ctx.quadraticCurveTo(sx, sy - 22.5, sx - 9, sy - 22);
      ctx.closePath(); ctx.fill();
      // Texture lines
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.4;
      for (let i = -8; i <= 8; i += 2) {
        ctx.beginPath(); ctx.moveTo(sx + i, sy - 20); ctx.lineTo(sx + i, sy - 23); ctx.stroke();
      }
      // Knot tails (side)
      ctx.fillStyle = '#e17055';
      ctx.beginPath();
      ctx.moveTo(sx + 10, sy - 21); ctx.quadraticCurveTo(sx + 14, sy - 19, sx + 16, sy - 17);
      ctx.quadraticCurveTo(sx + 13, sy - 18, sx + 10, sy - 20); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx + 10, sy - 22); ctx.quadraticCurveTo(sx + 15, sy - 22, sx + 17, sy - 20);
      ctx.quadraticCurveTo(sx + 13, sy - 21, sx + 10, sy - 21); ctx.closePath(); ctx.fill();
      // Band outline
      ctx.strokeStyle = '#a04030'; ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 20); ctx.lineTo(sx + 10, sy - 20);
      ctx.lineTo(sx + 10, sy - 23); ctx.quadraticCurveTo(sx, sy - 24, sx - 10, sy - 23);
      ctx.closePath(); ctx.stroke();
    } else if (appearance.hat === 'halo') {
      // ── Halo: Glowing golden ring floating above head ──
      const haloY = sy - 27;
      // Outer glow (soft)
      ctx.strokeStyle = 'rgba(255,215,0,0.1)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(sx, haloY, 12, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
      // Mid glow
      ctx.strokeStyle = 'rgba(255,215,0,0.2)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(sx, haloY, 11, 3, 0, 0, Math.PI * 2); ctx.stroke();
      // Core ring
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(sx, haloY, 10, 3, 0, 0, Math.PI * 2); ctx.stroke();
      // Highlight (brighter top)
      ctx.strokeStyle = '#ffec80'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(sx, haloY, 9.5, 2.5, 0, Math.PI + 0.3, -0.3); ctx.stroke();
      // Sparkle points
      ctx.fillStyle = 'rgba(255,255,200,0.5)';
      ctx.beginPath(); ctx.arc(sx - 8, haloY - 1, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 7, haloY - 0.5, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx, haloY - 2.5, 0.8, 0, Math.PI * 2); ctx.fill();
    } else if (appearance.hat === 'straw_hat') {
      // ── Straw Hat: Wide round brim, flat top, red ribbon ──
      ctx.fillStyle = '#F5DEB3';
      ctx.beginPath(); ctx.ellipse(sx, sy - 21, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#faebd7';
      ctx.beginPath(); ctx.ellipse(sx - 2, sy - 21.5, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#F5DEB3';
      ctx.beginPath(); ctx.roundRect(sx - 7, sy - 31, 14, 10, [5, 5, 1, 1]); ctx.fill();
      ctx.fillStyle = '#faebd7';
      ctx.beginPath(); ctx.ellipse(sx, sy - 31, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(139,119,80,0.2)'; ctx.lineWidth = 0.5;
      for (let i = -5; i <= 5; i += 3) {
        ctx.beginPath(); ctx.moveTo(sx + i, sy - 30); ctx.lineTo(sx + i + 2, sy - 22); ctx.stroke();
      }
      for (let j = -28; j <= -22; j += 3) {
        ctx.beginPath(); ctx.moveTo(sx - 6, sy + j); ctx.lineTo(sx + 6, sy + j); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.ellipse(sx - 3, sy - 29, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cc3333';
      ctx.fillRect(sx - 7, sy - 23, 14, 2.5);
      ctx.fillStyle = '#e04444';
      ctx.fillRect(sx - 7, sy - 23, 14, 1.2);
      ctx.strokeStyle = '#b8a070'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(sx, sy - 21, 16, 5, 0, 0, Math.PI); ctx.stroke();

    } else if (appearance.hat === 'frog_hat') {
      // ── Frog Bucket Hat: bucket shape with frog eyes on top, face on front ──
      // Brim (wide, droopy)
      ctx.fillStyle = '#4CAF50';
      ctx.beginPath(); ctx.ellipse(sx, sy - 20, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
      // Crown (flat-topped bucket shape)
      ctx.fillStyle = '#4CAF50';
      ctx.beginPath(); ctx.roundRect(sx - 8, sy - 29, 16, 10, [3, 3, 0, 0]); ctx.fill();
      // Crown top
      ctx.fillStyle = '#5CBF60';
      ctx.beginPath(); ctx.ellipse(sx, sy - 29, 8, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.ellipse(sx - 2, sy - 27, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
      // Brim stitch lines
      ctx.strokeStyle = 'rgba(56,120,56,0.3)'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.ellipse(sx, sy - 20, 12, 3, 0, 0, Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(sx, sy - 20, 10, 2.2, 0, 0, Math.PI); ctx.stroke();
      // Frog eyes on top (small bumps)
      ctx.fillStyle = '#4CAF50';
      ctx.beginPath(); ctx.arc(sx - 4, sy - 30, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 4, sy - 30, 3, 0, Math.PI * 2); ctx.fill();
      // Eye pupils
      ctx.fillStyle = '#1a3a1a';
      ctx.beginPath(); ctx.arc(sx - 4, sy - 30, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 4, sy - 30, 1.5, 0, Math.PI * 2); ctx.fill();
      // Frog face on hat front: dot eyes, smile, blush
      ctx.fillStyle = '#1a3a1a';
      ctx.beginPath(); ctx.arc(sx - 2.5, sy - 24, 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 2.5, sy - 24, 0.6, 0, Math.PI * 2); ctx.fill();
      // Smile
      ctx.strokeStyle = '#1a3a1a'; ctx.lineWidth = 0.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(sx, sy - 22.5, 2.5, 0.2, Math.PI - 0.2); ctx.stroke();
      // Blush cheeks
      ctx.fillStyle = 'rgba(220,100,120,0.35)';
      ctx.beginPath(); ctx.ellipse(sx - 5, sy - 22.5, 1.8, 1.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 5, sy - 22.5, 1.8, 1.2, 0, 0, Math.PI * 2); ctx.fill();

    } else if (appearance.hat === 'viking') {
      // ── Viking Helmet: Round gray dome, curved horns (lowered) ──
      ctx.fillStyle = '#8a8a8a';
      ctx.beginPath(); ctx.arc(sx, sy - 21, 10, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#6a5a3a';
      ctx.beginPath(); ctx.roundRect(sx - 10, sy - 20, 20, 3, 1); ctx.fill();
      ctx.fillStyle = '#7a6a4a';
      ctx.fillRect(sx - 10, sy - 20, 20, 1.5);
      ctx.fillStyle = '#c0a870';
      ctx.beginPath(); ctx.arc(sx - 7, sy - 18.5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx, sy - 18.5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 7, sy - 18.5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a0a0a0';
      ctx.beginPath(); ctx.arc(sx, sy - 24, 6, Math.PI + 0.3, -0.3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.ellipse(sx - 2, sy - 25, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f5e6c8';
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 21); ctx.quadraticCurveTo(sx - 17, sy - 27, sx - 14, sy - 35);
      ctx.quadraticCurveTo(sx - 15, sy - 27, sx - 9, sy - 19); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(139,119,80,0.3)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(sx - 12, sy - 25); ctx.lineTo(sx - 10, sy - 24); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 13, sy - 29); ctx.lineTo(sx - 11, sy - 27); ctx.stroke();
      ctx.fillStyle = '#f5e6c8';
      ctx.beginPath();
      ctx.moveTo(sx + 10, sy - 21); ctx.quadraticCurveTo(sx + 17, sy - 27, sx + 14, sy - 35);
      ctx.quadraticCurveTo(sx + 15, sy - 27, sx + 9, sy - 19); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(139,119,80,0.3)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(sx + 12, sy - 25); ctx.lineTo(sx + 10, sy - 24); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 13, sy - 29); ctx.lineTo(sx + 11, sy - 27); ctx.stroke();
      ctx.strokeStyle = '#666'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(sx, sy - 21, 10, Math.PI, 0); ctx.stroke();

    } else if (appearance.hat === 'pirate') {
      // ── Pirate Hat: Simplified cute tricorn, skull emblem ──
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.moveTo(sx - 14, sy - 22); ctx.quadraticCurveTo(sx - 8, sy - 38, sx, sy - 36);
      ctx.quadraticCurveTo(sx + 8, sy - 38, sx + 14, sy - 22);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx, sy - 22, 14, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath(); ctx.arc(sx - 12, sy - 23, 3, 0, Math.PI, true); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 12, sy - 23, 3, 0, Math.PI, true); ctx.fill();
      ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - 13, sy - 22); ctx.quadraticCurveTo(sx - 8, sy - 37, sx, sy - 35);
      ctx.quadraticCurveTo(sx + 8, sy - 37, sx + 13, sy - 22);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(sx, sy - 28, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(sx - 2, sy - 26, 4, 2.5, 1); ctx.fill();
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath(); ctx.arc(sx - 1.2, sy - 29, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 1.2, sy - 29, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx - 3, sy - 25); ctx.lineTo(sx + 3, sy - 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 3, sy - 25); ctx.lineTo(sx - 3, sy - 22); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 22); ctx.quadraticCurveTo(sx - 5, sy - 35, sx - 1, sy - 34);
      ctx.lineTo(sx - 3, sy - 34); ctx.quadraticCurveTo(sx - 7, sy - 33, sx - 6, sy - 22);
      ctx.closePath(); ctx.fill();

    } else if (appearance.hat === 'party_hat') {
      // ── Party Hat: Smaller cone with stripes, pom-pom, elastic ──
      ctx.fillStyle = '#ff69b4';
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy - 22); ctx.lineTo(sx, sy - 37); ctx.lineTo(sx + 6, sy - 22);
      ctx.closePath(); ctx.fill();
      const stripeColors = ['#FFD700', '#4fc3f7', '#ff69b4', '#98e86c'];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = stripeColors[i];
        const t1 = i / 4, t2 = (i + 0.5) / 4;
        const y1 = sy - 22 - t1 * 15, y2 = sy - 22 - t2 * 15;
        const w1 = 6 * (1 - t1), w2 = 6 * (1 - t2);
        ctx.beginPath();
        ctx.moveTo(sx - w1, y1); ctx.lineTo(sx - w2, y2);
        ctx.lineTo(sx + w2, y2); ctx.lineTo(sx + w1, y1);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#FFD700';
      ctx.beginPath(); ctx.arc(sx, sy - 37, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe44d';
      ctx.beginPath(); ctx.arc(sx - 0.5, sy - 37.8, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath(); ctx.arc(sx - 0.5, sy - 38.2, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(sx - 6, sy - 22); ctx.quadraticCurveTo(sx - 8, sy - 16, sx - 5, sy - 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 6, sy - 22); ctx.quadraticCurveTo(sx + 8, sy - 16, sx + 5, sy - 10); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy - 22); ctx.lineTo(sx, sy - 37); ctx.lineTo(sx + 6, sy - 22);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#FFD700';
      ctx.beginPath(); ctx.ellipse(sx, sy - 22, 6, 2, 0, 0, Math.PI * 2); ctx.fill();

    } else if (appearance.hat === 'santa_hat') {
      // ── Santa Hat: Smaller drooping red cone, white trim, pom-pom ──
      ctx.fillStyle = '#CC0000';
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 22); ctx.quadraticCurveTo(sx - 1, sy - 34, sx + 8, sy - 32);
      ctx.quadraticCurveTo(sx + 6, sy - 27, sx + 8, sy - 22); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e02020';
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy - 22); ctx.quadraticCurveTo(sx, sy - 32, sx + 6, sy - 30);
      ctx.lineTo(sx + 4, sy - 30); ctx.quadraticCurveTo(sx - 2, sy - 30, sx - 3, sy - 22);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(sx, sy - 22, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx - 6, sy - 22, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx - 3, sy - 22.5, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx, sy - 23, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 3, sy - 22.5, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 6, sy - 22, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(sx + 8, sy - 32, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(sx + 7, sy - 33, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.beginPath(); ctx.ellipse(sx, sy - 21, 9, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    }

    // ══════════════════════════════════════════════
    //   ACCESSORIES (detailed)
    // ══════════════════════════════════════════════
    if (appearance.accessory === 'glasses') {
      // ── Glasses: Round frames with temple arms & lens tint ──
      // Left lens
      ctx.fillStyle = 'rgba(180,220,255,0.12)';
      ctx.beginPath(); ctx.arc(sx - eyeSpacing, eyeY, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx - eyeSpacing, eyeY, 5.5, 0, Math.PI * 2); ctx.stroke();
      // Right lens
      ctx.fillStyle = 'rgba(180,220,255,0.12)';
      ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 5.5, 0, Math.PI * 2); ctx.stroke();
      // Bridge
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(sx - eyeSpacing + 5.5, eyeY); ctx.quadraticCurveTo(sx, eyeY - 1.5, sx + eyeSpacing - 5.5, eyeY); ctx.stroke();
      // Temple arms (side)
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx - eyeSpacing - 5.5, eyeY); ctx.lineTo(sx - 12, eyeY + 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + eyeSpacing + 5.5, eyeY); ctx.lineTo(sx + 12, eyeY + 1); ctx.stroke();
      // Frame highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(sx - eyeSpacing, eyeY, 5, Math.PI + 0.5, -0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 5, Math.PI + 0.5, -0.5); ctx.stroke();
      // Lens glare
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath(); ctx.arc(sx - eyeSpacing + 2, eyeY - 2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + eyeSpacing + 2, eyeY - 2, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    if (appearance.accessory === 'bowtie') {
      // ── Bowtie: Silk with pleats and sheen ──
      const btY = sy - 2;
      // Left wing (with pleats)
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(sx - 1, btY); ctx.quadraticCurveTo(sx - 3, btY - 4, sx - 7, btY - 4);
      ctx.lineTo(sx - 7, btY + 3); ctx.quadraticCurveTo(sx - 3, btY + 3, sx - 1, btY);
      ctx.closePath(); ctx.fill();
      // Left pleat shadow
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.moveTo(sx - 1, btY); ctx.quadraticCurveTo(sx - 2, btY - 2, sx - 4, btY - 3);
      ctx.lineTo(sx - 4, btY + 2); ctx.quadraticCurveTo(sx - 2, btY + 1, sx - 1, btY);
      ctx.closePath(); ctx.fill();
      // Right wing
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(sx + 1, btY); ctx.quadraticCurveTo(sx + 3, btY - 4, sx + 7, btY - 4);
      ctx.lineTo(sx + 7, btY + 3); ctx.quadraticCurveTo(sx + 3, btY + 3, sx + 1, btY);
      ctx.closePath(); ctx.fill();
      // Right pleat shadow
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.moveTo(sx + 1, btY); ctx.quadraticCurveTo(sx + 2, btY - 2, sx + 4, btY - 3);
      ctx.lineTo(sx + 4, btY + 2); ctx.quadraticCurveTo(sx + 2, btY + 1, sx + 1, btY);
      ctx.closePath(); ctx.fill();
      // Wing outlines
      ctx.strokeStyle = '#a02020'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - 1, btY); ctx.quadraticCurveTo(sx - 3, btY - 4, sx - 7, btY - 4);
      ctx.lineTo(sx - 7, btY + 3); ctx.quadraticCurveTo(sx - 3, btY + 3, sx - 1, btY); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx + 1, btY); ctx.quadraticCurveTo(sx + 3, btY - 4, sx + 7, btY - 4);
      ctx.lineTo(sx + 7, btY + 3); ctx.quadraticCurveTo(sx + 3, btY + 3, sx + 1, btY); ctx.stroke();
      // Center knot
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.ellipse(sx, btY, 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath(); ctx.arc(sx - 0.3, btY - 0.3, 1, 0, Math.PI * 2); ctx.fill();
      // Silk sheen
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath(); ctx.ellipse(sx - 5, btY - 2, 2, 1, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 5, btY - 2, 2, 1, 0.3, 0, Math.PI * 2); ctx.fill();
    }
    if (appearance.accessory === 'eyeglass') {
      // ── Monocle: Gold frame with chain and lens reflection ──
      // Chain from ear
      ctx.strokeStyle = '#b8942a'; ctx.lineWidth = 0.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx + eyeSpacing + 5, eyeY + 2);
      ctx.quadraticCurveTo(sx + 14, eyeY + 4, sx + 12, sy - 2);
      ctx.quadraticCurveTo(sx + 10, sy + 2, sx + 8, sy + 5); ctx.stroke();
      // Chain links (small circles along chain)
      ctx.fillStyle = '#c8a850';
      ctx.beginPath(); ctx.arc(sx + 12, sy - 1, 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 10, sy + 2, 0.6, 0, Math.PI * 2); ctx.fill();
      // Lens (with tint)
      ctx.fillStyle = 'rgba(200,230,255,0.1)';
      ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 6, 0, Math.PI * 2); ctx.fill();
      // Gold frame (thick)
      ctx.strokeStyle = '#c8a850'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 6, 0, Math.PI * 2); ctx.stroke();
      // Frame highlight
      ctx.strokeStyle = '#e0c870'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 5.5, Math.PI + 0.5, -0.5); ctx.stroke();
      // Lens glare
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(sx + eyeSpacing + 2, eyeY - 2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.arc(sx + eyeSpacing - 1, eyeY + 1.5, 0.8, 0, Math.PI * 2); ctx.fill();
    }
    if (appearance.accessory === 'moustache') {
      // ── Moustache: Handlebar with waxed curled tips ──
      const mY = mouthY - 3;
      // Left side (main body)
      ctx.fillStyle = '#3a2815';
      ctx.beginPath();
      ctx.moveTo(sx, mY); ctx.quadraticCurveTo(sx - 3, mY - 3, sx - 7, mY - 2);
      ctx.quadraticCurveTo(sx - 9, mY - 1.5, sx - 10, mY - 2.5);
      ctx.quadraticCurveTo(sx - 9, mY + 0.5, sx - 7, mY);
      ctx.quadraticCurveTo(sx - 4, mY + 1, sx, mY + 0.5);
      ctx.closePath(); ctx.fill();
      // Right side (main body)
      ctx.beginPath();
      ctx.moveTo(sx, mY); ctx.quadraticCurveTo(sx + 3, mY - 3, sx + 7, mY - 2);
      ctx.quadraticCurveTo(sx + 9, mY - 1.5, sx + 10, mY - 2.5);
      ctx.quadraticCurveTo(sx + 9, mY + 0.5, sx + 7, mY);
      ctx.quadraticCurveTo(sx + 4, mY + 1, sx, mY + 0.5);
      ctx.closePath(); ctx.fill();
      // Highlight (lighter hair strands)
      ctx.fillStyle = '#5a3d28';
      ctx.beginPath();
      ctx.moveTo(sx, mY - 0.5); ctx.quadraticCurveTo(sx - 3, mY - 2, sx - 6, mY - 1.5);
      ctx.quadraticCurveTo(sx - 3, mY - 0.5, sx, mY); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx, mY - 0.5); ctx.quadraticCurveTo(sx + 3, mY - 2, sx + 6, mY - 1.5);
      ctx.quadraticCurveTo(sx + 3, mY - 0.5, sx, mY); ctx.closePath(); ctx.fill();
      // Curled tips
      ctx.strokeStyle = '#3a2815'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(sx - 10, mY - 2, 1.2, 0, Math.PI * 1.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx + 10, mY - 2, 1.2, Math.PI * 0.5, Math.PI * 2); ctx.stroke();
    }
    if (appearance.accessory === 'bandana') {
      // ── Bandana: Patterned cloth with knot and tails ──
      // Main band (wrapping head)
      ctx.fillStyle = '#27ae60';
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 20); ctx.lineTo(sx + 10, sy - 20);
      ctx.lineTo(sx + 9, sy - 17); ctx.quadraticCurveTo(sx, sy - 16.5, sx - 9, sy - 17);
      ctx.closePath(); ctx.fill();
      // Lighter stripe
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy - 19.5); ctx.lineTo(sx + 9, sy - 19.5);
      ctx.lineTo(sx + 8.5, sy - 18); ctx.lineTo(sx - 8.5, sy - 18);
      ctx.closePath(); ctx.fill();
      // Pattern dots
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      for (let dx = -6; dx <= 6; dx += 4) {
        ctx.beginPath(); ctx.arc(sx + dx, sy - 18.5, 0.8, 0, Math.PI * 2); ctx.fill();
      }
      // Knot (side)
      ctx.fillStyle = '#25a55a';
      ctx.beginPath(); ctx.arc(sx + 10, sy - 19, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath(); ctx.arc(sx + 9.5, sy - 19.5, 1.5, 0, Math.PI * 2); ctx.fill();
      // Tails
      ctx.fillStyle = '#27ae60';
      ctx.beginPath();
      ctx.moveTo(sx + 11, sy - 18); ctx.quadraticCurveTo(sx + 15, sy - 16, sx + 16, sy - 14);
      ctx.quadraticCurveTo(sx + 14, sy - 15, sx + 11, sy - 17); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx + 11, sy - 20); ctx.quadraticCurveTo(sx + 16, sy - 20, sx + 17, sy - 17);
      ctx.quadraticCurveTo(sx + 14, sy - 19, sx + 11, sy - 19); ctx.closePath(); ctx.fill();
      // Band outline
      ctx.strokeStyle = '#1e8c4e'; ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 20); ctx.lineTo(sx + 10, sy - 20);
      ctx.lineTo(sx + 9, sy - 17); ctx.quadraticCurveTo(sx, sy - 16.5, sx - 9, sy - 17);
      ctx.closePath(); ctx.stroke();
    }
    if (appearance.accessory === 'earring') {
      // ── Earring: Dangling gold hoop with gem pendant ──
      // Stud (where it attaches)
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath(); ctx.arc(sx - 10, sy - 10, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath(); ctx.arc(sx - 10.3, sy - 10.3, 0.8, 0, Math.PI * 2); ctx.fill();
      // Hoop (gold ring)
      ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx - 10, sy - 7, 3.5, 0, Math.PI * 2); ctx.stroke();
      // Hoop highlight
      ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.arc(sx - 10, sy - 7, 3, Math.PI + 0.5, -0.5); ctx.stroke();
      // Pendant gem
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 3); ctx.lineTo(sx - 11.5, sy - 1); ctx.lineTo(sx - 10, sy + 1.5);
      ctx.lineTo(sx - 8.5, sy - 1); ctx.closePath(); ctx.fill();
      // Gem highlight
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(sx - 10.3, sy - 1.5, 0.7, 0, Math.PI * 2); ctx.fill();
      // Gem outline
      ctx.strokeStyle = '#1a8a40'; ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 3); ctx.lineTo(sx - 11.5, sy - 1); ctx.lineTo(sx - 10, sy + 1.5);
      ctx.lineTo(sx - 8.5, sy - 1); ctx.closePath(); ctx.stroke();
    }
    if (appearance.accessory === 'scarf') {
      // ── Scarf: Small cozy striped knit scarf (at neck, not covering face) ──
      const scarfY = sy - 1;
      // Main scarf wrap (smaller)
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(sx - 7, scarfY - 2); ctx.quadraticCurveTo(sx, scarfY - 3.5, sx + 7, scarfY - 2);
      ctx.lineTo(sx + 6, scarfY + 1); ctx.quadraticCurveTo(sx, scarfY - 0.5, sx - 6, scarfY + 1);
      ctx.closePath(); ctx.fill();
      // Stripes
      ctx.fillStyle = '#fff';
      for (let i = -4; i <= 4; i += 4) {
        ctx.beginPath();
        ctx.moveTo(sx + i, scarfY - 2.5); ctx.lineTo(sx + i + 1.5, scarfY - 3);
        ctx.lineTo(sx + i + 1.5, scarfY); ctx.lineTo(sx + i, scarfY + 0.3);
        ctx.closePath(); ctx.fill();
      }
      // Hanging end (shorter)
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(sx + 6, scarfY); ctx.quadraticCurveTo(sx + 9, scarfY + 3, sx + 7, scarfY + 8);
      ctx.lineTo(sx + 4, scarfY + 7); ctx.quadraticCurveTo(sx + 6, scarfY + 3, sx + 4, scarfY);
      ctx.closePath(); ctx.fill();
      // Hanging end stripe
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(sx + 6.5, scarfY + 3); ctx.lineTo(sx + 7, scarfY + 3.5);
      ctx.lineTo(sx + 5.5, scarfY + 4.5); ctx.lineTo(sx + 5, scarfY + 4);
      ctx.closePath(); ctx.fill();
      // Fringe at end
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 0.6;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + 5 + i, scarfY + 7);
        ctx.lineTo(sx + 5 + i + 0.3, scarfY + 9.5);
        ctx.stroke();
      }
    }
    if (appearance.accessory === 'heart_necklace') {
      // ── Heart Necklace: Cute pendant on delicate chain ──
      const neckY = sy - 4;
      // Chain (delicate gold)
      ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx - 8, neckY - 8);
      ctx.quadraticCurveTo(sx - 4, neckY - 6, sx, neckY);
      ctx.quadraticCurveTo(sx + 4, neckY - 6, sx + 8, neckY - 8);
      ctx.stroke();
      // Heart pendant
      ctx.fillStyle = '#e91e63';
      ctx.beginPath();
      ctx.moveTo(sx, neckY + 5);
      ctx.bezierCurveTo(sx - 5, neckY + 2, sx - 5, neckY - 2, sx, neckY);
      ctx.bezierCurveTo(sx + 5, neckY - 2, sx + 5, neckY + 2, sx, neckY + 5);
      ctx.fill();
      // Heart shine
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.arc(sx - 2, neckY, 1, 0, Math.PI * 2); ctx.fill();
    }
    if (appearance.accessory === 'star_pin') {
      // ── Star Pin: Sparkly star badge on chest ──
      const pinY = sy - 8;
      const pinX = sx - 6;
      // Glow
      ctx.fillStyle = 'rgba(255,215,0,0.2)';
      ctx.beginPath(); ctx.arc(pinX, pinY, 6, 0, Math.PI * 2); ctx.fill();
      // Star shape
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
        const x = pinX + Math.cos(angle) * 4;
        const y = pinY + Math.sin(angle) * 4;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      // Center
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(pinX, pinY, 1.5, 0, Math.PI * 2); ctx.fill();
      // Sparkles
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(pinX - 2, pinY - 3, 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(pinX + 3, pinY - 1, 0.5, 0, Math.PI * 2); ctx.fill();
    }
    if (appearance.accessory === 'blush') {
      // ── Blush: Cute rosy cheeks ──
      const cheekY = eyeY + 5;
      // Left blush (soft pink circles)
      ctx.fillStyle = 'rgba(255,150,180,0.35)';
      ctx.beginPath(); ctx.ellipse(sx - 8, cheekY, 4, 2.5, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,120,160,0.25)';
      ctx.beginPath(); ctx.ellipse(sx - 8, cheekY, 3, 2, -0.2, 0, Math.PI * 2); ctx.fill();
      // Right blush
      ctx.fillStyle = 'rgba(255,150,180,0.35)';
      ctx.beginPath(); ctx.ellipse(sx + 8, cheekY, 4, 2.5, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,120,160,0.25)';
      ctx.beginPath(); ctx.ellipse(sx + 8, cheekY, 3, 2, 0.2, 0, Math.PI * 2); ctx.fill();
      // Tiny sparkle accents
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(sx - 10, cheekY - 1, 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 10, cheekY - 1, 0.6, 0, Math.PI * 2); ctx.fill();
    }
    if (appearance.accessory === 'flower_crown') {
      // ── Flower Crown: Cute floral headpiece ──
      const crownY = sy - 22;
      // Vine base
      ctx.strokeStyle = '#27ae60'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx - 10, crownY + 2);
      ctx.quadraticCurveTo(sx - 5, crownY - 1, sx, crownY);
      ctx.quadraticCurveTo(sx + 5, crownY - 1, sx + 10, crownY + 2);
      ctx.stroke();
      // Flowers - pink
      const drawFlower = (fx: number, fy: number, color: string) => {
        ctx.fillStyle = color;
        for (let i = 0; i < 5; i++) {
          const angle = (i * Math.PI * 2 / 5) - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(angle) * 2, fy + Math.sin(angle) * 2, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffd700';
        ctx.beginPath(); ctx.arc(fx, fy, 1.2, 0, Math.PI * 2); ctx.fill();
      };
      drawFlower(sx - 7, crownY, '#ff69b4');
      drawFlower(sx, crownY - 2, '#ffb6c1');
      drawFlower(sx + 7, crownY, '#ff69b4');
      // Leaves
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath(); ctx.ellipse(sx - 4, crownY + 1, 2, 1, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 4, crownY + 1, 2, 1, 0.5, 0, Math.PI * 2); ctx.fill();
    }
    if (appearance.accessory === 'backpack') {
      // ── Backpack: Small rectangle on agent's back with straps ──
      ctx.fillStyle = '#8B6914';
      ctx.beginPath(); ctx.roundRect(sx - 14, sy - 8, 8, 10, 2); ctx.fill();
      // Flap
      ctx.fillStyle = '#a07818';
      ctx.beginPath(); ctx.roundRect(sx - 14, sy - 8, 8, 4, [2, 2, 0, 0]); ctx.fill();
      // Buckle
      ctx.fillStyle = '#c0a870';
      ctx.fillRect(sx - 11.5, sy - 5, 3, 1.5);
      // Pocket
      ctx.strokeStyle = '#6a5010'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.roundRect(sx - 13, sy - 1, 6, 3, 1); ctx.stroke();
    }
    if (appearance.accessory === 'icecream') {
      // ── Ice Cream: Cone with scoop, held in right hand ──
      const hx = sx + 13, hy = sy - 5;
      // Waffle cone
      ctx.fillStyle = '#d4a050';
      ctx.beginPath();
      ctx.moveTo(hx - 2, hy); ctx.lineTo(hx + 2, hy);
      ctx.lineTo(hx, hy + 8);
      ctx.closePath(); ctx.fill();
      // Waffle pattern
      ctx.strokeStyle = 'rgba(139,100,40,0.3)'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.moveTo(hx - 1.5, hy + 1); ctx.lineTo(hx + 0.5, hy + 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx + 1.5, hy + 1); ctx.lineTo(hx - 0.5, hy + 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx - 1.5, hy + 3); ctx.lineTo(hx + 1.5, hy + 3); ctx.stroke();
      // Scoop (strawberry pink)
      ctx.fillStyle = '#ff8fab';
      ctx.beginPath(); ctx.arc(hx, hy - 2, 3.5, 0, Math.PI * 2); ctx.fill();
      // Scoop highlight
      ctx.fillStyle = '#ffb3c6';
      ctx.beginPath(); ctx.arc(hx - 1.2, hy - 3.2, 1.5, 0, Math.PI * 2); ctx.fill();
      // Shine dot
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(hx - 1.5, hy - 3.8, 0.7, 0, Math.PI * 2); ctx.fill();
    }
    if (appearance.accessory === 'monocle') {
      // ── Monocle: Single round lens with chain (right eye) ──
      // Lens
      ctx.fillStyle = 'rgba(180,220,255,0.15)';
      ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 5.5, 0, Math.PI * 2); ctx.fill();
      // Frame
      ctx.strokeStyle = '#c0a870'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx + eyeSpacing, eyeY, 5.5, 0, Math.PI * 2); ctx.stroke();
      // Chain
      ctx.strokeStyle = '#c0a870'; ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(sx + eyeSpacing + 4, eyeY + 4);
      ctx.quadraticCurveTo(sx + eyeSpacing + 6, eyeY + 7, sx + eyeSpacing + 2, eyeY + 8);
      ctx.stroke();
      // Lens glint
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(sx + eyeSpacing - 2, eyeY - 2, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    // ── Sleeping Z's ──
    if (agent.state === 'sleeping') {
      ctx.fillStyle = '#6c63ff';
      ctx.font = 'bold 10px monospace'; ctx.fillText('Z', sx + 10, sy - 26);
      ctx.font = 'bold 8px monospace'; ctx.fillText('z', sx + 16, sy - 32);
      ctx.font = 'bold 6px monospace'; ctx.fillText('z', sx + 20, sy - 36);
    }

    // ── Energy bar + name tag ──
    const barW = 20;
    const barY = sy - (hasEars || (appearance.hat && appearance.hat !== 'none') ? 46 : 28);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.roundRect(sx - barW / 2, barY, barW, 3, 1.5); ctx.fill();
    const er = agent.energy / 100;
    ctx.fillStyle = er > 0.5 ? '#4CAF50' : er > 0.2 ? '#FFC107' : '#f44336';
    ctx.beginPath(); ctx.roundRect(sx - barW / 2, barY, barW * er, 3, 1.5); ctx.fill();

    ctx.font = 'bold 10px "Inter", system-ui, sans-serif'; ctx.textAlign = 'center';
    const nw = ctx.measureText(agent.name).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(sx - nw / 2 - 4, barY - 16, nw + 8, 14, 4); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillText(agent.name, sx, barY - 5);
  }, []);

  // ── Draw speech bubble ──
  const drawSpeechBubble = useCallback((ctx: CanvasRenderingContext2D, text: string, sx: number, sy: number) => {
    const maxWidth = 140;
    ctx.font = '11px "Inter", system-ui, sans-serif';
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width > maxWidth) { if (cur) lines.push(cur); cur = w; } else { cur = t; }
    }
    if (cur) lines.push(cur);
    if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].slice(0, -3) + '...'; }

    const pad = 8, lh = 14;
    const bw = Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width))) + pad * 2;
    const bh = lines.length * lh + pad * 2;
    const bx = sx - bw / 2, by = sy - 65 - bh;

    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.roundRect(bx + 2, by + 2, bw, bh, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.moveTo(sx - 5, by + bh); ctx.lineTo(sx, by + bh + 8); ctx.lineTo(sx + 5, by + bh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a1a2e'; ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + pad, by + pad + 10 + i * lh);
    ctx.textAlign = 'center';
  }, []);

  const drawEmote = useCallback((ctx: CanvasRenderingContext2D, emoji: string, sx: number, sy: number) => {
    ctx.font = '20px serif'; ctx.textAlign = 'center'; ctx.fillText(emoji, sx, sy - 50);
  }, []);

  // ── Main render loop ──
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const camera = cameraRef.current;
    const tiles = tilesRef.current;
    const agents = agentsRef.current;
    const now = Date.now();

    // Smooth camera pan
    if (camera.animating) {
      const dx = camera.targetX - camera.x, dy = camera.targetY - camera.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        camera.x = camera.targetX; camera.y = camera.targetY; camera.animating = false;
      } else {
        camera.x += dx * 0.08; camera.y += dy * 0.08;
      }
    }

    // Continuous agent tracking - smoothly follow the selected agent
    if (camera.trackingAgentId) {
      const trackedAgent = agents.find(a => a.id === camera.trackingAgentId);
      if (trackedAgent) {
        // Get the agent's render state for smooth interpolated position
        const rs = renderStatesRef.current.get(trackedAgent.id);
        const agentX = rs ? rs.displayX : trackedAgent.posX;
        const agentY = rs ? rs.displayY : trackedAgent.posY;

        const screen = gridToScreen(agentX, agentY);
        const newTargetX = -screen.x * camera.zoom;
        const newTargetY = (height / 2 - 80) - screen.y * camera.zoom;

        // Smoothly update target to follow agent
        camera.targetX = camera.targetX + (newTargetX - camera.targetX) * 0.1;
        camera.targetY = camera.targetY + (newTargetY - camera.targetY) * 0.1;

        // Keep animating to follow
        const dx = camera.targetX - camera.x;
        const dy = camera.targetY - camera.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          camera.x += dx * 0.12;
          camera.y += dy * 0.12;
        }
      }
    }

    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(width / 2 + camera.x, 80 + camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    // ── Viewport culling: only render visible tiles ──
    const viewBounds = getVisibleBounds(width, height, camera.x, camera.y, camera.zoom);
    const tileRange = getVisibleTileRange(viewBounds);

    // ═══════════════════════════════════════════════════════════
    // ISOMETRIC DEPTH-SORTED RENDERING
    // Pass 1: Ground tiles only (flat elements)
    // Pass 2: Tall objects sorted by depth (x+y) for correct overlap
    // ═══════════════════════════════════════════════════════════

    // Collect tall objects for depth-sorted rendering
    type TallObject = {
      type: 'tree' | 'building' | 'playerBuilding' | 'palmTree' | 'cactus' | 'marketStall' | 'fountain' | 'slide' | 'swing' | 'picnicTable' | 'lampPost' | 'bench' | 'fence';
      x: number;
      y: number;
      sc: { x: number; y: number };
      data?: BuildingData;
    };
    const tallObjects: TallObject[] = [];

    // Pass 1: Render ground tiles only, collect tall objects
    for (let y = tileRange.minY; y <= tileRange.maxY; y++) {
      for (let x = tileRange.minX; x <= tileRange.maxX; x++) {
        const tt = tiles[y]?.[x] ?? 0;
        const sc = gridToScreen(x, y);
        switch (tt) {
          case TILE_TYPES.WATER: drawWater(ctx, sc.x, sc.y, x, y, now); break;
          case TILE_TYPES.WATER_DEEP: drawWater(ctx, sc.x, sc.y, x, y, now); break;
          case TILE_TYPES.BUILDING: {
            drawGrass(ctx, sc.x, sc.y, x, y);
            // Collect for depth-sorted rendering
            const playerBuilding = buildingMapRef.current.get(`${x},${y}`);
            if (playerBuilding) {
              tallObjects.push({ type: 'playerBuilding', x, y, sc, data: playerBuilding });
            } else {
              tallObjects.push({ type: 'building', x, y, sc });
            }
            break;
          }
          case TILE_TYPES.TREE: {
            drawGrass(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'tree', x, y, sc });
            break;
          }
          case TILE_TYPES.FLOWER: drawGrass(ctx, sc.x, sc.y, x, y); drawFlower(ctx, sc.x, sc.y, x, y); break;
          case TILE_TYPES.PATH: drawPath(ctx, sc.x, sc.y, x, y); break;
          case TILE_TYPES.STONE: drawStone(ctx, sc.x, sc.y, x, y); break;
          case TILE_TYPES.BRIDGE: drawBridge(ctx, sc.x, sc.y); break;
          case TILE_TYPES.SAND: drawSand(ctx, sc.x, sc.y, x, y); break;
          case TILE_TYPES.DOCK: drawDock(ctx, sc.x, sc.y); break;
          case TILE_TYPES.FENCE: {
            drawGrass(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'fence', x, y, sc });
            break;
          }
          case TILE_TYPES.GARDEN: drawGarden(ctx, sc.x, sc.y, x, y); break;
          case TILE_TYPES.FLOWER_FIELD: drawGrass(ctx, sc.x, sc.y, x, y); drawFlowerField(ctx, sc.x, sc.y, x, y); break;
          case TILE_TYPES.SAND_DUNE: drawSand(ctx, sc.x, sc.y, x, y); break;
          case TILE_TYPES.PALM_TREE: {
            drawSand(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'palmTree', x, y, sc });
            break;
          }
          case TILE_TYPES.CACTUS: {
            drawSand(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'cactus', x, y, sc });
            break;
          }
          case TILE_TYPES.MARKET_STALL: {
            drawStonePath(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'marketStall', x, y, sc });
            break;
          }
          case TILE_TYPES.FOUNTAIN: {
            drawStonePath(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'fountain', x, y, sc });
            break;
          }
          case TILE_TYPES.STONE_PATH: drawStonePath(ctx, sc.x, sc.y, x, y); break;
          case TILE_TYPES.SLIDE: {
            drawGrass(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'slide', x, y, sc });
            break;
          }
          case TILE_TYPES.SWING: {
            drawGrass(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'swing', x, y, sc });
            break;
          }
          case TILE_TYPES.PICNIC_TABLE: {
            drawGrass(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'picnicTable', x, y, sc });
            break;
          }
          case TILE_TYPES.LAMP_POST: {
            drawStonePath(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'lampPost', x, y, sc });
            break;
          }
          case TILE_TYPES.BENCH: {
            drawStonePath(ctx, sc.x, sc.y, x, y);
            tallObjects.push({ type: 'bench', x, y, sc });
            break;
          }
          default: drawGrass(ctx, sc.x, sc.y, x, y); break;
        }
      }
    }

    // Add player-built buildings from buildingsRef (ensures they render even if tile not marked)
    // This handles cases where buildings exist in DB but tile map wasn't updated
    for (const building of buildingsRef.current) {
      // Skip if outside visible tile range
      if (building.x < tileRange.minX || building.x > tileRange.maxX ||
          building.y < tileRange.minY || building.y > tileRange.maxY) continue;

      // Check if already added from tile loop (avoid duplicates)
      const alreadyAdded = tallObjects.some(
        obj => obj.type === 'playerBuilding' && obj.x === building.x && obj.y === building.y
      );
      if (!alreadyAdded) {
        const sc = gridToScreen(building.x, building.y);
        tallObjects.push({ type: 'playerBuilding', x: building.x, y: building.y, sc, data: building });
      }
    }

    // Pass 2: Sort tall objects by isometric depth (x + y) for correct overlap
    // Objects with lower (x + y) are further back and should be drawn first
    tallObjects.sort((a, b) => (a.x + a.y) - (b.x + b.y));

    // Pass 2: Draw all tall objects in depth order
    for (const obj of tallObjects) {
      switch (obj.type) {
        case 'tree': drawTree(ctx, obj.sc.x, obj.sc.y, obj.x, obj.y); break;
        case 'building': drawBuilding(ctx, obj.sc.x, obj.sc.y, obj.x, obj.y); break;
        case 'playerBuilding': drawPlayerBuilding(ctx, obj.sc.x, obj.sc.y, obj.data!); break;
        case 'palmTree': drawPalmTree(ctx, obj.sc.x, obj.sc.y, obj.x, obj.y); break;
        case 'cactus': drawCactus(ctx, obj.sc.x, obj.sc.y, obj.x, obj.y); break;
        case 'marketStall': drawMarketStall(ctx, obj.sc.x, obj.sc.y, obj.x, obj.y); break;
        case 'fountain': drawFountain(ctx, obj.sc.x, obj.sc.y, now); break;
        case 'slide': drawSlide(ctx, obj.sc.x, obj.sc.y, obj.x, obj.y); break;
        case 'swing': drawSwing(ctx, obj.sc.x, obj.sc.y, now); break;
        case 'picnicTable': drawPicnicTable(ctx, obj.sc.x, obj.sc.y); break;
        case 'lampPost': drawLampPost(ctx, obj.sc.x, obj.sc.y, now); break;
        case 'bench': drawBench(ctx, obj.sc.x, obj.sc.y); break;
        case 'fence': drawFence(ctx, obj.sc.x, obj.sc.y); break;
      }
    }

    // ── Agent rendering with viewport culling ──
    // First pass: update ALL agent render states (for smooth movement even when off-screen)
    // Second pass: only draw visible agents

    // Update render states for all agents (cheap)
    for (const agent of agents) {
      let rs = renderStatesRef.current.get(agent.id);
      if (!rs) {
        rs = { displayX: agent.posX, displayY: agent.posY, targetX: agent.posX, targetY: agent.posY };
        renderStatesRef.current.set(agent.id, rs);
      }
      rs.targetX = agent.posX;
      rs.targetY = agent.posY;
      rs.displayX += (rs.targetX - rs.displayX) * MOVE_LERP_SPEED;
      rs.displayY += (rs.targetY - rs.displayY) * MOVE_LERP_SPEED;
    }

    // Filter to visible agents only, then sort for depth
    const visibleAgents = agents.filter(agent => {
      const rs = renderStatesRef.current.get(agent.id);
      const x = rs ? rs.displayX : agent.posX;
      const y = rs ? rs.displayY : agent.posY;
      // Check if within visible tile range (with padding for agent height)
      return x >= tileRange.minX - 1 && x <= tileRange.maxX + 1 &&
             y >= tileRange.minY - 1 && y <= tileRange.maxY + 1;
    });

    const sorted = visibleAgents.sort((a, b) => (a.posX + a.posY) - (b.posX + b.posY));

    for (const agent of sorted) {
      const rs = renderStatesRef.current.get(agent.id)!;
      const sc = gridToScreen(rs.displayX, rs.displayY);
      const bounce = 0;
      drawAgent(ctx, agent, sc.x, sc.y - bounce, hoveredAgentRef.current === agent.id, selectedAgentId === agent.id);

      // O(1) lookups for speech bubbles and emotes
      const bub = speechBubbleMapRef.current.get(agent.id);
      if (bub && bub.expiresAt > now) drawSpeechBubble(ctx, bub.text, sc.x, sc.y - bounce);
      const em = emoteMapRef.current.get(agent.id);
      if (em && em.expiresAt > now) drawEmote(ctx, em.emoji, sc.x, sc.y - bounce);

      // Activity animations (fishing, chopping, selling)
      const activity = agentActivitiesRef.current.get(agent.id);
      if (activity) {
        const elapsed = now - activity.startedAt;
        const progress = Math.min(1, elapsed / activity.duration);

        // Auto-expire activity
        if (progress >= 1) {
          agentActivitiesRef.current.delete(agent.id);
        } else {
          const sx = sc.x;
          const sy = sc.y - bounce;

          if (activity.activity === 'fishing') {
            // Fishing rod
            ctx.save();
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(sx + 8, sy - 20);
            ctx.lineTo(sx + 25, sy - 35);
            ctx.stroke();

            // Fishing line (wavy)
            const wave = Math.sin(now / 200) * 3;
            ctx.strokeStyle = '#666';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx + 25, sy - 35);
            ctx.quadraticCurveTo(sx + 30 + wave, sy - 15, sx + 25, sy + 5);
            ctx.stroke();

            // Bobber
            ctx.fillStyle = '#FF4444';
            ctx.beginPath();
            ctx.arc(sx + 25, sy + 5 + Math.sin(now / 300) * 2, 3, 0, Math.PI * 2);
            ctx.fill();

            // Water ripples
            ctx.strokeStyle = 'rgba(100, 180, 255, 0.5)';
            ctx.lineWidth = 1;
            const ripple = (now / 500) % 1;
            ctx.beginPath();
            ctx.arc(sx + 25, sy + 5, 5 + ripple * 10, 0, Math.PI * 2);
            ctx.stroke();

            // Activity bubble
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.beginPath();
            ctx.roundRect(sx - 35, sy - 65, 70, 20, 6);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Inter, system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('🎣 Fishing...', sx, sy - 51);
            ctx.restore();
          } else if (activity.activity === 'chopping') {
            ctx.save();
            // Axe swing
            const swingAngle = Math.sin(now / 100) * 0.6;
            ctx.translate(sx + 10, sy - 15);
            ctx.rotate(swingAngle - 0.3);

            // Axe handle
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(12, -12);
            ctx.stroke();

            // Axe head
            ctx.fillStyle = '#888';
            ctx.beginPath();
            ctx.moveTo(10, -14);
            ctx.lineTo(18, -18);
            ctx.lineTo(16, -8);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // Wood chip particles
            for (let i = 0; i < 3; i++) {
              const chipPhase = ((now / 150) + i * 0.4) % 1;
              const chipX = sx + 12 + Math.sin(i * 2.5) * 8 * chipPhase;
              const chipY = sy - 15 - chipPhase * 25;
              ctx.fillStyle = `rgba(139, 90, 43, ${1 - chipPhase})`;
              ctx.beginPath();
              ctx.arc(chipX, chipY, 2, 0, Math.PI * 2);
              ctx.fill();
            }

            // Activity bubble
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.beginPath();
            ctx.roundRect(sx - 30, sy - 65, 60, 20, 6);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Inter, system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('🪓 Chop!', sx, sy - 51);
          } else if (activity.activity === 'selling') {
            ctx.save();
            // Coin sparkles
            for (let i = 0; i < 4; i++) {
              const angle = (now / 250 + i * Math.PI / 2) % (Math.PI * 2);
              const dist = 12 + Math.sin(now / 200) * 3;
              const sparkleX = sx + Math.cos(angle) * dist;
              const sparkleY = sy - 25 + Math.sin(angle) * dist * 0.5;
              ctx.fillStyle = '#FFD700';
              ctx.beginPath();
              ctx.arc(sparkleX, sparkleY, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();

            // Activity bubble
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.beginPath();
            ctx.roundRect(sx - 30, sy - 65, 60, 20, 6);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Inter, system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('💰 Sold!', sx, sy - 51);
          } else if (activity.activity === 'crafting') {
            // Crafting sparkles
            for (let i = 0; i < 3; i++) {
              const sparklePhase = ((now / 300) + i * 0.33) % 1;
              const sparkleX = sx - 10 + i * 10;
              const sparkleY = sy - 20 - sparklePhase * 15;
              ctx.fillStyle = `rgba(255, 200, 100, ${1 - sparklePhase})`;
              ctx.beginPath();
              ctx.arc(sparkleX, sparkleY, 3, 0, Math.PI * 2);
              ctx.fill();
            }

            // Activity bubble
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.beginPath();
            ctx.roundRect(sx - 35, sy - 65, 70, 20, 6);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Inter, system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('🔨 Crafting...', sx, sy - 51);
          } else if (activity.activity === 'building') {
            ctx.save();
            // Hammer swing animation
            const swingAngle = Math.sin(now / 120) * 0.5;
            ctx.translate(sx + 8, sy - 18);
            ctx.rotate(swingAngle - 0.2);

            // Hammer handle
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(10, -10);
            ctx.stroke();

            // Hammer head
            ctx.fillStyle = '#666';
            ctx.beginPath();
            ctx.roundRect(8, -16, 10, 8, 2);
            ctx.fill();
            ctx.restore();

            // Wood plank particles flying
            for (let i = 0; i < 4; i++) {
              const phase = ((now / 200) + i * 0.25) % 1;
              const particleX = sx - 10 + Math.sin(i * 3) * 12 * phase;
              const particleY = sy - 10 - phase * 20;
              ctx.save();
              ctx.translate(particleX, particleY);
              ctx.rotate(now / 200 + i);
              ctx.fillStyle = `rgba(139, 90, 43, ${1 - phase})`;
              ctx.fillRect(-3, -1, 6, 2);
              ctx.restore();
            }

            // Progress bar for building
            const buildProgress = activity.extra?.progress as number | undefined;
            if (buildProgress !== undefined) {
              ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
              ctx.beginPath();
              ctx.roundRect(sx - 30, sy - 80, 60, 12, 4);
              ctx.fill();
              ctx.fillStyle = '#4CAF50';
              ctx.beginPath();
              ctx.roundRect(sx - 28, sy - 78, 56 * (buildProgress / 100), 8, 3);
              ctx.fill();
            }

            // Activity bubble
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.beginPath();
            ctx.roundRect(sx - 40, sy - 65, 80, 20, 6);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Inter, system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('🏠 Building...', sx, sy - 51);
          }
        }
      }

      // Floating text (money earned, items collected)
      const floatingText = floatingTextsRef.current.find(f => f.agentId === agent.id && f.expiresAt > now);
      if (floatingText) {
        const elapsed = now - floatingText.startedAt;
        const progress = elapsed / FLOATING_TEXT_DURATION_MS;
        const floatY = sc.y - bounce - 60 - (progress * 30);
        ctx.globalAlpha = 1 - progress;
        ctx.font = 'bold 14px Inter, system-ui';
        ctx.fillStyle = floatingText.color;
        ctx.textAlign = 'center';
        ctx.fillText(floatingText.text, sc.x, floatY);
        ctx.globalAlpha = 1;
      }

      if (agent.state === 'talking' && !bub) {
        // Animated speech indicator
        const ph = now / 400;
        // Speech dots
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.arc(sc.x - 8 + i * 8, sc.y - bounce - 55 + Math.sin(ph + i * 0.8) * 4, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        // "Talking" label
        ctx.fillStyle = 'rgba(100, 150, 255, 0.85)';
        ctx.beginPath();
        ctx.roundRect(sc.x - 28, sc.y - bounce - 75, 56, 16, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Inter, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('💬 Chatting', sc.x, sc.y - bounce - 63);
      }
    }

    // Clean up expired speech bubbles (both array and map)
    speechBubblesRef.current = speechBubblesRef.current.filter(b => b.expiresAt > now);
    for (const [agentId, bub] of speechBubbleMapRef.current.entries()) {
      if (bub.expiresAt <= now) speechBubbleMapRef.current.delete(agentId);
    }
    // Clean up expired emotes (both array and map)
    emotesRef.current = emotesRef.current.filter(e => e.expiresAt > now);
    for (const [agentId, em] of emoteMapRef.current.entries()) {
      if (em.expiresAt <= now) emoteMapRef.current.delete(agentId);
    }
    floatingTextsRef.current = floatingTextsRef.current.filter(f => f.expiresAt > now);
    // Clean up expired activities
    for (const [agentId, activity] of agentActivitiesRef.current.entries()) {
      if (now - activity.startedAt > activity.duration) {
        agentActivitiesRef.current.delete(agentId);
      }
    }
    ctx.restore();

    // Note: Town info HUD is rendered via HTML overlay in watch/page.tsx
    // Note: Time & Weather HUD is rendered via HTML overlay in watch/page.tsx

    // Rain particles effect (still drawn on canvas for visual effect)
    const worldTime = worldTimeRef.current;
    if (worldTime?.isRaining) {
      const isStormy = worldTime.weather === 'stormy';
      const rainCount = isStormy ? 200 : 120;
      const rainSpeed = isStormy ? 12 : 8; // pixels per frame
      const rainLength = isStormy ? 35 : 25;
      const rainSlant = isStormy ? 8 : 4; // horizontal drift

      // Blue-ish overlay for rain atmosphere
      ctx.fillStyle = isStormy ? 'rgba(60, 100, 140, 0.15)' : 'rgba(80, 130, 180, 0.10)';
      ctx.fillRect(0, 0, width, height);

      // Draw rain drops with smooth continuous falling
      ctx.lineCap = 'round';
      for (let i = 0; i < rainCount; i++) {
        // Each drop has fixed X based on its index (spread evenly + some randomness)
        const columnWidth = width / (rainCount / 3);
        const baseX = (i * columnWidth * 0.37) % width;

        // Smooth continuous Y animation - each drop falls independently
        const dropSpeed = rainSpeed * (0.8 + (i % 5) * 0.1); // slight speed variation
        const cycleLength = height + rainLength + 100;
        const yOffset = (now * dropSpeed / 16.67 + i * 73) % cycleLength;
        const startY = yOffset - 50;

        // X position drifts as drop falls
        const startX = baseX + (yOffset / height) * rainSlant;

        // 3 depth layers for parallax effect
        const layer = i % 3;
        let opacity: number, thickness: number, lengthMult: number;
        if (layer === 0) { // front layer - bright and thick
          opacity = 0.7;
          thickness = 2.5;
          lengthMult = 1.3;
        } else if (layer === 1) { // mid layer
          opacity = 0.5;
          thickness = 1.8;
          lengthMult = 1.0;
        } else { // back layer - faint and thin
          opacity = 0.3;
          thickness = 1.2;
          lengthMult = 0.7;
        }

        const dropLen = rainLength * lengthMult;
        ctx.strokeStyle = `rgba(200, 230, 255, ${opacity})`;
        ctx.lineWidth = thickness;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX + rainSlant * 0.3, startY + dropLen);
        ctx.stroke();
      }

      // Rain splash ripples on ground
      const splashCount = isStormy ? 40 : 25;
      for (let i = 0; i < splashCount; i++) {
        const splashCycle = 350 + (i % 7) * 40;
        const splashPhase = ((now + i * 127) % splashCycle) / splashCycle;

        // Fixed splash positions
        const splashX = 30 + ((i * 83) % (width - 60));
        const splashY = 120 + ((i * 61) % (height - 200));

        if (splashPhase < 0.7) {
          const expandProgress = splashPhase / 0.7;
          const radius = 3 + expandProgress * 12;
          const alpha = (1 - expandProgress) * 0.5;

          // Outer ripple
          ctx.strokeStyle = `rgba(200, 230, 255, ${alpha})`;
          ctx.lineWidth = 2 - expandProgress;
          ctx.beginPath();
          ctx.ellipse(splashX, splashY, radius, radius * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();

          // Inner splash dot at start
          if (expandProgress < 0.3) {
            ctx.fillStyle = `rgba(220, 240, 255, ${(0.3 - expandProgress) * 2})`;
            ctx.beginPath();
            ctx.arc(splashX, splashY, 3 * (1 - expandProgress * 3), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(render);
  }, [gridToScreen, drawTile, drawGrass, drawPath, drawWater, drawStone, drawTree, drawFlower, drawBuilding, drawPlayerBuilding, drawBridge, drawSand, drawDock, drawFence, drawGarden, drawFlowerField, drawAgent, drawSpeechBubble, drawEmote, selectedAgentId]);

  const mapLoadedRef = useRef(false);

  const fetchWorldState = useCallback(async (includeMap = false) => {
    try {
      const url = includeMap ? '/api/world/state?includeMap=1' : '/api/world/state';
      const res = await fetch(url);
      const data = await res.json();
      agentsRef.current = data.agents || [];
      // Only update tiles if map data is present (first load only)
      if (data.map) {
        tilesRef.current = data.map.tiles || [];
        obstaclesRef.current = data.map.obstacles || [];
        mapLoadedRef.current = true;
      }
      treeStatesRef.current = data.treeStates || {};
      buildingsRef.current = data.buildings || [];
      // Build spatial index for buildings (O(1) lookup)
      buildingMapRef.current.clear();
      for (const b of buildingsRef.current) {
        buildingMapRef.current.set(`${b.x},${b.y}`, b);
      }
      worldTimeRef.current = data.time || null;
      forceUpdate(n => n + 1);
    } catch (err) {
      console.error('Failed to fetch world state:', err);
    }
  }, []);

  useEffect(() => {
    fetchWorldState(true); // First load: include map tiles
    const evtSource = new EventSource('/api/stream');
    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as GameEvent;
        switch (event.type) {
          case 'agent_join': case 'agent_leave': fetchWorldState(); break;
          case 'agent_move': {
            const { agentId, position, state, direction } = event.payload as { agentId: string; position: Position; state: string; direction: string };
            agentsRef.current = agentsRef.current.map(a => a.id === agentId ? { ...a, posX: position.x, posY: position.y, state: state as AgentData['state'], direction: (direction || a.direction) as AgentData['direction'] } : a);
            break;
          }
          case 'agent_state_change': {
            const { agentId, newState, energy, mood } = event.payload as { agentId: string; newState: string; energy: number; mood: string };
            agentsRef.current = agentsRef.current.map(a => a.id === agentId ? { ...a, state: newState as AgentData['state'], energy, mood: mood as AgentData['mood'] } : a);
            break;
          }
          case 'chat_message': {
            const { agentId, content } = event.payload as { agentId: string; content: string };
            const bubble = { agentId, text: content, expiresAt: Date.now() + SPEECH_BUBBLE_DURATION_MS };
            speechBubblesRef.current.push(bubble);
            speechBubbleMapRef.current.set(agentId, bubble); // O(1) lookup
            break;
          }
          case 'agent_emote': {
            const { agentId, emoji } = event.payload as { agentId: string; emoji: string };
            const emote = { agentId, emoji, expiresAt: Date.now() + EMOTE_DURATION_MS };
            emotesRef.current.push(emote);
            emoteMapRef.current.set(agentId, emote); // O(1) lookup
            break;
          }
          case 'tree_chopped': {
            const { agentId, x, y, woodGained } = event.payload as { agentId: string; x: number; y: number; woodGained: number };
            const key = `${x}_${y}`;
            treeStatesRef.current = { ...treeStatesRef.current, [key]: 'stump' };
            // Show axe animation
            const now = Date.now();
            floatingTextsRef.current.push({
              agentId,
              text: '🪓',
              color: '#ffffff',
              startedAt: now,
              expiresAt: now + 1000,
            });
            break;
          }
          case 'tree_regrown': {
            const { x, y } = event.payload as { x: number; y: number };
            const key = `${x}_${y}`;
            treeStatesRef.current = { ...treeStatesRef.current, [key]: 'full' };
            break;
          }
          case 'money_earned': {
            const { agentId, amount } = event.payload as { agentId: string; amount: number; position: { x: number; y: number } };
            const now = Date.now();
            floatingTextsRef.current.push({
              agentId,
              text: `+$${amount} 💰`,
              color: '#4CAF50',
              startedAt: now,
              expiresAt: now + FLOATING_TEXT_DURATION_MS,
            });
            break;
          }
          case 'item_collected': {
            const { agentId, item, quantity } = event.payload as { agentId: string; item: string; quantity: number };
            const now = Date.now();
            const emoji = item === 'wood' ? '🪵' : '🐟';
            floatingTextsRef.current.push({
              agentId,
              text: `+${quantity} ${emoji}`,
              color: '#2196F3',
              startedAt: now,
              expiresAt: now + FLOATING_TEXT_DURATION_MS,
            });
            break;
          }
          case 'activity_start': {
            const { agentId, activity, duration, targetX, targetY, ...extra } = event.payload as {
              agentId: string;
              activity: 'fishing' | 'chopping' | 'selling' | 'crafting' | 'building';
              duration: number;
              targetX?: number;
              targetY?: number;
              [key: string]: unknown;
            };
            agentActivitiesRef.current.set(agentId, {
              agentId,
              activity,
              startedAt: Date.now(),
              duration,
              targetX,
              targetY,
              extra,
            });
            break;
          }
          case 'weather_change':
          case 'time_change':
          case 'building_started':
          case 'building_progress':
          case 'building_completed': {
            // Refresh world state to get updated buildings and time
            fetchWorldState();
            break;
          }
          case 'world_tick': if (Math.random() < 0.1) fetchWorldState(); break; // 10% chance to refresh (for time/weather updates)
        }
      } catch { }
    };
    evtSource.onerror = () => { };
    return () => { evtSource.close(); };
  }, [fetchWorldState]);

  const cameraInitRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return; // Skip if canvas is hidden/transitioning
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
      }
    };

    // Debounced resize for smooth sidebar transitions
    const debouncedResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resize, 50);
    };

    resize();
    // Use ResizeObserver to catch sidebar toggle resizes
    const observer = new ResizeObserver(() => debouncedResize());
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    if (!cameraInitRef.current) {
      // Center camera on the middle of the map
      // gridToScreen(midX, midY) where mid = WORLD_WIDTH/2
      // At grid center (20,20): screenX = 0, screenY = (20+20) * TILE_HALF_H = 640
      const centerScreenY = (WORLD_WIDTH / 2 + WORLD_HEIGHT / 2) * TILE_HALF_H;
      const canvasH = canvas.clientHeight;
      const initY = (canvasH / 2 - 80) - centerScreenY;
      cameraRef.current.x = 0;
      cameraRef.current.y = initY;
      cameraRef.current.targetX = 0;
      cameraRef.current.targetY = initY;
      cameraInitRef.current = true;
    }
    animFrameRef.current = requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animFrameRef.current);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [render]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    cameraRef.current.animating = false;
    cameraRef.current.trackingAgentId = null; // Stop tracking when user starts dragging
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, camStartX: cameraRef.current.x, camStartY: cameraRef.current.y };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (dragRef.current.dragging) {
      const nx = dragRef.current.camStartX + (e.clientX - dragRef.current.startX);
      const ny = dragRef.current.camStartY + (e.clientY - dragRef.current.startY);
      cameraRef.current.x = nx; cameraRef.current.y = ny; cameraRef.current.targetX = nx; cameraRef.current.targetY = ny;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    // Inverse of render transform: translate(w/2 + cam.x, 80 + cam.y) → scale(zoom)
    const wmx = (e.clientX - rect.left - rect.width / 2 - cam.x) / cam.zoom;
    const wmy = (e.clientY - rect.top - 80 - cam.y) / cam.zoom;
    let found: string | null = null;
    for (const agent of agentsRef.current) {
      const rs = renderStatesRef.current.get(agent.id);
      const ax = rs ? rs.displayX : agent.posX, ay = rs ? rs.displayY : agent.posY;
      const dx = wmx - (ax - ay) * TILE_HALF_W, dy = wmy - (ax + ay) * TILE_HALF_H + 10;
      if (dx * dx + dy * dy < 250) { found = agent.id; break; }
    }
    hoveredAgentRef.current = found;
    canvas.style.cursor = found ? 'pointer' : 'grab';
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const dd = Math.abs(e.clientX - dragRef.current.startX) + Math.abs(e.clientY - dragRef.current.startY);
    dragRef.current.dragging = false;
    if (dd < 5 && hoveredAgentRef.current) {
      // Start tracking the clicked agent
      cameraRef.current.trackingAgentId = hoveredAgentRef.current;
      onAgentClick?.(hoveredAgentRef.current);
    }
  }, [onAgentClick]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const cam = cameraRef.current;
    const oldZoom = cam.zoom;
    const newZoom = Math.max(0.3, Math.min(3, oldZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    // Zoom toward mouse position: adjust camera so point under cursor stays fixed
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - 80;
      cam.x = mx - (mx - cam.x) * (newZoom / oldZoom);
      cam.y = my - (my - cam.y) * (newZoom / oldZoom);
      cam.targetX = cam.x;
      cam.targetY = cam.y;
    }
    cam.zoom = newZoom;
    onZoomChange?.(newZoom);
  }, [onZoomChange]);

  // Touch event handlers for mobile
  const touchRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; pinchDist: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    cameraRef.current.animating = false;
    cameraRef.current.trackingAgentId = null;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        pinchDist: 0,
      };
      dragRef.current = {
        dragging: true,
        startX: touch.clientX,
        startY: touch.clientY,
        camStartX: cameraRef.current.x,
        camStartY: cameraRef.current.y,
      };
    } else if (e.touches.length === 2) {
      // Pinch zoom start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current = {
        startX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        startY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        lastX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        lastY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        pinchDist: Math.sqrt(dx * dx + dy * dy),
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchRef.current) return;

    if (e.touches.length === 1 && dragRef.current.dragging) {
      const touch = e.touches[0];
      const nx = dragRef.current.camStartX + (touch.clientX - dragRef.current.startX);
      const ny = dragRef.current.camStartY + (touch.clientY - dragRef.current.startY);
      cameraRef.current.x = nx;
      cameraRef.current.y = ny;
      cameraRef.current.targetX = nx;
      cameraRef.current.targetY = ny;
      touchRef.current.lastX = touch.clientX;
      touchRef.current.lastY = touch.clientY;
    } else if (e.touches.length === 2 && touchRef.current.pinchDist > 0) {
      // Pinch zoom — centered between the two touch points
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scale = newDist / touchRef.current.pinchDist;

      const cam = cameraRef.current;
      const canvas = canvasRef.current;
      const oldZoom = cam.zoom;
      const newZoom = Math.max(0.3, Math.min(3, oldZoom * scale));

      // Zoom toward pinch midpoint (same math as mouse wheel)
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const mx = midX - rect.left - rect.width / 2;
        const my = midY - rect.top - 80;
        cam.x = mx - (mx - cam.x) * (newZoom / oldZoom);
        cam.y = my - (my - cam.y) * (newZoom / oldZoom);
        cam.targetX = cam.x;
        cam.targetY = cam.y;
      }

      cam.zoom = newZoom;
      onZoomChange?.(newZoom);

      touchRef.current.pinchDist = newDist;
    }
  }, [onZoomChange]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;

    // Check if it was a tap (minimal movement)
    const dd = Math.abs(touchRef.current.lastX - touchRef.current.startX) +
               Math.abs(touchRef.current.lastY - touchRef.current.startY);

    if (dd < 10 && e.changedTouches.length === 1) {
      // Check if tapped on an agent
      const canvas = canvasRef.current;
      if (canvas) {
        const touch = e.changedTouches[0];
        const rect = canvas.getBoundingClientRect();
        const cam = cameraRef.current;
        const wmx = (touch.clientX - rect.left - rect.width / 2 - cam.x) / cam.zoom;
        const wmy = (touch.clientY - rect.top - 80 - cam.y) / cam.zoom;

        for (const agent of agentsRef.current) {
          const rs = renderStatesRef.current.get(agent.id);
          const ax = rs ? rs.displayX : agent.posX;
          const ay = rs ? rs.displayY : agent.posY;
          const adx = wmx - (ax - ay) * TILE_HALF_W;
          const ady = wmy - (ax + ay) * TILE_HALF_H + 10;
          if (adx * adx + ady * ady < 400) { // Slightly larger hit area for touch
            cameraRef.current.trackingAgentId = agent.id;
            onAgentClick?.(agent.id);
            break;
          }
        }
      }
    }

    dragRef.current.dragging = false;
    touchRef.current = null;
  }, [onAgentClick]);

  return (
    <canvas ref={canvasRef} className="w-full h-full block touch-none" style={{ imageRendering: 'pixelated' }}
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
      onMouseLeave={() => { dragRef.current.dragging = false; }} onWheel={handleWheel}
      onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
    />
  );
}

function darkenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`;
}
function lightenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.min(255, Math.round(r + (255 - r) * amount))},${Math.min(255, Math.round(g + (255 - g) * amount))},${Math.min(255, Math.round(b + (255 - b) * amount))})`;
}
