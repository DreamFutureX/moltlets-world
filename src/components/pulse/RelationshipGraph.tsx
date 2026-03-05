'use client';

// ============================================================
// Jarvis-style relationship graph — Canvas 2D
// IDLE: floating nodes + scanning beams (no edge spaghetti)
// HOVER: ghost-line preview of top connections
// SELECT: smooth zoom + animated radial edges + data labels
// ============================================================

import { useRef, useEffect, useCallback } from 'react';
import type { AgentData, RelationshipData, GameEvent } from '@/types';
import {
  GraphNode, GraphEdge,
  initializeNodes, buildEdges, stepSimulation,
  applyDrift, advancePulses, findNodeAtPoint, isSettled,
  getEdgesForNode, pickRandomEdge,
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
  rival: '#e74c3c', stranger: '#95a5a6', acquaintance: '#3498db',
  friend: '#2ecc71', close_friend: '#e91e8a',
};
const STATUS_LABEL: Record<string, string> = {
  rival: '⚔️', stranger: '👋', acquaintance: '🤝',
  friend: '💚', close_friend: '❤️',
};
const STATE_EMOJI: Record<string, string> = {
  idle: '💤', walking: '🚶', talking: '💬', sleeping: '😴',
  building: '🔨', fishing: '🎣', chopping: '🪓',
};

function getLevel(exp: number): number {
  return Math.floor(Math.sqrt((exp || 0) / 100)) + 1;
}

// ── Types ────────────────────────────────────────────────────

interface Particle { x: number; y: number; vx: number; vy: number; size: number; alpha: number; }
interface Ripple { x: number; y: number; r: number; maxR: number; color: string; startTime: number; }
interface ScanBeam { sourceId: string; targetId: string; color: string; startTime: number; duration: number; }
interface CameraTarget { x: number; y: number; scale: number; fromX: number; fromY: number; fromScale: number; startTime: number; duration: number; }

