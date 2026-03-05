'use client';

// ============================================================
// Three.js 3D Neural Network Visualization
// Glowing nodes, force physics, bloom, orbit camera,
// neural blinks, scanning beams, orbital rings, breathing
// ============================================================

import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { AgentData, RelationshipData, GameEvent } from '@/types';

interface Props {
  agents: AgentData[];
  relationships: (RelationshipData & { agent1Name: string; agent2Name: string })[];
  events: GameEvent[];
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  onNodeHover: (id: string | null) => void;
}

const STATUS_COLORS: Record<string, number> = {
  rival: 0xe74c3c, stranger: 0x95a5a6, acquaintance: 0x3498db,
  friend: 0x2ecc71, close_friend: 0xe91e8a,
};

function getLevel(exp: number): number {
  return Math.floor(Math.sqrt((exp || 0) / 100)) + 1;
}

function hexToThreeColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

// ── Types ────────────────────────────────────────────────────

interface Node3D {
  id: string;
  name: string;
  color: THREE.Color;
  level: number;
  money: number;
  state: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  core: THREE.Mesh;
  innerCore: THREE.Mesh;
  glow: THREE.Mesh;
  ring: THREE.Mesh;
  baseOpacity: number;
  breathPhase: number;
}

interface Edge3D {
  sourceId: string;
  targetId: string;
  score: number;
  status: string;
  interactionCount: number;
}

interface Blink {
  nodeId: string;
  startTime: number;
  duration: number;
}

interface ScanBeam {
  sourceId: string;
  targetId: string;
  mesh: THREE.Mesh;
  startTime: number;
  duration: number;
}

