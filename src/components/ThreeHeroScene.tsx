'use client';

// ============================================================
// Three.js "Enchanted Daylight Forest" Hero Scene
// A bright, lush miniature forest diorama bathed in warm
// golden sunlight — flowers, butterflies, sparkling water,
// cute bouncing agents. Click agents to make them jump!
// Click ground to bloom flowers. Mouse parallax camera.
// ============================================================

import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const SKY_COLOR = 0x4AABDE;
const TREE_COUNT = 30;
const AGENT_COUNT = 14;
const BUTTERFLY_COUNT = 40;
const FLOWER_COUNT = 80;
const CLOUD_COUNT = 8;
const SPARKLE_COUNT = 60;

const AGENT_COLORS = [
  0xFF7F8A, 0x6FD98A, 0x6ABFEF, 0xFFCA5C, 0xD07FE8, 0xFFE066,
  0xF06B9A, 0x4CC4AF, 0x8BC34A, 0xFFA726,
];

const FLOWER_COLORS = [
  0xFF69B4, 0xFF6B8A, 0xFFD700, 0xFF8C00, 0xDA70D6,
  0xE8A87C, 0xFF4500, 0xFFB6C1, 0xFFA07A, 0xDDA0DD,
];

interface TreeObj {
  trunk: THREE.Mesh;
  canopy: THREE.Mesh;
  swayPhase: number;
  swaySpeed: number;
}

interface AgentObj {
  group: THREE.Group;
  body: THREE.Mesh;
  eyes: THREE.Group;
  startX: number;
  startZ: number;
  targetX: number;
  targetZ: number;
  speed: number;
  bobPhase: number;
  moveTimer: number;
  jumpVel: number;
  jumpY: number;
  isJumping: boolean;
}

interface FlowerObj {
  group: THREE.Group;
  swayPhase: number;
  bloomScale: number;
  targetScale: number;
}