function initParticles(w: number, h: number): Particle[] {
  return Array.from({ length: 35 }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
    size: Math.random() * 1.8 + 0.4, alpha: Math.random() * 0.12 + 0.03,
  }));
}

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

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

  // Jarvis-specific refs
  const scanBeamsRef = useRef<ScanBeam[]>([]);
  const lastBeamTimeRef = useRef(0);
  const cameraTargetRef = useRef<CameraTarget | null>(null);
  const selectTimeRef = useRef(0); // when selection happened (for edge draw-on animation)
  const defaultCameraRef = useRef({ x: 0, y: 0, scale: 1 }); // to return to

  // Interactive state in refs
  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const onSelectRef = useRef(onNodeSelect);
  const onHoverRef = useRef(onNodeHover);

  useEffect(() => {
    const prev = selectedRef.current;
    selectedRef.current = selectedNodeId;

    if (selectedNodeId && selectedNodeId !== prev) {
      // Zoom to selected node
      selectTimeRef.current = Date.now();
      const node = nodesRef.current.find(n => n.id === selectedNodeId);
      if (node) {
        const w = sizeRef.current.w || window.innerWidth;
        const h = sizeRef.current.h || window.innerHeight;
        const targetScale = 1.4;
        const targetX = w / 2 - node.x * targetScale;
        const targetY = h / 2 - node.y * targetScale;
        cameraTargetRef.current = {
          x: targetX, y: targetY, scale: targetScale,
          fromX: offsetRef.current.x, fromY: offsetRef.current.y, fromScale: scaleRef.current,
          startTime: Date.now(), duration: 500,
        };
      }
    } else if (!selectedNodeId && prev) {
      // Zoom back to default
      const def = defaultCameraRef.current;
      cameraTargetRef.current = {
        x: def.x, y: def.y, scale: def.scale,
        fromX: offsetRef.current.x, fromY: offsetRef.current.y, fromScale: scaleRef.current,
        startTime: Date.now(), duration: 400,
      };
    }
  }, [selectedNodeId]);
  useEffect(() => { hoveredRef.current = hoveredNodeId; }, [hoveredNodeId]);
  useEffect(() => { onSelectRef.current = onNodeSelect; }, [onNodeSelect]);
  useEffect(() => { onHoverRef.current = onNodeHover; }, [onNodeHover]);

  // ── Reconcile data ─────────────────────────────────────────

  useEffect(() => {
    if (agents.length === 0) return;
    const w = sizeRef.current.w || window.innerWidth;
    const h = sizeRef.current.h || window.innerHeight;
    if (particlesRef.current.length === 0) particlesRef.current = initParticles(w, h);

    const existing = new Map(nodesRef.current.map(n => [n.id, n]));
    const newNodes: GraphNode[] = [];
    for (const a of agents) {
      const appearance = typeof a.appearance === 'string' ? JSON.parse(a.appearance) : a.appearance;
      const prev = existing.get(a.id);
      if (prev) {
        prev.name = a.name; prev.color = appearance?.color || '#FFD93D';
        prev.level = getLevel(a.exp); prev.money = a.money; prev.state = a.state;
        prev.radius = Math.max(6, Math.min(18, 6 + prev.level * 1.5));
        newNodes.push(prev);
      } else {
        newNodes.push(initializeNodes(
          [{ id: a.id, name: a.name, color: appearance?.color || '#FFD93D', exp: a.exp, money: a.money, state: a.state }], w, h,
        )[0]);
      }
    }
    nodesRef.current = newNodes;
    edgesRef.current = buildEdges(relationships);
    settledRef.current = false;
  }, [agents, relationships]);

  // Flash on events
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

  // ── RENDER LOOP ────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { animRef.current = requestAnimationFrame(render); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { animRef.current = requestAnimationFrame(render); return; }

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
      sizeRef.current = { w, h };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const now = Date.now();
    const selected = selectedRef.current;
    const hovered = hoveredRef.current;

    // ── Physics ──────────────────────────────────────────────
    if (!settledRef.current && nodes.length > 0) {
      stepSimulation(nodes, edges, w, h, 1);
      if (isSettled(nodes)) {
        settledRef.current = true;
        defaultCameraRef.current = { x: offsetRef.current.x, y: offsetRef.current.y, scale: scaleRef.current };
      }
    } else {
      applyDrift(nodes, now);
    }
    advancePulses(edges, 1);

    // ── Camera animation ─────────────────────────────────────
    const cam = cameraTargetRef.current;
    if (cam) {
      const elapsed = now - cam.startTime;
      const t = Math.min(1, elapsed / cam.duration);
      const e = easeOutCubic(t);
      offsetRef.current.x = cam.fromX + (cam.x - cam.fromX) * e;
      offsetRef.current.y = cam.fromY + (cam.y - cam.fromY) * e;
      scaleRef.current = cam.fromScale + (cam.scale - cam.fromScale) * e;
      if (t >= 1) cameraTargetRef.current = null;
    }

    const scale = scaleRef.current;
    const ox = offsetRef.current.x;
    const oy = offsetRef.current.y;

    // ── Background ───────────────────────────────────────────
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#10102a');
    bgGrad.addColorStop(0.5, '#1a1a2e');
    bgGrad.addColorStop(1, '#141430');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // ── Particles ────────────────────────────────────────────
    for (const p of particlesRef.current) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120, 140, 255, ${p.alpha})`;
      ctx.fill();
    }

    // ── Ripples (screen space) ───────────────────────────────
    const ripples = ripplesRef.current;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rip = ripples[i];
      const age = (now - rip.startTime) / 600;
      if (age > 1) { ripples.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(rip.x * scale + ox, rip.y * scale + oy, (rip.r + (rip.maxR - rip.r) * age) * scale, 0, Math.PI * 2);
      ctx.strokeStyle = rip.color; ctx.globalAlpha = 0.3 * (1 - age); ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ── Graph transform ──────────────────────────────────────
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // ── SCANNING BEAMS (idle animation) ──────────────────────
    if (!selected) {
      // Spawn new beam every ~2s
      if (now - lastBeamTimeRef.current > 1800 && edges.length > 0) {
        const edge = pickRandomEdge(edges);
        if (edge) {
          scanBeamsRef.current.push({
            sourceId: edge.source, targetId: edge.target,
            color: EDGE_COLORS[edge.status] || '#3498db',
            startTime: now, duration: 900,
          });
          lastBeamTimeRef.current = now;
        }
        // Keep max 4 active beams
        if (scanBeamsRef.current.length > 4) scanBeamsRef.current.shift();
      }

      // Draw active beams
      for (let i = scanBeamsRef.current.length - 1; i >= 0; i--) {
        const beam = scanBeamsRef.current[i];
        const a = nodeMap.get(beam.sourceId);
        const b = nodeMap.get(beam.targetId);
        if (!a || !b) { scanBeamsRef.current.splice(i, 1); continue; }

        const elapsed = now - beam.startTime;
        const progress = Math.min(1, elapsed / beam.duration);
        const fadeOut = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;

        if (progress >= 1) { scanBeamsRef.current.splice(i, 1); continue; }

        // Fading trail line behind the dot
        const trailLen = 0.25;
        const trailStart = Math.max(0, progress - trailLen);
        const tx1 = a.x + (b.x - a.x) * trailStart;
        const ty1 = a.y + (b.y - a.y) * trailStart;
        const tx2 = a.x + (b.x - a.x) * progress;
        const ty2 = a.y + (b.y - a.y) * progress;

        const trailGrad = ctx.createLinearGradient(tx1, ty1, tx2, ty2);
        trailGrad.addColorStop(0, beam.color + '00');
        trailGrad.addColorStop(1, beam.color + 'AA');
        ctx.beginPath(); ctx.moveTo(tx1, ty1); ctx.lineTo(tx2, ty2);
        ctx.strokeStyle = trailGrad; ctx.globalAlpha = fadeOut * 0.6; ctx.lineWidth = 1.5;
        ctx.stroke(); ctx.globalAlpha = 1;

        // Glowing dot at head
        const dx = a.x + (b.x - a.x) * progress;
        const dy = a.y + (b.y - a.y) * progress;
        const dotGrad = ctx.createRadialGradient(dx, dy, 0, dx, dy, 6);
        dotGrad.addColorStop(0, beam.color);
        dotGrad.addColorStop(1, beam.color + '00');
        ctx.beginPath(); ctx.arc(dx, dy, 6, 0, Math.PI * 2);
        ctx.fillStyle = dotGrad; ctx.globalAlpha = fadeOut; ctx.fill();
        ctx.beginPath(); ctx.arc(dx, dy, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.globalAlpha = fadeOut * 0.9; ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // ── HOVER PREVIEW EDGES ──────────────────────────────────
    if (hovered && !selected) {
      const hoverEdges = getEdgesForNode(edges, hovered, 3);
      for (const edge of hoverEdges) {
        const a = nodeMap.get(edge.source);
        const b = nodeMap.get(edge.target);
        if (!a || !b) continue;

        const color = EDGE_COLORS[edge.status] || '#95a5a6';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.2; ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }

    // ── SELECTED: animated radial edges ──────────────────────
    const connSet = new Set<string>();
    if (selected) {
      connSet.add(selected);
      const selEdges = getEdgesForNode(edges, selected, 12);
      const selectAge = now - selectTimeRef.current;
      const drawOnProgress = Math.min(1, selectAge / 400); // 400ms draw-on

      for (const edge of selEdges) {
        const selNode = nodeMap.get(selected);
        const otherId = edge.source === selected ? edge.target : edge.source;
        const otherNode = nodeMap.get(otherId);
        if (!selNode || !otherNode) continue;
        connSet.add(otherId);

        const color = EDGE_COLORS[edge.status] || '#95a5a6';

        // Draw-on animation: edge grows from selected node outward
        const endX = selNode.x + (otherNode.x - selNode.x) * easeOutCubic(drawOnProgress);
        const endY = selNode.y + (otherNode.y - selNode.y) * easeOutCubic(drawOnProgress);

        // Edge line with glow
        ctx.beginPath(); ctx.moveTo(selNode.x, selNode.y); ctx.lineTo(endX, endY);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.15; ctx.lineWidth = 6; ctx.stroke(); // glow
        ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
        if (edge.status === 'rival') ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;

        // Traveling pulse dot
        if (drawOnProgress >= 1) {
          const px = selNode.x + (otherNode.x - selNode.x) * edge.pulseT;
          const py = selNode.y + (otherNode.y - selNode.y) * edge.pulseT;
          ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1;
        }

        // Score label at midpoint (after draw-on completes)
        if (drawOnProgress >= 1) {
          const mx = (selNode.x + otherNode.x) / 2;
          const my = (selNode.y + otherNode.y) / 2;
          const label = `${edge.score > 0 ? '+' : ''}${edge.score} ${STATUS_LABEL[edge.status] || ''}`;
          ctx.font = 'bold 8px "Nunito", sans-serif';
          const tw = ctx.measureText(label).width + 8;
          ctx.beginPath();
          ctx.roundRect(mx - tw / 2, my - 8, tw, 14, 4);
          ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fill();
          ctx.fillStyle = color; ctx.globalAlpha = 0.9;
          ctx.textAlign = 'center'; ctx.fillText(label, mx, my + 3);
          ctx.globalAlpha = 1;
        }
      }
    }

    // ── DRAW NODES ───────────────────────────────────────────
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isSelected = selected === node.id;
      const isHovered = hovered === node.id;
      const isFlashing = now < node.flashUntil;
      const isConn = !selected || connSet.has(node.id);
      const dimmed = selected && !isConn;

      const breathe = 1 + Math.sin(now * 0.002 + i * 1.7) * 0.04;
      const flashScale = isFlashing ? 1 + 0.25 * Math.sin((now - (node.flashUntil - 800)) / 80 * Math.PI) : 1;
      const hoverScale = isHovered ? 1.25 : isSelected ? 1.15 : 1;
      const r = node.radius * breathe * flashScale * hoverScale;

      ctx.globalAlpha = dimmed ? 0.08 : 1;

      // Glow
      if ((isSelected || isHovered || isFlashing) && !dimmed) {
        const glowR = r + (isSelected ? 20 : 10);
        const grad = ctx.createRadialGradient(node.x, node.y, r * 0.3, node.x, node.y, glowR);
        grad.addColorStop(0, node.color + '50');
        grad.addColorStop(1, node.color + '00');
        ctx.beginPath(); ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();
      }

      // Spinning ring for selected node
      if (isSelected) {
        const ringR = r + 6;
        const ringAngle = now * 0.003;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringR, ringAngle, ringAngle + Math.PI * 1.2);
        ctx.strokeStyle = node.color + '80'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringR, ringAngle + Math.PI, ringAngle + Math.PI * 2.2);
        ctx.strokeStyle = node.color + '40'; ctx.lineWidth = 1; ctx.stroke();
      }

      // Node body
      const bodyGrad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r);
      bodyGrad.addColorStop(0, node.color); bodyGrad.addColorStop(1, node.color + 'AA');
      ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad; ctx.fill();

      ctx.strokeStyle = isSelected ? '#fff' : isHovered ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = isSelected ? 2.5 : isHovered ? 1.5 : 0.5;
      ctx.stroke();

      // Name label
      if (!dimmed && (scale > 0.5 || r > 10 || isSelected || isHovered)) {
        ctx.font = `${isSelected || isHovered ? 'bold ' : ''}${isHovered ? 11 : 9}px "Nunito", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isSelected || isHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)';
        ctx.fillText(node.name, node.x, node.y + r + 13);
      }

      // State emoji
      if ((isHovered || isSelected) && !dimmed && node.state) {
        const emoji = STATE_EMOJI[node.state] || '';
        if (emoji) {
          ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.globalAlpha = 1;
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
        ctx.beginPath(); ctx.roundRect(tx, tipY, tw, 24, 8);
        ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fill();
        ctx.strokeStyle = node.color + '50'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.fillText(text, tx + tw / 2, tipY + 16);
      }
    }

    animRef.current = requestAnimationFrame(render);
  }, []);

  // ── Animation loop ─────────────────────────────────────────
  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  // ── Mouse handlers ─────────────────────────────────────────

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
        node.x = (pt.x - offsetRef.current.x) / scaleRef.current;
        node.y = (pt.y - offsetRef.current.y) / scaleRef.current;
        node.vx = 0; node.vy = 0;
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
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'grab';
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
        onSelectRef.current(id === selectedRef.current ? null : id);
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
      if (dx < 3 && dy < 3) onSelectRef.current(null);
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
    // Update default camera so zoom-back returns here
    if (!selectedRef.current) {
      defaultCameraRef.current = { x: offsetRef.current.x, y: offsetRef.current.y, scale: newScale };
    }
  }, [getCanvasPoint]);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null; panRef.current = null; onHoverRef.current(null);
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
