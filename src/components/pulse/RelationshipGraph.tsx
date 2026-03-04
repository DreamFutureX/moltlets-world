'use client';

// ============================================================
// Canvas 2D force-directed relationship graph
// Stable animation loop — interactive state via refs
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

const STATE_EMOJI: Record<string, string> = {
  idle: '💤', walking: '🚶', talking: '💬', sleeping: '😴',
  building: '🔨', fishing: '🎣', chopping: '🪓',
};

function getLevel(exp: number): number {
  return Math.floor(Math.sqrt((exp || 0) / 100)) + 1;
}

// ── Background particles ─────────────────────────────────────

interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; alpha: number;
}

function initParticles(w: number, h: number): Particle[] {
  return Array.from({ length: 35 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.25,
    vy: (Math.random() - 0.5) * 0.25,
    size: Math.random() * 1.8 + 0.4,
    alpha: Math.random() * 0.12 + 0.03,
  }));
}

// ── Ripple effect on node click ──────────────────────────────

interface Ripple {
  x: number; y: number; r: number; maxR: number;
  color: string; startTime: number;
}

// ── Component ────────────────────────────────────────────────

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
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);

  // Interactive state in refs — keeps animation loop stable
  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const onSelectRef = useRef(onNodeSelect);
  const onHoverRef = useRef(onNodeHover);

  useEffect(() => { selectedRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { hoveredRef.current = hoveredNodeId; }, [hoveredNodeId]);
  useEffect(() => { onSelectRef.current = onNodeSelect; }, [onNodeSelect]);
  useEffect(() => { onHoverRef.current = onNodeHover; }, [onNodeHover]);

  // ── Reconcile agents & relationships into nodes/edges ──────

  useEffect(() => {
    if (agents.length === 0) return;
    const w = sizeRef.current.w || window.innerWidth;
    const h = sizeRef.current.h || window.innerHeight;

    if (particlesRef.current.length === 0) {
      particlesRef.current = initParticles(w, h);
    }

    const existing = new Map(nodesRef.current.map(n => [n.id, n]));
    const newNodes: GraphNode[] = [];

    for (const a of agents) {
      const appearance = typeof a.appearance === 'string' ? JSON.parse(a.appearance) : a.appearance;
      const prev = existing.get(a.id);
      if (prev) {
        prev.name = a.name;
        prev.color = appearance?.color || '#FFD93D';
        prev.level = getLevel(a.exp);
        prev.money = a.money;
        prev.state = a.state;
        prev.radius = Math.max(6, Math.min(18, 6 + prev.level * 1.5));
        newNodes.push(prev);
      } else {
        const initialized = initializeNodes(
          [{ id: a.id, name: a.name, color: appearance?.color || '#FFD93D', exp: a.exp, money: a.money, state: a.state }],
          w, h,
        );
        newNodes.push(initialized[0]);
      }
    }

    nodesRef.current = newNodes;
    edgesRef.current = buildEdges(relationships);
    settledRef.current = false;
  }, [agents, relationships]);

  // ── Flash nodes on SSE events ──────────────────────────────

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

  // ── Stable animation loop (ZERO changing deps) ─────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { animRef.current = requestAnimationFrame(render); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { animRef.current = requestAnimationFrame(render); return; }

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
    const particles = particlesRef.current;
    const ripples = ripplesRef.current;
    const scale = scaleRef.current;
    const ox = offsetRef.current.x;
    const oy = offsetRef.current.y;
    const now = Date.now();
    const selected = selectedRef.current;
    const hovered = hoveredRef.current;

    // ── Physics ──────────────────────────────────────────────
    if (!settledRef.current && nodes.length > 0) {
      stepSimulation(nodes, edges, w, h, 1);
      if (isSettled(nodes)) settledRef.current = true;
    } else {
      applyDrift(nodes, now);
    }
    advancePulses(edges, 1);

    // ── Background ───────────────────────────────────────────
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#10102a');
    bgGrad.addColorStop(0.5, '#1a1a2e');
    bgGrad.addColorStop(1, '#141430');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // ── Particles (before graph transform) ───────────────────
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120, 140, 255, ${p.alpha})`;
      ctx.fill();
    }

    // ── Ripples (screen space) ───────────────────────────────
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rip = ripples[i];
      const age = (now - rip.startTime) / 600;
      if (age > 1) { ripples.splice(i, 1); continue; }
      const r = rip.r + (rip.maxR - rip.r) * age;
      const alpha = 0.3 * (1 - age);
      ctx.beginPath();
      ctx.arc(rip.x * scale + ox, rip.y * scale + oy, r * scale, 0, Math.PI * 2);
      ctx.strokeStyle = rip.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ── Graph transform ──────────────────────────────────────
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Build connected-to-selected set
    const connSet = new Set<string>();
    const connEdgeSet = new Set<string>();
    if (selected) {
      connSet.add(selected);
      for (const edge of edges) {
        if (edge.source === selected || edge.target === selected) {
          connSet.add(edge.source);
          connSet.add(edge.target);
          connEdgeSet.add(edge.source + ':' + edge.target);
        }
      }
    }

    // ── Draw edges ───────────────────────────────────────────
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;

      const edgeKey = edge.source + ':' + edge.target;
      const isConnEdge = !selected || connEdgeSet.has(edgeKey);
      const isHovEdge = !selected && (hovered === edge.source || hovered === edge.target);

      let alpha = isConnEdge ? 0.35 : 0.03;
      if (isHovEdge) alpha = 0.55;

      const color = EDGE_COLORS[edge.status] || '#95a5a6';
      const lw = edge.status === 'close_friend' ? 2.5 : edge.status === 'friend' ? 1.5 : edge.status === 'rival' ? 1.2 : 0.6;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      if (edge.status === 'rival') ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      // Pulse dot on strong relationships
      if ((edge.status === 'close_friend' || edge.status === 'friend') && isConnEdge) {
        const px = a.x + (b.x - a.x) * edge.pulseT;
        const py = a.y + (b.y - a.y) * edge.pulseT;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // ── Draw nodes ───────────────────────────────────────────
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isSelected = selected === node.id;
      const isHovered = hovered === node.id;
      const isFlashing = now < node.flashUntil;
      const isConn = !selected || connSet.has(node.id);
      const dimmed = selected && !isConn;

      // Breathing + flash + hover scale
      const breathe = 1 + Math.sin(now * 0.002 + i * 1.7) * 0.04;
      const flashScale = isFlashing ? 1 + 0.25 * Math.sin((now - (node.flashUntil - 800)) / 80 * Math.PI) : 1;
      const hoverScale = isHovered ? 1.25 : isSelected ? 1.15 : 1;
      const r = node.radius * breathe * flashScale * hoverScale;

      ctx.globalAlpha = dimmed ? 0.12 : 1;

      // Glow
      if ((isSelected || isHovered || isFlashing) && !dimmed) {
        const glowR = r + (isSelected ? 16 : 10);
        const grad = ctx.createRadialGradient(node.x, node.y, r * 0.3, node.x, node.y, glowR);
        grad.addColorStop(0, node.color + '50');
        grad.addColorStop(1, node.color + '00');
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Node body
      const bodyGrad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r);
      bodyGrad.addColorStop(0, node.color);
      bodyGrad.addColorStop(1, node.color + 'AA');
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // Border
      ctx.strokeStyle = isSelected ? '#fff' : isHovered ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = isSelected ? 2.5 : isHovered ? 1.5 : 0.6;
      ctx.stroke();

      // Name label
      if (!dimmed && (scale > 0.5 || r > 10 || isSelected || isHovered)) {
        ctx.font = `${isSelected || isHovered ? 'bold ' : ''}${isHovered ? 11 : 9}px "Nunito", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isSelected || isHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)';
        ctx.fillText(node.name, node.x, node.y + r + 13);
      }

      // State emoji on hover/select
      if ((isHovered || isSelected) && !dimmed && node.state) {
        const emoji = STATE_EMOJI[node.state] || '';
        if (emoji) {
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.globalAlpha = 1;
          ctx.fillText(emoji, node.x, node.y - r - 5);
        }
      }

      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // ── Tooltip (screen space) ───────────────────────────────
    if (hovered && !dragRef.current) {
      const node = nodes.find(n => n.id === hovered);
      if (node) {
        const sx = node.x * scale + ox;
        const sy = node.y * scale + oy;
        const tipY = sy - node.radius * scale * 1.3 - 32;

        const text = `${node.name}  ·  Lv${node.level}  ·  $${Math.round(node.money)}`;
        ctx.font = 'bold 11px "Nunito", sans-serif';
        const tw = ctx.measureText(text).width + 20;
        const tx = Math.max(4, Math.min(w - tw - 4, sx - tw / 2));

        // Tooltip pill
        ctx.beginPath();
        ctx.roundRect(tx, tipY, tw, 24, 8);
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fill();
        ctx.strokeStyle = node.color + '50';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(text, tx + tw / 2, tipY + 16);
      }
    }

    animRef.current = requestAnimationFrame(render);
  }, []); // ZERO deps — stable forever

  // ── Single animation loop ──────────────────────────────────

  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  // ── Mouse helpers ──────────────────────────────────────────

  const getCanvasPoint = useCallback((e: React.MouseEvent | MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
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
    onHoverRef.current(hit?.id || null);

    if (canvasRef.current) {
      canvasRef.current.style.cursor = hit ? 'pointer' : 'grab';
    }
  }, [getCanvasPoint]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pt = getCanvasPoint(e);
    const hit = findNodeAtPoint(nodesRef.current, pt.x, pt.y, scaleRef.current, offsetRef.current.x, offsetRef.current.y);

    if (hit) {
      dragRef.current = { nodeId: hit.id, startX: pt.x, startY: pt.y };
    } else {
      panRef.current = { startX: pt.x, startY: pt.y, startOX: offsetRef.current.x, startOY: offsetRef.current.y };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    }
  }, [getCanvasPoint]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const pt = getCanvasPoint(e);

    if (dragRef.current) {
      const dx = Math.abs(pt.x - dragRef.current.startX);
      const dy = Math.abs(pt.y - dragRef.current.startY);
      if (dx < 5 && dy < 5) {
        const id = dragRef.current.nodeId;
        const newSelected = id === selectedRef.current ? null : id;
        onSelectRef.current(newSelected);

        // Ripple effect
        const node = nodesRef.current.find(n => n.id === id);
        if (node) {
          ripplesRef.current.push({
            x: node.x, y: node.y, r: node.radius, maxR: node.radius + 60,
            color: node.color, startTime: Date.now(),
          });
        }
      }
      dragRef.current = null;
    } else if (panRef.current) {
      const dx = Math.abs(pt.x - panRef.current.startX);
      const dy = Math.abs(pt.y - panRef.current.startY);
      if (dx < 3 && dy < 3) {
        // Clicked empty space — deselect
        onSelectRef.current(null);
      }
      panRef.current = null;
    }

    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
  }, [getCanvasPoint]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const pt = getCanvasPoint(e);
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.3, Math.min(3, scaleRef.current * delta));

    const ratio = newScale / scaleRef.current;
    offsetRef.current.x = pt.x - (pt.x - offsetRef.current.x) * ratio;
    offsetRef.current.y = pt.y - (pt.y - offsetRef.current.y) * ratio;
    scaleRef.current = newScale;
  }, [getCanvasPoint]);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null;
    panRef.current = null;
    onHoverRef.current(null);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    />
  );
}