export default function ThreeHeroScene({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    agents: AgentObj[];
    raycaster: THREE.Raycaster;
    ground: THREE.Mesh;
    flowers: FlowerObj[];
    animId: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // ── Scene ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.FogExp2(0x6BB8D4, 0.001);

    // ── Camera ──
    const camera = new THREE.PerspectiveCamera(45, w / h, 1, 2000);
    camera.position.set(0, 150, 240);
    camera.lookAt(0, 0, 0);

    // ── Post-processing (subtle bloom for sparkle) ──
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h), 0.12, 0.6, 0.8
    );
    composer.addPass(bloomPass);

    // ── Lighting (warm daylight — less ambient, more sun contrast) ──
    const ambient = new THREE.AmbientLight(0xFFF5E6, 0.9);
    scene.add(ambient);

    // Hemisphere light for sky/ground color bleed
    const hemiLight = new THREE.HemisphereLight(0x5599CC, 0x2D6A1E, 0.5);
    scene.add(hemiLight);

    // Sun — warm golden directional light (main light source)
    const sunLight = new THREE.DirectionalLight(0xFFE0A0, 3.0);
    sunLight.position.set(80, 200, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.left = -200;
    sunLight.shadow.camera.right = 200;
    sunLight.shadow.camera.top = 200;
    sunLight.shadow.camera.bottom = -200;
    sunLight.shadow.bias = -0.001;
    scene.add(sunLight);

    // Warm fill from the side
    const fillLight = new THREE.DirectionalLight(0xFFD4A8, 0.6);
    fillLight.position.set(-60, 40, -40);
    scene.add(fillLight);

    // Backlight rim
    const rimLight = new THREE.DirectionalLight(0xFFF0D4, 0.4);
    rimLight.position.set(-40, 80, -120);
    scene.add(rimLight);

    // ── Ground (lush green with gradient) ──
    const groundGeo = new THREE.CircleGeometry(220, 64);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3D8B2F });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);

    // Inner clearing — slightly lighter
    const clearingGeo = new THREE.CircleGeometry(70, 48);
    const clearingMat = new THREE.MeshLambertMaterial({ color: 0x4EA843 });
    const clearing = new THREE.Mesh(clearingGeo, clearingMat);
    clearing.rotation.x = -Math.PI / 2;
    clearing.position.y = 0;
    scene.add(clearing);

    // Path/dirt trail
    const pathShape = new THREE.Shape();
    pathShape.moveTo(-180, -3);
    pathShape.bezierCurveTo(-80, -15, -20, 8, 0, 5);
    pathShape.bezierCurveTo(20, 2, 80, -12, 180, 0);
    pathShape.lineTo(180, 5);
    pathShape.bezierCurveTo(80, -7, 20, 7, 0, 10);
    pathShape.bezierCurveTo(-20, 13, -80, -10, -180, 2);
    pathShape.closePath();
    const pathGeo = new THREE.ShapeGeometry(pathShape);
    const pathMat = new THREE.MeshLambertMaterial({ color: 0xC4A265 });
    const pathMesh = new THREE.Mesh(pathGeo, pathMat);
    pathMesh.rotation.x = -Math.PI / 2;
    pathMesh.position.y = 0.2;
    pathMesh.position.z = 20;
    pathMesh.receiveShadow = true;
    scene.add(pathMesh);

    // ── Pond (sparkling water) ──
    const pondGeo = new THREE.CircleGeometry(22, 32);
    const pondMat = new THREE.MeshBasicMaterial({
      color: 0x3A9DBF, transparent: true, opacity: 0.75,
    });
    const pond = new THREE.Mesh(pondGeo, pondMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(55, 0.3, -25);
    scene.add(pond);

    // Pond edge stones
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const r = 22 + Math.random() * 3;
      const stoneGeo = new THREE.SphereGeometry(1.2 + Math.random() * 1.5, 6, 5);
      const stoneMat = new THREE.MeshLambertMaterial({ color: 0x9E9E9E });
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      stone.position.set(
        55 + Math.cos(angle) * r,
        0.5,
        -25 + Math.sin(angle) * r
      );
      stone.scale.y = 0.5;
      stone.castShadow = true;
      scene.add(stone);
    }

    // ── Trees ──
    const trees: TreeObj[] = [];
    const trunkGeo = new THREE.CylinderGeometry(1.5, 2.8, 18, 6);
    const canopyGeos = [
      new THREE.SphereGeometry(11, 8, 7),
      new THREE.SphereGeometry(13, 8, 7),
      new THREE.SphereGeometry(10, 8, 7),
    ];
    const trunkMats = [
      new THREE.MeshLambertMaterial({ color: 0x8B6914 }),
      new THREE.MeshLambertMaterial({ color: 0x7A5B12 }),
    ];
    const canopyMats = [
      new THREE.MeshLambertMaterial({ color: 0x2E8B30 }),
      new THREE.MeshLambertMaterial({ color: 0x3E9E42 }),
      new THREE.MeshLambertMaterial({ color: 0x4CAF50 }),
      new THREE.MeshLambertMaterial({ color: 0x1D7A25 }),
      new THREE.MeshLambertMaterial({ color: 0x2D9035 }),
    ];

    for (let i = 0; i < TREE_COUNT; i++) {
      const angle = (i / TREE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = 70 + Math.random() * 100;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      const scale = 0.7 + Math.random() * 0.9;
      const trunk = new THREE.Mesh(trunkGeo, trunkMats[i % 2]);
      trunk.position.set(x, 9 * scale, z);
      trunk.scale.set(scale, scale, scale);
      trunk.castShadow = true;
      scene.add(trunk);

      const canopyGeo = canopyGeos[i % canopyGeos.length];
      const canopyMat = canopyMats[i % canopyMats.length];
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.set(x, 24 * scale, z);
      canopy.scale.set(scale, scale * (0.8 + Math.random() * 0.4), scale);
      canopy.castShadow = true;
      scene.add(canopy);

      trees.push({
        trunk, canopy,
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.3 + Math.random() * 0.3,
      });
    }

    // ── Flowers scattered on the ground ──
    const flowers: FlowerObj[] = [];
    const petalGeo = new THREE.SphereGeometry(1, 6, 5);
    const stemGeo = new THREE.CylinderGeometry(0.15, 0.2, 3, 4);
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x4A8C3F });

    for (let i = 0; i < FLOWER_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 140;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      // Skip flowers in pond area
      const pdx = x - 55, pdz = z + 25;
      if (pdx * pdx + pdz * pdz < 700) continue;

      const group = new THREE.Group();
      const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
      const fMat = new THREE.MeshLambertMaterial({ color });

      // Stem
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.y = 1.5;
      group.add(stem);

      // Petals (5 around center)
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2;
        const petal = new THREE.Mesh(petalGeo, fMat);
        petal.position.set(Math.cos(pa) * 0.8, 3.2, Math.sin(pa) * 0.8);
        petal.scale.set(0.5, 0.35, 0.5);
        group.add(petal);
      }

      // Center
      const centerGeo = new THREE.SphereGeometry(0.5, 6, 5);
      const centerMat = new THREE.MeshLambertMaterial({ color: 0xFFD700 });
      const center = new THREE.Mesh(centerGeo, centerMat);
      center.position.y = 3.2;
      group.add(center);

      const fScale = 0.4 + Math.random() * 0.7;
      group.scale.setScalar(fScale);
      group.position.set(x, 0, z);
      group.rotation.y = Math.random() * Math.PI * 2;
      scene.add(group);

      flowers.push({
        group,
        swayPhase: Math.random() * Math.PI * 2,
        bloomScale: fScale,
        targetScale: fScale,
      });
    }

    // ── Mushrooms ──
    const mushStemGeo = new THREE.CylinderGeometry(0.6, 0.8, 2.5, 6);
    const mushCapGeo = new THREE.SphereGeometry(2, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const mushStemMat = new THREE.MeshLambertMaterial({ color: 0xFFF8E7 });
    const mushCapMats = [
      new THREE.MeshLambertMaterial({ color: 0xE85454 }),
      new THREE.MeshLambertMaterial({ color: 0xFFB347 }),
      new THREE.MeshLambertMaterial({ color: 0xDA70D6 }),
    ];

    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 50;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      const group = new THREE.Group();
      const stem = new THREE.Mesh(mushStemGeo, mushStemMat);
      stem.position.y = 1.25;
      group.add(stem);
      const cap = new THREE.Mesh(mushCapGeo, mushCapMats[i % 3]);
      cap.position.y = 2.8;
      cap.rotation.x = Math.PI;
      group.add(cap);

      const ms = 0.5 + Math.random() * 0.6;
      group.scale.setScalar(ms);
      group.position.set(x, 0, z);
      scene.add(group);
    }

    // ── Rocks / Boulders ──
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 80;
      const rockGeo = new THREE.DodecahedronGeometry(2 + Math.random() * 3, 0);
      const rockMat = new THREE.MeshLambertMaterial({ color: 0x8E8E8E });
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(
        Math.cos(angle) * dist,
        1 + Math.random(),
        Math.sin(angle) * dist
      );
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.scale.y = 0.5 + Math.random() * 0.3;
      rock.castShadow = true;
      scene.add(rock);
    }

    // ── Clouds (fluffy) ──
    const cloudGeo = new THREE.SphereGeometry(1, 8, 6);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xFFFFFF, transparent: true, opacity: 0.85,
    });
    const clouds: THREE.Group[] = [];

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const group = new THREE.Group();
      // Each cloud = cluster of spheres
      const parts = 3 + Math.floor(Math.random() * 4);
      for (let p = 0; p < parts; p++) {
        const c = new THREE.Mesh(cloudGeo, cloudMat);
        c.position.set(
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 8
        );
        const cs = 4 + Math.random() * 6;
        c.scale.set(cs, cs * 0.5, cs * 0.7);
        group.add(c);
      }
      group.position.set(
        (Math.random() - 0.5) * 500,
        120 + Math.random() * 60,
        -150 + (Math.random() - 0.5) * 200
      );
      scene.add(group);
      clouds.push(group);
    }

    // ── Agent Characters (cute round blobs with eyes) ──
    const agents: AgentObj[] = [];
    const agentGeo = new THREE.SphereGeometry(2.8, 14, 12);
    const eyeWhiteGeo = new THREE.SphereGeometry(0.7, 8, 6);
    const eyePupilGeo = new THREE.SphereGeometry(0.35, 6, 5);
    const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
    const eyePupilMat = new THREE.MeshBasicMaterial({ color: 0x333333 });

    for (let i = 0; i < AGENT_COUNT; i++) {
      const color = AGENT_COLORS[i % AGENT_COLORS.length];
      const group = new THREE.Group();

      const body = new THREE.Mesh(agentGeo, new THREE.MeshLambertMaterial({
        color, emissive: color, emissiveIntensity: 0.08,
      }));
      body.castShadow = true;
      group.add(body);

      // Eyes
      const eyes = new THREE.Group();
      const leftEyeW = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
      leftEyeW.position.set(-0.9, 0.6, 2.3);
      const leftEyeP = new THREE.Mesh(eyePupilGeo, eyePupilMat);
      leftEyeP.position.set(-0.9, 0.6, 2.7);
      const rightEyeW = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
      rightEyeW.position.set(0.9, 0.6, 2.3);
      const rightEyeP = new THREE.Mesh(eyePupilGeo, eyePupilMat);
      rightEyeP.position.set(0.9, 0.6, 2.7);
      eyes.add(leftEyeW, leftEyeP, rightEyeW, rightEyeP);
      group.add(eyes);

      // Cheek blush
      const cheekGeo = new THREE.SphereGeometry(0.5, 6, 5);
      const cheekMat = new THREE.MeshBasicMaterial({
        color: 0xFF8FAA, transparent: true, opacity: 0.4,
      });
      const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
      leftCheek.position.set(-1.6, -0.2, 2.0);
      leftCheek.scale.set(1, 0.6, 0.5);
      group.add(leftCheek);
      const rightCheek = new THREE.Mesh(cheekGeo, cheekMat.clone());
      rightCheek.position.set(1.6, -0.2, 2.0);
      rightCheek.scale.set(1, 0.6, 0.5);
      group.add(rightCheek);

      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 50;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      group.position.set(x, 4, z);
      scene.add(group);

      agents.push({
        group, body, eyes,
        startX: x, startZ: z,
        targetX: x, targetZ: z,
        speed: 4 + Math.random() * 8,
        bobPhase: Math.random() * Math.PI * 2,
        moveTimer: Math.random() * 5,
        jumpVel: 0,
        jumpY: 0,
        isJumping: false,
      });
    }

    // ── Butterfly Particles ──
    const bfPos = new Float32Array(BUTTERFLY_COUNT * 3);
    const bfCol = new Float32Array(BUTTERFLY_COUNT * 3);
    const bfPhases = new Float32Array(BUTTERFLY_COUNT);

    const butterflyColors = [
      [1.0, 0.7, 0.2], [0.9, 0.4, 0.6], [0.6, 0.7, 1.0],
      [1.0, 0.95, 0.4], [0.8, 0.5, 0.9], [1.0, 0.6, 0.4],
    ];

    for (let i = 0; i < BUTTERFLY_COUNT; i++) {
      const i3 = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 130;
      bfPos[i3] = Math.cos(angle) * dist;
      bfPos[i3 + 1] = 8 + Math.random() * 35;
      bfPos[i3 + 2] = Math.sin(angle) * dist;

      const bc = butterflyColors[Math.floor(Math.random() * butterflyColors.length)];
      bfCol[i3] = bc[0]; bfCol[i3 + 1] = bc[1]; bfCol[i3 + 2] = bc[2];
      bfPhases[i] = Math.random() * Math.PI * 2;
    }

    const bfGeo = new THREE.BufferGeometry();
    bfGeo.setAttribute('position', new THREE.BufferAttribute(bfPos, 3));
    bfGeo.setAttribute('color', new THREE.BufferAttribute(bfCol, 3));
    const bfMat = new THREE.PointsMaterial({
      size: 2.5, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.9,
      depthWrite: false,
    });
    const butterflies = new THREE.Points(bfGeo, bfMat);
    scene.add(butterflies);

    // ── Water Sparkles (on pond) ──
    const spPos = new Float32Array(SPARKLE_COUNT * 3);
    const spCol = new Float32Array(SPARKLE_COUNT * 3);

    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const i3 = i * 3;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 20;
      spPos[i3] = 55 + Math.cos(a) * r;
      spPos[i3 + 1] = 1 + Math.random() * 2;
      spPos[i3 + 2] = -25 + Math.sin(a) * r;
      spCol[i3] = 1.0; spCol[i3 + 1] = 1.0; spCol[i3 + 2] = 1.0;
    }

    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
    spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
    const spMat = new THREE.PointsMaterial({
      size: 1.2, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sparkles = new THREE.Points(spGeo, spMat);
    scene.add(sparkles);

    // ── Raycaster for click interactions ──
    const raycaster = new THREE.Raycaster();
    const clickMouse = new THREE.Vector2();

    // ── State ──
    sceneRef.current = {
      renderer, composer, camera, scene, agents, raycaster, ground, flowers,
      animId: 0,
    };

    // ── Click handler ──
    const onClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      clickMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      clickMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(clickMouse, camera);

      // Check agents first
      const agentMeshes = agents.map(a => a.body);
      const agentHits = raycaster.intersectObjects(agentMeshes);
      if (agentHits.length > 0) {
        const hitMesh = agentHits[0].object;
        const agent = agents.find(a => a.body === hitMesh);
        if (agent && !agent.isJumping) {
          agent.isJumping = true;
          agent.jumpVel = 18;
          // Trigger nearby agents to jump too (chain reaction!)
          for (const other of agents) {
            if (other === agent) continue;
            const dx = other.group.position.x - agent.group.position.x;
            const dz = other.group.position.z - agent.group.position.z;
            if (dx * dx + dz * dz < 900 && !other.isJumping) {
              setTimeout(() => {
                other.isJumping = true;
                other.jumpVel = 12 + Math.random() * 6;
              }, 100 + Math.random() * 300);
            }
          }
        }
        return;
      }

      // Check ground for flower bloom
      const groundHit = raycaster.intersectObject(ground);
      if (groundHit.length > 0) {
        const pt = groundHit[0].point;
        // Make nearby flowers bloom bigger temporarily
        for (const f of flowers) {
          const dx = f.group.position.x - pt.x;
          const dz = f.group.position.z - pt.z;
          if (dx * dx + dz * dz < 600) {
            f.targetScale = f.bloomScale * 1.8;
            setTimeout(() => { f.targetScale = f.bloomScale; }, 1500);
          }
        }
      }
    };
    container.addEventListener('click', onClick);

    // ── Mouse tracking for parallax ──
    const mouse = { x: 0, y: 0 };
    const camTarget = { x: 0, y: 150, z: 240 };
    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      mouse.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    container.addEventListener('mousemove', onMouseMove);

    // ── Resize ──
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      composer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // ── Animation ──
    const clock = new THREE.Clock();
    let lastTime = 0;

    const animate = () => {
      sceneRef.current!.animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = Math.min(t - lastTime, 0.05);
      lastTime = t;

      // Tree sway (gentle breeze)
      for (const tree of trees) {
        const sway = Math.sin(t * tree.swaySpeed + tree.swayPhase) * 0.015;
        tree.canopy.rotation.z = sway;
        tree.trunk.rotation.z = sway * 0.2;
      }

      // Flower sway + bloom animation
      for (const f of flowers) {
        const sway = Math.sin(t * 1.2 + f.swayPhase) * 0.08;
        f.group.rotation.z = sway;
        f.group.rotation.x = sway * 0.3;

        // Smooth bloom scale
        const cs = f.group.scale.x;
        const diff = f.targetScale - cs;
        if (Math.abs(diff) > 0.001) {
          const newS = cs + diff * 0.08;
          f.group.scale.setScalar(newS);
        }
      }

      // Agent movement
      for (const agent of agents) {
        agent.moveTimer -= dt;
        if (agent.moveTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 10 + Math.random() * 55;
          agent.targetX = Math.cos(angle) * dist;
          agent.targetZ = Math.sin(angle) * dist;
          agent.startX = agent.group.position.x;
          agent.startZ = agent.group.position.z;
          agent.moveTimer = 3 + Math.random() * 5;
        }

        const bx = agent.group.position.x;
        const bz = agent.group.position.z;
        const dx = agent.targetX - bx;
        const dz = agent.targetZ - bz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 1) {
          const step = Math.min(agent.speed * dt, dist);
          agent.group.position.x += (dx / dist) * step;
          agent.group.position.z += (dz / dist) * step;

          // Face direction of movement
          agent.group.rotation.y = Math.atan2(dx, dz);
        }

        // Jump physics
        if (agent.isJumping) {
          agent.jumpVel -= 50 * dt;
          agent.jumpY += agent.jumpVel * dt;
          if (agent.jumpY <= 0) {
            agent.jumpY = 0;
            agent.isJumping = false;
            agent.jumpVel = 0;
          }
        }

        // Bounce while walking
        const walkBounce = dist > 1 ? Math.abs(Math.sin(t * 6 + agent.bobPhase)) * 1.5 : 0;
        agent.group.position.y = 4 + walkBounce + agent.jumpY;

        // Squish/stretch
        if (agent.isJumping) {
          const stretch = 1 + agent.jumpVel * 0.01;
          const squash = 1 - agent.jumpVel * 0.005;
          agent.body.scale.set(squash, stretch, squash);
        } else if (dist > 1) {
          const squishY = 1 + Math.sin(t * 6 + agent.bobPhase) * 0.08;
          const squishXZ = 1 - Math.sin(t * 6 + agent.bobPhase) * 0.04;
          agent.body.scale.set(squishXZ, squishY, squishXZ);
        } else {
          // Idle breathing
          const breath = 1 + Math.sin(t * 2 + agent.bobPhase) * 0.03;
          agent.body.scale.set(breath, breath, breath);
        }
      }

      // Butterflies floating
      const bfPosArr = butterflies.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < BUTTERFLY_COUNT; i++) {
        const i3 = i * 3;
        const phase = bfPhases[i];
        bfPosArr.array[i3] += Math.sin(t * 1.5 + phase) * 0.3;
        bfPosArr.array[i3 + 1] += Math.sin(t * 2 + phase * 2) * 0.15;
        bfPosArr.array[i3 + 2] += Math.cos(t * 1.2 + phase * 1.5) * 0.25;

        const fx = bfPosArr.array[i3];
        const fy = bfPosArr.array[i3 + 1];
        const fz = bfPosArr.array[i3 + 2];
        if (fx * fx + fz * fz > 140 * 140 || fy > 45 || fy < 4) {
          const a = Math.random() * Math.PI * 2;
          const d = 10 + Math.random() * 100;
          bfPosArr.array[i3] = Math.cos(a) * d;
          bfPosArr.array[i3 + 1] = 8 + Math.random() * 30;
          bfPosArr.array[i3 + 2] = Math.sin(a) * d;
        }
      }
      bfPosArr.needsUpdate = true;
      // Fluttering size
      (butterflies.material as THREE.PointsMaterial).size = 2.2 + Math.sin(t * 8) * 0.6;

      // Water sparkles twinkle
      (sparkles.material as THREE.PointsMaterial).opacity = 0.4 + Math.sin(t * 4) * 0.4;
      const spPosArr = sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < SPARKLE_COUNT; i++) {
        const i3 = i * 3;
        spPosArr.array[i3 + 1] = 1 + Math.sin(t * 3 + i * 0.5) * 0.5;
      }
      spPosArr.needsUpdate = true;

      // Pond subtle ripple via scale
      const pondScale = 1 + Math.sin(t * 1.5) * 0.01;
      pond.scale.set(pondScale, 1, pondScale);

      // Clouds drift
      for (const cloud of clouds) {
        cloud.position.x += 0.08;
        if (cloud.position.x > 300) cloud.position.x = -300;
      }

      // Camera parallax
      camTarget.x += (mouse.x * 35 - camTarget.x) * 0.02;
      const targetY = 150 + mouse.y * -20;
      camTarget.y += (targetY - camTarget.y) * 0.02;
      camera.position.set(camTarget.x, camTarget.y, 240);
      camera.lookAt(0, 8, 0);

      composer.render();
    };

    sceneRef.current.animId = requestAnimationFrame(animate);

    // ── Cleanup ──
    return () => {
      cancelAnimationFrame(sceneRef.current?.animId || 0);
      window.removeEventListener('resize', onResize);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('click', onClick);

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      renderer.dispose();
      composer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className={`w-full h-full ${className || ''}`} style={{ cursor: 'pointer' }} />;
}
