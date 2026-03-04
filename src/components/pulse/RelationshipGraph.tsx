'use client';

// ============================================================
// Canvas 2D force-directed relationship graph
// ============================================================

import { useRef, useEffect, useCallback } from 'react';
import type { AgentData, RelationshipData, GameEvent } from '@/types';
import {
  GraphNode, GraphEdge,
  initializeNodes, buildEdges, stepSimulation,
  applyDrift, advancePulses, findNodeAtPoint, isSettled,
} from './graph-physics';

interface Props {
  agents: AgentData[];
  relationships: (RelationshipData & { agent1Name: string; agent2Name: string })[];
  events: GameEvent[];
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  onNodeHover: (id: string | null) => void;
}

const EDGE_COLORS: Record<string, string> = {
  rival: '#e74c3c',
  stranger: '#95a5a6',
  acquaintance: '#3498db',
  friend: '#2ecc71',
  close_friend: '#e91e8a',
};

function getLevel(exp: number): number {
  return Math.floor(Math.sqrt((exp || 0) / 100)) + 1;
}

export default function RelationshipGraph({
  agents, relationships, events, selectedNodeId, hoveredNodeId, onNodeSelect, onNodeHover,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>(0);
  const settledRef = useRef(false);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startOX: number; startOY: number } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  // ── Reconcile agents & relationships into nodes/edges ─────
  useEffect(() => {
    if (agents.length === 0) return;
    const w = sizeRef.current.w || window.innerWidth;
    const h = sizeRef.current.h || window.innerHeight;

    const existing = new Map(nodesRef.current.map(n => [n.id, n]));
    const newNodes: GraphNode[] = [];

    for (const a of agents) {
      const appearance = typeof a.appearance === 'string' ? JSON.parse(a.appearance) : a.appearance;
      const prev = existing.get(a.id);
      if (prev) {
        // Update data, keep position
        prev.name = a.name;
        prev.color = appearance?.color || '#FFD93D';
        prev.level = getLevel(a.exp);
        prev.money = a.money;
        prev.radius = Math.max(6, Math.min(18, 6 + prev.level * 1.5));
        newNodes.push(prev);
      } else {
        // New node
        const initialized = initializeNodes(
          [{ id: a.id, name: a.name, color: appearance?.color || '#FFD93D', exp: a.exp, money: a.money }],
          w, h,
        );
        newNodes.push(initialized[0]);
      }
    }

    nodesRef.current = newNodes;
    edgesRef.current = buildEdges(relationships);
    settledRef.current = false;
  }, [agents, relationships]);

  // ── Flash nodes on SSE events ─────────────────────────────
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    const payload = latest.payload as Record<string, string>;
    const agentId = payload?.agentId || payload?.agent1Id;
    if (agentId) {
      const node = nodesRef.current.find(n => n.id === agentId);
      if (node) node.flashUntil = Date.now() + 800;
    }
  }, [events]);

  // ── Animation loop ────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      sizeRef.current = { w, h };
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const scale = scaleRef.current;
    const ox = offsetRef.current.x;
    const oy = offsetRef.current.y;
    const now = Date.now();

    // Physics step
    if (!settledRef.current) {
      stepSimulation(nodes, edges, w, h, 1);
      if (isSettled(nodes)) settledRef.current = true;
    } else {
      applyDrift(nodes, now);
    }
    advancePulses(edges, 1);

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Draw subtle grid
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 0.5;
    const gridSize = 60;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // ── Draw edges ──────────────────────────────────────────
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;

      const isHighlighted = selectedNodeId === edge.source || selectedNodeId === edge.target
        || hoveredNodeId === edge.source || hoveredNodeId === edge.target;
      const baseAlpha = isHighlighted ? 0.7 : Math.min(0.5, Math.abs(edge.score) / 100 * 0.5 + 0.05);
      const color = EDGE_COLORS[edge.status] || '#95a5a6';
      const lw = edge.status === 'close_friend' ? 2 : edge.status === 'friend' ? 1.5 : 0.8;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = baseAlpha;
      ctx.lineWidth = lw;
      if (edge.status === 'rival') ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      // Pulse dot for friend/close_friend
      if (edge.status === 'close_friend' || edge.status === 'friend') {
        const px = a.x + (b.x - a.x) * edge.pulseT;
        const py = a.y + (b.y - a.y) * edge.pulseT;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // ── Draw nodes ──────────────────────────────────────────
    for (const node of nodes) {
      const isSelected = selectedNodeId === node.id;
      const isHovered = hoveredNodeId === node.id;
      const isFlashing = now < node.flashUntil;

      // Glow for selected/hovered
      if (isSelected || isHovered) {
        const glowR = node.radius + 8;
        const grad = ctx.createRadialGradient(node.x, node.y, node.radius, node.x, node.y, glowR);
        grad.addColorStop(0, node.color + '60');
        grad.addColorStop(1, node.color + '00');
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Flash effect
      const flashScale = isFlashing ? 1 + 0.3 * Math.sin((now - (node.flashUntil - 800)) / 100 * Math.PI) : 1;
      const r = node.radius * flashScale;

      // Node body
      const bodyGrad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r);
      bodyGrad.addColorStop(0, node.color);
      bodyGrad.addColorStop(1, node.color + 'AA');
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // Border
      ctx.strokeStyle = isSelected ? '#fff' : isHovered ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Label (only show if zoomed enough or node is big enough)
      if (scale > 0.5 || node.radius > 10 || isSelected || isHovered) {
        ctx.font = `${isSelected || isHovered ? 'bold ' : ''}10px "Nunito", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isSelected || isHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)';
        ctx.fillText(node.name, node.x, node.y + r + 12);
      }
    }

    ctx.restore();

    animRef.current = requestAnimationFrame(render);
  }, [selectedNodeId, hoveredNodeId]);

  // ── Start/stop animation loop ─────────────────────────────
  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  // ── Mouse/touch handlers ──────────────────────────────────
  const getCanvasPoint = (e: React.MouseEvent | MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pt = getCanvasPoint(e);

    if (dragRef.current) {
      const node = nodesRef.current.find(n => n.id === dragRef.current!.nodeId);
      if (node) {
        const s = scaleRef.current;
        node.x = (pt.x - offsetRef.current.x) / s;
        node.y = (pt.y - offsetRef.current.y) / s;
        node.vx = 0;
        node.vy = 0;
      }
      return;
    }

    if (panRef.current) {
      offsetRef.current.x = panRef.current.startOX + (pt.x - panRef.current.startX);
      offsetRef.current.y = panRef.current.startOY + (pt.y - panRef.current.startY);
      return;
    }

    const hit = findNodeAtPoint(nodesRef.current, pt.x, pt.y, scaleRef.current, offsetRef.current.x, offsetRef.current.y);
    onNodeHover(hit?.id || null);

    if (canvasRef.current) {
      canvasRef.current.style.cursor = hit ? 'pointer' : 'grab';
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pt = getCanvasPoint(e);
    const hit = findNodeAtPoint(nodesRef.current, pt.x, pt.y, scaleRef.current, offsetRef.current.x, offsetRef.current.y);

    if (hit) {
      dragRef.current = { nodeId: hit.id, startX: pt.x, startY: pt.y };
    } else {
      panRef.current = { startX: pt.x, startY: pt.y, startOX: offsetRef.current.x, startOY: offsetRef.current.y };
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const pt = getCanvasPoint(e);

    if (dragRef.current) {
      const dx = Math.abs(pt.x - dragRef.current.startX);
      const dy = Math.abs(pt.y - dragRef.current.startY);
      if (dx < 5 && dy < 5) {
        // Click (not drag)
        onNodeSelect(dragRef.current.nodeId === selectedNodeId ? null : dragRef.current.nodeId);
      }
      dragRef.current = null;
    } else if (panRef.current) {
      panRef.current = null;
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const pt = getCanvasPoint(e);
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.3, Math.min(3, scaleRef.current * delta));

    // Zoom toward cursor
    const ratio = newScale / scaleRef.current;
    offsetRef.current.x = pt.x - (pt.x - offsetRef.current.x) * ratio;
    offsetRef.current.y = pt.y - (pt.y - offsetRef.current.y) * ratio;
    scaleRef.current = newScale;
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { dragRef.current = null; panRef.current = null; onNodeHover(null); }}
      onWheel={handleWheel}
    />
  );
}