export default function BrainGraph({
  agents, relationships, events, selectedNodeId, hoveredNodeId, onNodeSelect, onNodeHover,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    composer: EffectComposer;
    nodes: Map<string, Node3D>;
    edges: Edge3D[];
    edgeLines: THREE.LineSegments | null;
    selectedEdgeLines: THREE.LineSegments | null;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    highlightRing: THREE.Mesh | null;
    particles: THREE.Points | null;
    blinks: Blink[];
    scanBeams: ScanBeam[];
    settled: boolean;
    frameCount: number;
    animId: number;
    savedCameraPos: THREE.Vector3 | null;
    savedCameraTarget: THREE.Vector3 | null;
    selectTime: number;
  } | null>(null);

  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const onSelectRef = useRef(onNodeSelect);
  const onHoverRef = useRef(onNodeHover);
  const agentsRef = useRef(agents);
  const relationshipsRef = useRef(relationships);

  useEffect(() => { selectedRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { hoveredRef.current = hoveredNodeId; }, [hoveredNodeId]);
  useEffect(() => { onSelectRef.current = onNodeSelect; }, [onNodeSelect]);
  useEffect(() => { onHoverRef.current = onNodeHover; }, [onNodeHover]);
  useEffect(() => { agentsRef.current = agents; }, [agents]);
  useEffect(() => { relationshipsRef.current = relationships; }, [relationships]);

  // ── Initialize Three.js scene ──────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030308);
    scene.fog = new THREE.FogExp2(0x030308, 0.0006);

    // Camera — further back for wider view
    const camera = new THREE.PerspectiveCamera(60, w / h, 1, 3000);
    camera.position.set(0, 150, 650);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    controls.maxDistance = 1500;
    controls.minDistance = 80;

    // Bloom — reduced to prevent blow-out
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.5, 0.35);
    composer.addPass(bloomPass);

    // Background particles — wider shell
    const particleCount = 500;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(particleCount * 3);
    const pCol = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = 600 + Math.random() * 1200;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pPos[i * 3 + 2] = r * Math.cos(phi);
      const b = 0.15 + Math.random() * 0.15;
      pCol[i * 3] = b * 0.5; pCol[i * 3 + 1] = b * 0.7; pCol[i * 3 + 2] = b;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: 1.2, vertexColors: true, transparent: true, opacity: 0.5, sizeAttenuation: true,
    }));
    scene.add(particles);

    // Highlight ring for hover
    const ringGeo = new THREE.RingGeometry(1, 1.3, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    });
    const highlightRing = new THREE.Mesh(ringGeo, ringMat);
    highlightRing.visible = false;
    scene.add(highlightRing);

    const state = {
      renderer, scene, camera, controls, composer,
      nodes: new Map<string, Node3D>(),
      edges: [] as Edge3D[],
      edgeLines: null as THREE.LineSegments | null,
      selectedEdgeLines: null as THREE.LineSegments | null,
      raycaster: new THREE.Raycaster(),
      mouse: new THREE.Vector2(-999, -999),
      highlightRing,
      particles,
      blinks: [] as Blink[],
      scanBeams: [] as ScanBeam[],
      settled: false,
      frameCount: 0,
      animId: 0,
      savedCameraPos: null as THREE.Vector3 | null,
      savedCameraTarget: null as THREE.Vector3 | null,
      selectTime: 0,
    };
    state.raycaster.params.Points = { threshold: 2 };
    sceneRef.current = state;

    const onResize = () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      composer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    const onMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      state.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      state.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const onClick = () => {
      state.raycaster.setFromCamera(state.mouse, camera);
      const cores = [...state.nodes.values()].map(n => n.core);
      const hits = state.raycaster.intersectObjects(cores);
      if (hits.length > 0) {
        const hitNode = [...state.nodes.values()].find(n => n.core === hits[0].object);
        if (hitNode) {
          onSelectRef.current(hitNode.id === selectedRef.current ? null : hitNode.id);
        }
      } else {
        onSelectRef.current(null);
      }
    };
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onClick);

    // ── Animation loop ──────────────────────────────────────
    const animate = () => {
      state.animId = requestAnimationFrame(animate);
      const now = Date.now();
      const nodes = state.nodes;
      const selected = selectedRef.current;
      const hovered = hoveredRef.current;

      // ── Force simulation ──────────────────────────────
      if (!state.settled && nodes.size > 0) {
        const nodeArr = [...nodes.values()];
        const n = nodeArr.length;

        // Stronger repulsion + wider cutoff
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const a = nodeArr[i]; const b = nodeArr[j];
            const dx = a.pos.x - b.pos.x;
            const dy = a.pos.y - b.pos.y;
            const dz = a.pos.z - b.pos.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            const dist = Math.sqrt(distSq) || 1;
            if (dist > 800) continue;
            const force = 3500 / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            const fz = (dz / dist) * force;
            a.vel.x += fx; a.vel.y += fy; a.vel.z += fz;
            b.vel.x -= fx; b.vel.y -= fy; b.vel.z -= fz;
          }
        }

        // Weaker edge attraction
        for (const edge of state.edges) {
          const a = nodes.get(edge.sourceId);
          const b = nodes.get(edge.targetId);
          if (!a || !b) continue;
          const dx = b.pos.x - a.pos.x;
          const dy = b.pos.y - a.pos.y;
          const dz = b.pos.z - a.pos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const force = dist * 0.0005;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          const fz = (dz / dist) * force;
          a.vel.x += fx; a.vel.y += fy; a.vel.z += fz;
          b.vel.x -= fx; b.vel.y -= fy; b.vel.z -= fz;
        }

        // Weaker centering + damping
        let totalV = 0;
        for (const node of nodeArr) {
          node.vel.x -= node.pos.x * 0.002;
          node.vel.y -= node.pos.y * 0.002;
          node.vel.z -= node.pos.z * 0.002;
          node.vel.multiplyScalar(0.88);
          node.pos.add(node.vel);
          node.core.position.copy(node.pos);
          node.innerCore.position.copy(node.pos);
          node.glow.position.copy(node.pos);
          node.ring.position.copy(node.pos);
          totalV += node.vel.length();
        }

        state.frameCount++;
        if (state.frameCount > 300 || totalV / n < 0.03) {
          state.settled = true;
        }
      }

      // ── Gentle drift after settled ────────────────────
      if (state.settled && nodes.size > 0) {
        const t = now * 0.001;
        let idx = 0;
        for (const node of nodes.values()) {
          const seed = idx * 1.7;
          node.pos.x += Math.sin(t * 0.3 + seed) * 0.08;
          node.pos.y += Math.cos(t * 0.25 + seed * 1.3) * 0.06;
          node.pos.z += Math.sin(t * 0.2 + seed * 0.7) * 0.05;
          node.core.position.copy(node.pos);
          node.innerCore.position.copy(node.pos);
          node.glow.position.copy(node.pos);
          node.ring.position.copy(node.pos);
          idx++;
        }
      }

      // ── Neural blinks ─────────────────────────────────
      if (Math.random() < 0.08) {
        const nodeArr = [...nodes.values()];
        if (nodeArr.length > 0) {
          const target = nodeArr[Math.floor(Math.random() * nodeArr.length)];
          state.blinks.push({ nodeId: target.id, startTime: now, duration: 300 + Math.random() * 200 });
          if (Math.random() < 0.1) {
            const burst = 2 + Math.floor(Math.random() * 4);
            for (let b = 0; b < burst; b++) {
              const bt = nodeArr[Math.floor(Math.random() * nodeArr.length)];
              state.blinks.push({ nodeId: bt.id, startTime: now + Math.random() * 100, duration: 300 + Math.random() * 200 });
            }
          }
        }
      }

      const activeBlinks = new Map<string, number>();
      for (let i = state.blinks.length - 1; i >= 0; i--) {
        const blink = state.blinks[i];
        const elapsed = now - blink.startTime;
        if (elapsed > blink.duration) { state.blinks.splice(i, 1); continue; }
        const t = elapsed / blink.duration;
        const intensity = t < 0.15 ? t / 0.15 : Math.exp(-3 * (t - 0.15));
        const ex = activeBlinks.get(blink.nodeId) || 0;
        activeBlinks.set(blink.nodeId, Math.max(ex, intensity));
      }

      // ── Scanning beams ────────────────────────────────
      if (Math.random() < 0.015 && state.edges.length > 0) {
        const strong = state.edges.filter(e => Math.abs(e.score) >= 30);
        const pool = strong.length > 5 ? strong : state.edges;
        const edge = pool[Math.floor(Math.random() * pool.length)];
        const src = nodes.get(edge.sourceId);
        const tgt = nodes.get(edge.targetId);
        if (src && tgt) {
          const geo = new THREE.SphereGeometry(1.5, 8, 6);
          const mat = new THREE.MeshBasicMaterial({
            color: STATUS_COLORS[edge.status] || 0x3498db,
            transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(src.pos);
          state.scene.add(mesh);
          state.scanBeams.push({
            sourceId: edge.sourceId, targetId: edge.targetId,
            mesh, startTime: now, duration: 800 + Math.random() * 400,
          });
        }
      }

      for (let i = state.scanBeams.length - 1; i >= 0; i--) {
        const beam = state.scanBeams[i];
        const elapsed = now - beam.startTime;
        if (elapsed > beam.duration) {
          state.scene.remove(beam.mesh);
          beam.mesh.geometry.dispose();
          (beam.mesh.material as THREE.Material).dispose();
          state.scanBeams.splice(i, 1);
          state.blinks.push({ nodeId: beam.targetId, startTime: now, duration: 500 });
          continue;
        }
        const t = elapsed / beam.duration;
        const src = nodes.get(beam.sourceId);
        const tgt = nodes.get(beam.targetId);
        if (src && tgt) {
          beam.mesh.position.lerpVectors(src.pos, tgt.pos, t);
          const mat = beam.mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = t < 0.1 ? t / 0.1 : (t > 0.8 ? (1 - t) / 0.2 : 0.9);
          beam.mesh.scale.setScalar(1 + Math.sin(t * Math.PI * 4) * 0.3);
        }
      }

      // ── Update node visuals ───────────────────────────
      const isAnySelected = !!selected;
      const connectedIds = new Set<string>();
      if (selected) {
        connectedIds.add(selected);
        for (const edge of state.edges) {
          if (edge.sourceId === selected || edge.targetId === selected) {
            connectedIds.add(edge.sourceId);
            connectedIds.add(edge.targetId);
          }
        }
      }

      const breathT = now * 0.001;

      for (const [id, node] of nodes) {
        const dimmed = isAnySelected && !connectedIds.has(id);
        const isHovered = id === hovered;
        const isSelected = id === selected;
        const blinkI = activeBlinks.get(id) || 0;

        // Breathing
        const breathScale = 1 + Math.sin(breathT * 0.8 + node.breathPhase) * 0.06;
        const totalScale = breathScale + blinkI * 0.15;

        const baseOp = dimmed ? 0.04 : node.baseOpacity;
        const op = Math.min(1, baseOp + blinkI * 0.8);

        (node.core.material as THREE.MeshBasicMaterial).opacity = op;
        (node.innerCore.material as THREE.MeshBasicMaterial).opacity = Math.min(1, op * 1.5 + blinkI * 0.5);
        (node.glow.material as THREE.MeshBasicMaterial).opacity = dimmed ? 0.01 : (0.05 + blinkI * 0.25);

        node.core.scale.setScalar(totalScale);
        node.innerCore.scale.setScalar(totalScale);
        node.glow.scale.setScalar(totalScale);

        // Orbital ring rotation
        node.ring.rotation.z += 0.008 + (isHovered ? 0.02 : 0);
        node.ring.rotation.x = Math.sin(breathT * 0.5 + node.breathPhase) * 0.3;
        const rMat = node.ring.material as THREE.MeshBasicMaterial;
        rMat.opacity = dimmed ? 0.02 : (isSelected ? 0.5 : isHovered ? 0.4 : 0.12 + blinkI * 0.3);
        node.ring.scale.setScalar(isSelected ? 1.4 : isHovered ? 1.3 : 1.0);
      }

      // ── Edge lines ────────────────────────────────────
      if (state.edgeLines) {
        const pos = state.edgeLines.geometry.attributes.position as THREE.BufferAttribute;
        let vi = 0;
        for (const edge of state.edges) {
          const a = nodes.get(edge.sourceId);
          const b = nodes.get(edge.targetId);
          if (!a || !b) { vi += 6; continue; }
          pos.array[vi] = a.pos.x; pos.array[vi + 1] = a.pos.y; pos.array[vi + 2] = a.pos.z;
          pos.array[vi + 3] = b.pos.x; pos.array[vi + 4] = b.pos.y; pos.array[vi + 5] = b.pos.z;
          vi += 6;
        }
        pos.needsUpdate = true;
        (state.edgeLines.material as THREE.LineBasicMaterial).opacity = isAnySelected ? 0.02 : 0.06;
      }

      // ── Selected node edges (brighter) ────────────────
      if (state.selectedEdgeLines) {
        state.selectedEdgeLines.visible = !!selected;
        if (selected) {
          const edges = state.edges.filter(e => e.sourceId === selected || e.targetId === selected);
          const pos = state.selectedEdgeLines.geometry.attributes.position as THREE.BufferAttribute;
          const col = state.selectedEdgeLines.geometry.attributes.color as THREE.BufferAttribute;
          let vi = 0;
          for (let i = 0; i < Math.min(edges.length, 15); i++) {
            const e = edges[i];
            const a = nodes.get(e.sourceId);
            const b = nodes.get(e.targetId);
            if (!a || !b) continue;
            pos.array[vi] = a.pos.x; pos.array[vi + 1] = a.pos.y; pos.array[vi + 2] = a.pos.z;
            pos.array[vi + 3] = b.pos.x; pos.array[vi + 4] = b.pos.y; pos.array[vi + 5] = b.pos.z;
            const c = new THREE.Color(STATUS_COLORS[e.status] || 0x95a5a6);
            col.array[vi] = c.r; col.array[vi + 1] = c.g; col.array[vi + 2] = c.b;
            col.array[vi + 3] = c.r; col.array[vi + 4] = c.g; col.array[vi + 5] = c.b;
            vi += 6;
          }
          for (let i = vi; i < pos.array.length; i++) pos.array[i] = 0;
          pos.needsUpdate = true;
          col.needsUpdate = true;
        }
      }

      // ── Hover highlight ring ──────────────────────────
      if (state.highlightRing) {
        if (hovered && !selected) {
          const hNode = nodes.get(hovered);
          if (hNode) {
            state.highlightRing.visible = true;
            state.highlightRing.position.copy(hNode.pos);
            state.highlightRing.scale.setScalar(hNode.radius * 2.5);
            state.highlightRing.lookAt(camera.position);
            (state.highlightRing.material as THREE.MeshBasicMaterial).color.copy(hNode.color);
          }
        } else {
          state.highlightRing.visible = false;
        }
      }

      // ── Camera focus ──────────────────────────────────
      const selectedNode = selected ? nodes.get(selected) : null;
      if (selected && selectedNode) {
        if (!state.savedCameraPos) {
          state.savedCameraPos = camera.position.clone();
          state.savedCameraTarget = controls.target.clone();
          controls.autoRotate = false;
          state.selectTime = now;
        }
        const dir = camera.position.clone().sub(selectedNode.pos).normalize();
        const targetPos = selectedNode.pos.clone().add(dir.multiplyScalar(100));
        camera.position.lerp(targetPos, 0.05);
        controls.target.lerp(selectedNode.pos, 0.05);
      } else if (!selected && state.savedCameraPos) {
        camera.position.lerp(state.savedCameraPos, 0.05);
        controls.target.lerp(state.savedCameraTarget!, 0.05);
        if (camera.position.distanceTo(state.savedCameraPos) < 1) {
          state.savedCameraPos = null;
          state.savedCameraTarget = null;
          controls.autoRotate = true;
        }
      }

      // ── Hover raycaster ───────────────────────────────
      state.raycaster.setFromCamera(state.mouse, camera);
      const cores = [...nodes.values()].map(n => n.core);
      const hits = state.raycaster.intersectObjects(cores);
      if (hits.length > 0) {
        const hitNode = [...nodes.values()].find(n => n.core === hits[0].object);
        onHoverRef.current(hitNode?.id || null);
        renderer.domElement.style.cursor = 'pointer';
      } else {
        onHoverRef.current(null);
        renderer.domElement.style.cursor = 'grab';
      }

      // ── Background particle rotation ──────────────────
      if (state.particles) {
        state.particles.rotation.y += 0.00008;
        state.particles.rotation.x += 0.00004;
      }

      controls.update();
      composer.render();
    };

    state.animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(state.animId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('click', onClick);
      for (const beam of state.scanBeams) {
        state.scene.remove(beam.mesh);
        beam.mesh.geometry.dispose();
        (beam.mesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      composer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  // ── Sync data → 3D objects ─────────────────────────────────

  useEffect(() => {
    const state = sceneRef.current;
    if (!state || agents.length === 0) return;

    const existing = state.nodes;
    const newIds = new Set(agents.map(a => a.id));

    // Remove old
    for (const [id, node] of existing) {
      if (!newIds.has(id)) {
        state.scene.remove(node.core, node.innerCore, node.glow, node.ring);
        existing.delete(id);
      }
    }

    // Add/update nodes
    for (const a of agents) {
      const appearance = typeof a.appearance === 'string' ? JSON.parse(a.appearance) : a.appearance;
      const color = hexToThreeColor(appearance?.color || '#FFD93D');
      const level = getLevel(a.exp);
      const radius = 3 + Math.min(5, level * 0.8);

      if (existing.has(a.id)) {
        const node = existing.get(a.id)!;
        node.name = a.name;
        node.color = color;
        node.level = level;
        node.money = a.money;
        node.state = a.state;
        (node.core.material as THREE.MeshBasicMaterial).color.copy(color);
        (node.innerCore.material as THREE.MeshBasicMaterial).color.copy(color);
        (node.glow.material as THREE.MeshBasicMaterial).color.copy(color);
        (node.ring.material as THREE.MeshBasicMaterial).color.copy(color);
      } else {
        const coreMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.8, depthWrite: false,
        });
        const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), coreMat);

        const innerMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.95, depthWrite: false,
        });
        const innerCore = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.4, 8, 6), innerMat);

        const glowMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.05, depthWrite: false,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.5, 16, 12), glowMat);

        const orbRingGeo = new THREE.TorusGeometry(radius * 1.8, 0.3, 8, 32);
        const orbRingMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.12, depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Mesh(orbRingGeo, orbRingMat);
        ring.rotation.x = Math.random() * Math.PI;

        // Wider spread
        const spreadR = 500;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = spreadR * (0.3 + Math.random() * 0.7);
        const pos = new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.sin(phi) * Math.sin(theta) * 0.6,
          r * Math.cos(phi),
        );

        core.position.copy(pos);
        innerCore.position.copy(pos);
        glow.position.copy(pos);
        ring.position.copy(pos);
        state.scene.add(core, innerCore, glow, ring);

        existing.set(a.id, {
          id: a.id, name: a.name, color, level, money: a.money, state: a.state,
          pos, vel: new THREE.Vector3(), radius,
          core, innerCore, glow, ring,
          baseOpacity: 0.8,
          breathPhase: Math.random() * Math.PI * 2,
        });
      }
    }

    // Build edges — top 50 strongest globally
    state.edges = relationships
      .filter(r => Math.abs(r.score) >= 10)
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 50)
      .map(r => ({
        sourceId: r.agent1Id, targetId: r.agent2Id,
        score: r.score, status: r.status, interactionCount: r.interactionCount,
      }));

    // Rebuild edge geometry
    if (state.edgeLines) state.scene.remove(state.edgeLines);
    const edgeCount = state.edges.length;
    const edgePos = new Float32Array(edgeCount * 6);
    const edgeCol = new Float32Array(edgeCount * 6);
    let eidx = 0;
    for (const edge of state.edges) {
      const a = existing.get(edge.sourceId);
      const b = existing.get(edge.targetId);
      if (!a || !b) { eidx += 6; continue; }
      edgePos[eidx] = a.pos.x; edgePos[eidx + 1] = a.pos.y; edgePos[eidx + 2] = a.pos.z;
      edgePos[eidx + 3] = b.pos.x; edgePos[eidx + 4] = b.pos.y; edgePos[eidx + 5] = b.pos.z;
      const c = new THREE.Color(STATUS_COLORS[edge.status] || 0x95a5a6);
      edgeCol[eidx] = c.r; edgeCol[eidx + 1] = c.g; edgeCol[eidx + 2] = c.b;
      edgeCol[eidx + 3] = c.r; edgeCol[eidx + 4] = c.g; edgeCol[eidx + 5] = c.b;
      eidx += 6;
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3));
    state.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    state.scene.add(state.edgeLines);

    // Selected-edge geometry (max 15)
    if (state.selectedEdgeLines) state.scene.remove(state.selectedEdgeLines);
    const selGeo = new THREE.BufferGeometry();
    selGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15 * 6), 3));
    selGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(15 * 6), 3));
    state.selectedEdgeLines = new THREE.LineSegments(selGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    state.selectedEdgeLines.visible = false;
    state.scene.add(state.selectedEdgeLines);

    state.settled = false;
    state.frameCount = 0;
  }, [agents, relationships]);

  // ── SSE event flash ────────────────────────────────────────

  useEffect(() => {
    const state = sceneRef.current;
    if (!state || events.length === 0) return;
    const latest = events[events.length - 1];
    const payload = latest.payload as Record<string, string>;
    const agentId = payload?.agentId || payload?.agent1Id;
    if (agentId) {
      state.blinks.push({ nodeId: agentId, startTime: Date.now(), duration: 600 });
    }
  }, [events]);

  useEffect(() => {
    // Camera restore handled in animation loop
  }, [selectedNodeId]);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full" />
  );
}
