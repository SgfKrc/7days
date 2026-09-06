import * as THREE from 'three';
import './style.css';
import { DEFAULT_GENOME, GENOME_PRESETS, applyGenomePreset, type GenomeParameters } from './core/genome';
import { DEFAULT_AQUARIUM_BOUNDS, SeededRandom, createFishState, hashSeed, type FishState } from './core/simulation';
import { SpatialHash, stepBoids } from './core/boids';
import { applyCoralFeedback, coralNodeEndpoint, createSeedCoralNode, generateCoralNodes } from './core/coral';
import { InfluenceField, writeFishInfluence } from './core/influence';
import { FeedbackThrottle, type FeedbackKind } from './core/feedback';
import { PerformanceMonitor } from './core/performance';

const fractalVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fractalFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uCX;
  uniform float uCY;
  uniform float uZoom;
  uniform float uMaxIterations;
  uniform float uPalette;

  vec3 palette(float t) {
    vec3 coral = vec3(0.05, 0.70, 0.64);
    vec3 bloom = vec3(1.00, 0.30, 0.43);
    vec3 abyss = vec3(0.02, 0.05, 0.12);
    vec3 current = vec3(0.16, 0.42, 0.68);
    vec3 orchid = vec3(0.70, 0.20, 0.85);
    vec3 ember = vec3(1.00, 0.60, 0.22);

    if (uPalette < 0.5) {
      return mix(abyss, mix(coral, bloom, smoothstep(0.35, 0.78, t)), smoothstep(0.02, 0.92, t));
    }
    if (uPalette < 1.5) {
      return mix(vec3(0.015, 0.08, 0.15), mix(current, coral, t), smoothstep(0.05, 0.9, t));
    }
    if (uPalette < 2.5) {
      return mix(vec3(0.045, 0.02, 0.12), mix(orchid, bloom, t), smoothstep(0.05, 0.88, t));
    }
    return mix(vec3(0.12, 0.035, 0.025), mix(ember, bloom, t), smoothstep(0.02, 0.85, t));
  }

  void main() {
    vec2 centered = (vUv - 0.5) * vec2(1.72, 1.0);
    centered /= uZoom;
    centered += vec2(uCX, uCY) * 0.12;
    vec2 z = centered;
    float escaped = 0.0;
    float iteration = 0.0;

    for (int i = 0; i < 192; i++) {
      if (iteration >= uMaxIterations || dot(z, z) > 64.0) break;
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + centered;
      iteration += 1.0;
    }

    if (iteration >= uMaxIterations - 0.5) {
      escaped = 0.02;
    } else {
      float smoothIteration = iteration - log2(log2(dot(z, z))) + 4.0;
      escaped = clamp(smoothIteration / uMaxIterations, 0.0, 1.0);
    }

    float pulse = 0.018 * sin(uTime * 0.35 + vUv.y * 8.0);
    vec3 color = palette(clamp(escaped + pulse, 0.0, 1.0));
    float vignette = 1.0 - smoothstep(0.38, 0.82, distance(vUv, vec2(0.5)));
    color *= mix(0.70, 1.0, vignette);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const postVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const postFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform vec2 uResolution;
  uniform float uDither;
  uniform float uScanlines;
  uniform float uAberration;
  uniform float uCurvature;
  uniform float uIntensity;

  float bayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    float value = 0.0;
    if (y == 0) {
      if (x == 0) value = 0.0; else if (x == 1) value = 8.0; else if (x == 2) value = 2.0; else value = 10.0;
    } else if (y == 1) {
      if (x == 0) value = 12.0; else if (x == 1) value = 4.0; else if (x == 2) value = 14.0; else value = 6.0;
    } else if (y == 2) {
      if (x == 0) value = 3.0; else if (x == 1) value = 11.0; else if (x == 2) value = 1.0; else value = 9.0;
    } else {
      if (x == 0) value = 15.0; else if (x == 1) value = 7.0; else if (x == 2) value = 13.0; else value = 5.0;
    }
    return value / 16.0 - 0.5;
  }

  void main() {
    vec2 curvedUv = vUv - 0.5;
    float radius = dot(curvedUv, curvedUv);
    curvedUv *= 1.0 + radius * 0.18 * uCurvature * uIntensity;
    curvedUv += 0.5;
    vec2 chromaticOffset = vec2(0.0032, 0.0) * uAberration * uIntensity;
    vec3 color;
    color.r = texture2D(uScene, clamp(curvedUv + chromaticOffset, 0.001, 0.999)).r;
    color.g = texture2D(uScene, clamp(curvedUv, 0.001, 0.999)).g;
    color.b = texture2D(uScene, clamp(curvedUv - chromaticOffset, 0.001, 0.999)).b;
    float threshold = bayer4(gl_FragCoord.xy) * 0.07 * uDither * uIntensity;
    color = floor((color + threshold) * 42.0) / 42.0;
    float scan = 1.0 - (0.08 * uScanlines * uIntensity * step(1.0, mod(gl_FragCoord.y, 3.0)));
    float vignette = 1.0 - radius * 0.48 * uIntensity;
    color *= vignette;
    color *= scan;
    gl_FragColor = vec4(color, 1.0);
  }
`;

type FishVisual = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  state: FishState;
  frames: THREE.Texture[];
  species: number;
  phase: number;
  depth: number;
  baseSize: number;
  heading: number;
  turnAmount: number;
  depthPhase: number;
  depthVelocity: number;
};

type CoralVisual = {
  node: ReturnType<typeof generateCoralNodes>[number];
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  material: THREE.LineBasicMaterial;
  baseColor: THREE.Color;
  baseLength: number;
  depthOffset: number;
  branch: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  bud: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
};

type FeedPulse = {
  position: THREE.Vector2;
  age: number;
  strength: number;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  duration: number;
  maxScale: number;
};

type Bubble = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  speed: number;
  phase: number;
};

type FoodTarget = {
  position: THREE.Vector2;
  age: number;
};

const canvas = document.querySelector<HTMLCanvasElement>('#aquarium-canvas');
if (!canvas) throw new Error('Aquarium canvas was not found');
const aquariumCanvas: HTMLCanvasElement = canvas;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x06121d, 2.6, 6.5);
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / Math.max(window.innerHeight, 1), 0.1, 100);
camera.position.set(0, 0.08, 2.6);
camera.lookAt(0, -0.05, 0);
const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
postCamera.position.z = 1;
const clock = new THREE.Clock();

const fractalMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uCX: { value: DEFAULT_GENOME.cX },
    uCY: { value: DEFAULT_GENOME.cY },
    uZoom: { value: DEFAULT_GENOME.zoom },
    uMaxIterations: { value: DEFAULT_GENOME.maxIterations },
    uPalette: { value: DEFAULT_GENOME.palette },
  },
  vertexShader: fractalVertex,
  fragmentShader: fractalFragment,
});
const fractalPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fractalMaterial);
fractalPlane.position.z = -5.2;
fractalPlane.scale.set(6.4, 6.4, 1);
scene.add(fractalPlane);

const tankGroup = new THREE.Group();
tankGroup.position.set(0, -0.03, 0);
scene.add(tankGroup);
const coralGroup = new THREE.Group();
coralGroup.position.z = 0;
scene.add(coralGroup);
const fishGroup = new THREE.Group();
fishGroup.position.z = 0;
scene.add(fishGroup);
const feedGroup = new THREE.Group();
feedGroup.position.z = 0.42;
scene.add(feedGroup);
const boidsHash = new SpatialHash(0.2);
const influenceField = new InfluenceField({ width: 64, height: 64, bounds: DEFAULT_AQUARIUM_BOUNDS, decayRate: 0.72 });
const coralVisuals: CoralVisual[] = [];
const feedPulses: FeedPulse[] = [];
const foodTargets: FoodTarget[] = [];
const bubbles: Bubble[] = [];
const feedbackThrottle = new FeedbackThrottle();
const performanceMonitor = new PerformanceMonitor();
const pointerWorld = new THREE.Vector2();
const pointerRaycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let pointerActive = false;
let lastFeedAt = -Infinity;
let audioEnabled = true;
let audioContext: AudioContext | null = null;
let audioOutput: GainNode | null = null;
let feedbackTimeout: number | undefined;

const TANK_SPACE = {
  width: 2.24,
  height: 1.72,
  depth: 1.28,
  centerY: -0.04,
  minX: -1.08,
  maxX: 1.08,
  bottomY: -0.9,
  topY: 0.82,
  backZ: -0.64,
  frontZ: 0.64,
};

type AudioContextFactory = new () => AudioContext;

function announceFeedback(message: string, tone: 'aqua' | 'coral' = 'aqua'): void {
  const feedback = document.querySelector<HTMLElement>('#event-feedback');
  const text = document.querySelector<HTMLElement>('#event-feedback-text');
  if (!feedback || !text) return;
  text.textContent = message;
  feedback.classList.toggle('is-coral', tone === 'coral');
  feedback.classList.remove('is-visible');
  void feedback.offsetWidth;
  feedback.classList.add('is-visible');
  if (feedbackTimeout !== undefined) window.clearTimeout(feedbackTimeout);
  feedbackTimeout = window.setTimeout(() => feedback.classList.remove('is-visible'), 1700);
}

function ensureAudio(): AudioContext | null {
  if (!audioEnabled) return null;
  const browserWindow = window as Window & { webkitAudioContext?: AudioContextFactory };
  const AudioContextCtor = window.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) {
    audioContext = new AudioContextCtor();
    audioOutput = audioContext.createGain();
    audioOutput.gain.value = 0.42;
    audioOutput.connect(audioContext.destination);
  }
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

function playFeedback(kind: FeedbackKind, intensity = 1): void {
  if (!feedbackThrottle.shouldEmit(kind, performance.now())) return;
  const context = ensureAudio();
  if (!context || !audioOutput) return;
  const sounds: Record<FeedbackKind, { start: number; end: number; duration: number; type: OscillatorType }> = {
    feed: { start: 420, end: 660, duration: 0.12, type: 'square' },
    seed: { start: 250, end: 520, duration: 0.2, type: 'triangle' },
    prune: { start: 320, end: 150, duration: 0.16, type: 'sawtooth' },
    preset: { start: 300, end: 720, duration: 0.22, type: 'sine' },
    pause: { start: 190, end: 130, duration: 0.18, type: 'sine' },
    ui: { start: 500, end: 500, duration: 0.06, type: 'square' },
  };
  const sound = sounds[kind];
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = sound.type;
  oscillator.frequency.setValueAtTime(sound.start, now);
  oscillator.frequency.exponentialRampToValueAtTime(sound.end, now + sound.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.055 * intensity), now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.duration);
  oscillator.connect(gain).connect(audioOutput);
  oscillator.start(now);
  oscillator.stop(now + sound.duration + 0.015);
}

function makeTank(): void {
  const { width, height, depth, centerY, backZ, frontZ, bottomY, topY } = TANK_SPACE;
  const glassMaterial = new THREE.MeshBasicMaterial({ color: 0x55d9d1, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false });
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    glassMaterial,
  );
  glass.position.set(0, centerY, 0);
  glass.renderOrder = 0;
  tankGroup.add(glass);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
    new THREE.LineBasicMaterial({ color: 0x80e9df, transparent: true, opacity: 0.48 }),
  );
  edges.position.set(0, centerY, 0);
  edges.renderOrder = 5;
  tankGroup.add(edges);

  const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x0b2737, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.08, height - 0.08),
    wallMaterial.clone(),
  );
  backWall.position.set(0, centerY, backZ + 0.025);
  tankGroup.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(depth - 0.08, height - 0.08), wallMaterial.clone());
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-width * 0.5 + 0.04, centerY, 0);
  tankGroup.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(depth - 0.08, height - 0.08), wallMaterial.clone());
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(width * 0.5 - 0.04, centerY, 0);
  tankGroup.add(rightWall);

  const frontGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.08, height - 0.08),
    new THREE.MeshBasicMaterial({ color: 0xb4fff2, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false }),
  );
  frontGlass.position.set(0, centerY, frontZ - 0.025);
  frontGlass.renderOrder = 4;
  tankGroup.add(frontGlass);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.1, depth - 0.1),
    new THREE.MeshBasicMaterial({ color: 0x163944, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, bottomY + 0.025, 0);
  tankGroup.add(floor);

  const substrate = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.12, 0.06, depth - 0.12),
    new THREE.MeshBasicMaterial({ color: 0x254e4c, transparent: true, opacity: 0.9 }),
  );
  substrate.position.set(0, bottomY + 0.008, 0);
  tankGroup.add(substrate);

  const gravelRandom = new SeededRandom(hashSeed('substrate-gravel'));
  for (let index = 0; index < 54; index += 1) {
    const gravel = new THREE.Mesh(
      new THREE.DodecahedronGeometry(gravelRandom.range(0.008, 0.022), 0),
      new THREE.MeshBasicMaterial({ color: gravelRandom.next() > 0.5 ? 0x4a8174 : 0x7b806d, transparent: true, opacity: 0.78 }),
    );
    gravel.position.set(gravelRandom.range(-1.02, 1.02), bottomY + gravelRandom.range(0.035, 0.065), gravelRandom.range(-0.52, 0.52));
    gravel.rotation.set(gravelRandom.next(), gravelRandom.next(), gravelRandom.next());
    gravel.renderOrder = 1;
    tankGroup.add(gravel);
  }

  const waterSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.1, depth - 0.1),
    new THREE.MeshBasicMaterial({ color: 0x61e1cc, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }),
  );
  waterSurface.rotation.x = -Math.PI / 2;
  waterSurface.position.set(0, topY - 0.035, 0);
  waterSurface.renderOrder = 3;
  tankGroup.add(waterSurface);

  for (let index = 0; index < 5; index += 1) {
    const caustic = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width * 0.42, topY - 0.045, -depth * 0.35 + index * 0.16),
        new THREE.Vector3(width * 0.42, topY - 0.045, -depth * 0.35 + index * 0.16),
      ]),
      new THREE.LineBasicMaterial({ color: 0x8affea, transparent: true, opacity: 0.16 }),
    );
    caustic.renderOrder = 4;
    tankGroup.add(caustic);
  }
}

function makeBubbles(): void {
  const random = new SeededRandom(hashSeed('bubble-field'));
  const bubbleMaterial = new THREE.MeshBasicMaterial({ color: 0x9affef, transparent: true, opacity: 0.38 });
  for (let index = 0; index < 24; index += 1) {
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(random.range(0.004, 0.012), 6, 4), bubbleMaterial.clone());
    bubble.position.set(random.range(TANK_SPACE.minX + 0.04, TANK_SPACE.maxX - 0.04), random.range(TANK_SPACE.bottomY + 0.12, TANK_SPACE.topY - 0.12), random.range(TANK_SPACE.backZ + 0.1, TANK_SPACE.frontZ - 0.1));
    bubble.renderOrder = 3;
    tankGroup.add(bubble);
    bubbles.push({ mesh: bubble, speed: random.range(0.018, 0.045), phase: random.range(0, Math.PI * 2) });
  }
}

function updateBubbles(deltaSeconds: number): void {
  bubbles.forEach((bubble) => {
    bubble.mesh.position.y += bubble.speed * deltaSeconds;
    bubble.mesh.position.x += Math.sin(elapsed * 0.8 + bubble.phase) * 0.0015;
    if (bubble.mesh.position.y > TANK_SPACE.topY - 0.12) {
      bubble.mesh.position.y = TANK_SPACE.bottomY + 0.12;
      bubble.mesh.position.x = Math.sin(bubble.phase + elapsed) * 0.92;
    }
    bubble.mesh.material.opacity = 0.18 + 0.24 * (0.5 + 0.5 * Math.sin(elapsed * 1.7 + bubble.phase));
  });
}

const coralColors = [
  new THREE.Color(0xf36f74),
  new THREE.Color(0xff9a7b),
  new THREE.Color(0x58e0ca),
  new THREE.Color(0x9d8cff),
  new THREE.Color(0xffd166),
];

function addCoralVisual(node: ReturnType<typeof generateCoralNodes>[number]): CoralVisual {
  const end = coralNodeEndpoint(node);
  const baseColor = coralColors[node.depth % coralColors.length].clone();
  const depthOffset = ((node.seed % 1000) / 999 - 0.5) * (TANK_SPACE.depth - 0.26);
  const material = new THREE.LineBasicMaterial({ color: baseColor, transparent: true, opacity: 0.86 - node.depth * 0.08 });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(end.x - node.position.x, end.y - node.position.y, 0),
  ]), material);
  const branchMaterial = new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.86 - node.depth * 0.06 });
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.35, 1, 5, 1), branchMaterial);
  const budMaterial = new THREE.MeshBasicMaterial({ color: baseColor.clone().offsetHSL(0.02, 0.08, 0.08), transparent: true, opacity: 0.94 });
  const bud = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), budMaterial);
  line.renderOrder = 1;
  branch.renderOrder = 1;
  bud.renderOrder = 1;
  coralGroup.add(line, branch, bud);
  const visual = { node, line, material, baseColor, baseLength: node.length, depthOffset, branch, bud };
  coralVisuals.push(visual);
  return visual;
}

function makeCoral(): void {
  generateCoralNodes('reef-alpha').forEach((node) => addCoralVisual(node));
}

function makePixelFishTexture(variant: number, frame: number): THREE.CanvasTexture {
  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = 32;
  spriteCanvas.height = 20;
  const context = spriteCanvas.getContext('2d');
  if (!context) throw new Error('Unable to create pixel fish canvas');
  context.imageSmoothingEnabled = false;

  const palettes = [
    { body: '#ffc857', light: '#fff1a8', fin: '#f07878', stripe: '#ee845a', shadow: '#d48b3e', eye: '#102c38' },
    { body: '#69dfcf', light: '#c1fff0', fin: '#ff8292', stripe: '#2c9eaa', shadow: '#247b86', eye: '#102c38' },
    { body: '#b695ff', light: '#e8dcff', fin: '#ff7191', stripe: '#754cb5', shadow: '#55318f', eye: '#20143e' },
    { body: '#ff8c62', light: '#ffd19c', fin: '#7ddbd1', stripe: '#cf4e5d', shadow: '#a23f4c', eye: '#30182a' },
  ];
  const palette = palettes[variant % palettes.length];
  const sway = frame === 0 ? 0 : 2;
  const pixel = (x: number, y: number, width: number, height: number, color: string): void => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };

  // Pixel silhouettes are deliberately different species, not only recolors.
  if (variant === 0) {
    // Reef tang: slim body, pointed snout and a deeply forked tail.
    pixel(8, 6, 14, 7, palette.body);
    pixel(6, 8, 4, 3, palette.body);
    pixel(21, 7, 3, 5, palette.light);
    pixel(3 - sway, 7, 5, 2, palette.fin);
    pixel(3 + sway, 11, 5, 2, palette.fin);
    pixel(11, 4, 7, 2, palette.fin);
    pixel(12, 13, 6, 2, palette.fin);
    pixel(19, 7, 1, 1, palette.eye);
    pixel(21, 9, 2, 1, palette.light);
    pixel(10, 8, 2, 2, palette.shadow);
  } else if (variant === 1) {
    // Angelfish: tall diamond body, veil fins and a narrow tail peduncle.
    pixel(9, 5, 12, 10, palette.body);
    pixel(7, 7, 16, 6, palette.body);
    pixel(23, 8, 3, 3, palette.light);
    pixel(3 - sway, 8, 6, 3, palette.fin);
    pixel(10, 2 - sway, 5, 4, palette.fin);
    pixel(10, 14 + sway, 5, 4, palette.fin);
    pixel(13, 5, 2, 10, palette.stripe);
    pixel(20, 7, 1, 1, palette.eye);
    pixel(21, 6, 1, 1, palette.light);
    pixel(17, 13, 2, 2, palette.shadow);
  } else if (variant === 2) {
    // Clownfish: round body, three bright bands and a fan tail.
    pixel(8, 6, 14, 8, palette.body);
    pixel(6, 8, 4, 4, palette.body);
    pixel(10, 5, 3, 10, palette.light);
    pixel(17, 5, 3, 10, palette.light);
    pixel(22, 7, 3, 6, palette.light);
    pixel(2 - sway, 7, 6, 3, palette.fin);
    pixel(2 + sway, 11, 6, 3, palette.fin);
    pixel(20, 7, 1, 1, palette.eye);
    pixel(21, 6, 1, 1, palette.light);
    pixel(12, 13, 3, 2, palette.shadow);
  } else {
    // Manta fry: broad diamond wings, pale belly and trailing tail.
    pixel(8, 7, 15, 6, palette.body);
    pixel(11, 4, 9, 10, palette.body);
    pixel(5 - sway, 6, 6, 3, palette.fin);
    pixel(5 - sway, 11, 6, 3, palette.fin);
    pixel(2 - sway, 8, 5, 2, palette.fin);
    pixel(23, 8, 4, 2, palette.fin);
    pixel(20, 8, 1, 1, palette.eye);
    pixel(19, 7, 1, 1, palette.light);
    pixel(12, 10, 7, 2, palette.light);
    pixel(15, 12, 4, 2, palette.shadow);
  }

  const texture = new THREE.CanvasTexture(spriteCanvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFish(): FishVisual[] {
  const fish: FishVisual[] = [];
  const random = new SeededRandom(hashSeed('school-alpha'));
  const textures = [0, 1, 2, 3].map((variant) => [0, 1].map((frame) => makePixelFishTexture(variant, frame)));
  for (let i = 0; i < 48; i += 1) {
    const state = createFishState(i, random);
    const species = i % textures.length;
    const frames = textures[species];
    const material = new THREE.MeshBasicMaterial({ map: frames[0], transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    const depth = random.range(-0.48, 0.48);
    const baseSize = random.range(0.105, 0.15);
    mesh.position.set(state.position.x, state.position.y, depth);
    mesh.scale.set(baseSize, baseSize * 0.62, 1);
    mesh.renderOrder = 2;
    fishGroup.add(mesh);
    fish.push({ mesh, state, frames, species, phase: random.range(0, Math.PI * 2), depth, baseSize, heading: Math.atan2(state.velocity.y, state.velocity.x), turnAmount: 0, depthPhase: random.range(0, Math.PI * 2), depthVelocity: random.range(-0.025, 0.025) });
  }
  return fish;
}

makeTank();
makeBubbles();
makeCoral();
const fish = makeFish();

let genome: GenomeParameters = { ...DEFAULT_GENOME };
let target: THREE.WebGLRenderTarget | undefined;
let elapsed = 0;
let isPaused = false;
let frameCounter = 0;
let fpsTimer = 0;
let latestFps = 60;

const postMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uScene: { value: null },
    uResolution: { value: new THREE.Vector2() },
    uDither: { value: 1 },
    uScanlines: { value: 1 },
    uAberration: { value: 1 },
    uCurvature: { value: 1 },
    uIntensity: { value: 0.72 },
  },
  vertexShader: postVertex,
  fragmentShader: postFragment,
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));

function resize(): void {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  fractalPlane.scale.set(7.6 * camera.aspect, 7.6, 1);
  target?.dispose();
  const targetWidth = Math.max(160, Math.floor(width * genome.pixelDensity));
  const targetHeight = Math.max(100, Math.floor(height * genome.pixelDensity));
  target = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
    depthBuffer: false,
  });
  postMaterial.uniforms.uScene.value = target.texture;
  postMaterial.uniforms.uResolution.value.set(targetWidth, targetHeight);
}

function applyGenome(): void {
  fractalMaterial.uniforms.uCX.value = genome.cX;
  fractalMaterial.uniforms.uCY.value = genome.cY;
  fractalMaterial.uniforms.uZoom.value = genome.zoom;
  fractalMaterial.uniforms.uMaxIterations.value = genome.maxIterations;
  fractalMaterial.uniforms.uPalette.value = genome.palette;
  postMaterial.uniforms.uDither.value = genome.dither ? 1 : 0;
  postMaterial.uniforms.uScanlines.value = genome.scanlines ? 1 : 0;
  postMaterial.uniforms.uAberration.value = genome.chromaticAberration ? 1 : 0;
  postMaterial.uniforms.uCurvature.value = genome.curvature ? 1 : 0;
  postMaterial.uniforms.uIntensity.value = genome.filterIntensity;
  updatePresetState();
}

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function updateCameraPose(): void {
  camera.position.x = Math.sin(elapsed * 0.08) * 0.16;
  camera.position.y = 0.08 + Math.cos(elapsed * 0.06) * 0.024;
  camera.lookAt(0, -0.05, 0);
}

function clampCameraZoom(): void {
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, 1.7, 4.8);
  updateCameraPose();
}

function worldFromPointer(event: MouseEvent): THREE.Vector2 {
  const bounds = aquariumCanvas.getBoundingClientRect();
  pointerNdc.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    1 - ((event.clientY - bounds.top) / bounds.height) * 2,
  );
  pointerRaycaster.setFromCamera(pointerNdc, camera);
  const intersection = new THREE.Vector3();
  pointerRaycaster.ray.intersectPlane(interactionPlane, intersection);
  return new THREE.Vector2(intersection.x, intersection.y);
}

function spawnInteractionPulse(position: THREE.Vector2, color: number, duration = 1.25, maxScale = 4.5): void {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.018, 0.028, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.position.set(position.x, position.y, 0);
  ring.renderOrder = 4;
  feedGroup.add(ring);
  feedPulses.push({ position: position.clone(), age: 0, strength: 1, ring, duration, maxScale });
}

function dropFood(position: THREE.Vector2, announce = false): void {
  const point = position.clone();
  foodTargets.push({ position: point, age: 0 });
  influenceField.write(point, { nutrient: 0.9, activity: 1, radius: 0.16 });
  spawnInteractionPulse(point, 0xffd166);
  playFeedback('feed', 0.72);
  if (announce) announceFeedback('FOOD DROPPED');
}

function seedCoral(position: THREE.Vector2): void {
  const id = coralVisuals.reduce((highest, visual) => Math.max(highest, visual.node.id), -1) + 1;
  const node = createSeedCoralNode(id, position, hashSeed(`${elapsed.toFixed(3)}:${id}`));
  addCoralVisual(node);
  influenceField.write(position, { nutrient: 0.5, activity: 0.7, radius: 0.1 });
  spawnInteractionPulse(position, 0x61e1cc, 1.6, 5.2);
  playFeedback('seed', 0.9);
  announceFeedback('CORAL SEEDED');
}

function pruneCoral(position: THREE.Vector2): void {
  if (coralVisuals.length === 0) return;
  let targetId: number | null = null;
  let nearestDistance = 0.09;
  coralVisuals.forEach((visual) => {
    const endpoint = coralNodeEndpoint(visual.node);
    const midpoint = new THREE.Vector2((visual.node.position.x + endpoint.x) * 0.5, (visual.node.position.y + endpoint.y) * 0.5);
    const distance = Math.min(position.distanceTo(midpoint), position.distanceTo(new THREE.Vector2(endpoint.x, endpoint.y)));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      targetId = visual.node.id;
    }
  });
  if (targetId === null) return;
  const removedIds = new Set<number>([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    coralVisuals.forEach((visual) => {
      if (visual.node.parentId !== null && removedIds.has(visual.node.parentId) && !removedIds.has(visual.node.id)) {
        removedIds.add(visual.node.id);
        changed = true;
      }
    });
  }
  for (let index = coralVisuals.length - 1; index >= 0; index -= 1) {
    const visual = coralVisuals[index];
    if (!removedIds.has(visual.node.id)) continue;
    coralGroup.remove(visual.line, visual.branch, visual.bud);
    visual.line.geometry.dispose();
    visual.material.dispose();
    visual.branch.geometry.dispose();
    visual.branch.material.dispose();
    visual.bud.geometry.dispose();
    visual.bud.material.dispose();
    coralVisuals.splice(index, 1);
  }
  spawnInteractionPulse(position, 0xff7880, 1.05, 3.8);
  playFeedback('prune', 0.82);
  announceFeedback('BRANCH PRUNED', 'coral');
}

function updateFeedPulses(deltaSeconds: number): void {
  for (let index = feedPulses.length - 1; index >= 0; index -= 1) {
    const pulse = feedPulses[index];
    pulse.age += deltaSeconds;
    const progress = Math.min(1, pulse.age / pulse.duration);
    pulse.ring.scale.setScalar(1 + progress * pulse.maxScale);
    pulse.ring.material.opacity = Math.max(0, 0.78 * (1 - progress));
    if (pulse.age < pulse.duration) continue;
    feedGroup.remove(pulse.ring);
    pulse.ring.geometry.dispose();
    pulse.ring.material.dispose();
    feedPulses.splice(index, 1);
  }
  for (let index = foodTargets.length - 1; index >= 0; index -= 1) {
    foodTargets[index].age += deltaSeconds;
    if (foodTargets[index].age > 4) foodTargets.splice(index, 1);
  }
}

function updateFish(deltaSeconds: number): void {
  stepBoids(fish.map((item) => item.state), deltaSeconds, DEFAULT_AQUARIUM_BOUNDS, boidsHash);
  // Keep the school within the tank while allowing each fish to occupy its own depth layer.
  fishGroup.position.y = Math.sin(elapsed * 0.14) * 0.012;
  fishGroup.position.z = Math.cos(elapsed * 0.11) * 0.006;
  fish.forEach((item, index) => {
    const { state, mesh } = item;
    // A slow, phase-shifted current keeps the school on curved paths so turns are observable.
    state.velocity.x += Math.sin(elapsed * 0.31 + item.phase) * 0.022 * deltaSeconds;
    state.velocity.y += Math.cos(elapsed * 0.43 + item.phase * 1.7) * 0.034 * deltaSeconds;
    if (pointerActive) {
      const pointerOffsetX = pointerWorld.x - state.position.x;
      const pointerOffsetY = pointerWorld.y - state.position.y;
      const pointerDistance = Math.hypot(pointerOffsetX, pointerOffsetY);
      if (pointerDistance > 0.0001 && pointerDistance < 0.9) {
        const pointerAttraction = (1 - pointerDistance / 0.9) * state.curiosity * 0.12 * deltaSeconds;
        state.velocity.x += (pointerOffsetX / pointerDistance) * pointerAttraction;
        state.velocity.y += (pointerOffsetY / pointerDistance) * pointerAttraction;
      }
    }
    foodTargets.forEach((target) => {
      const offsetX = target.position.x - state.position.x;
      const offsetY = target.position.y - state.position.y;
      const distance = Math.hypot(offsetX, offsetY);
      if (distance > 0.75 || distance < 0.0001) return;
      const attraction = (1 - distance / 0.75) * state.curiosity * 0.24 * deltaSeconds;
      state.velocity.x += (offsetX / distance) * attraction;
      state.velocity.y += (offsetY / distance) * attraction;
    });
    const velocityMagnitude = Math.hypot(state.velocity.x, state.velocity.y);
    if (velocityMagnitude > state.maxSpeed) {
      const velocityScale = state.maxSpeed / velocityMagnitude;
      state.velocity.x *= velocityScale;
      state.velocity.y *= velocityScale;
    }
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    const targetHeading = Math.atan2(state.velocity.y, state.velocity.x);
    const angleDelta = shortestAngleDelta(item.heading, targetHeading);
    const turnResponse = 1 - Math.exp(-deltaSeconds * 13);
    item.heading += angleDelta * turnResponse;
    const angularSpeed = Math.abs(angleDelta) / Math.max(deltaSeconds, 1 / 120);
    const turnTarget = Math.min(1, angularSpeed * 0.34);
    item.turnAmount += (turnTarget - item.turnAmount) * (1 - Math.exp(-deltaSeconds * 22));
    const animationFrame = Math.floor((elapsed * (7.5 + speed * 14) + item.phase) % 2);
    const nextTexture = item.frames[animationFrame];
    if (mesh.material.map !== nextTexture) {
      mesh.material.map = nextTexture;
      mesh.material.needsUpdate = true;
    }
    const swim = Math.sin(elapsed * (8.0 + item.species * 0.8) + item.phase) * (0.009 + item.turnAmount * 0.006);
    const depthForce = Math.sin(elapsed * 0.37 + item.depthPhase) * 0.018 + Math.cos(elapsed * 0.71 + item.phase) * 0.012;
    item.depthVelocity += depthForce * deltaSeconds;
    item.depthVelocity *= Math.exp(-deltaSeconds * 0.8);
    item.depth += item.depthVelocity * deltaSeconds;
    if (item.depth < TANK_SPACE.backZ + 0.12 || item.depth > TANK_SPACE.frontZ - 0.12) {
      item.depth = THREE.MathUtils.clamp(item.depth, TANK_SPACE.backZ + 0.12, TANK_SPACE.frontZ - 0.12);
      item.depthVelocity *= -0.7;
    }
    mesh.position.set(state.position.x, state.position.y + swim, item.depth);
    // The pixel canvas is head-right; rotating the actual plane makes left/right turns unambiguous.
    mesh.rotation.z = item.heading + Math.sign(angleDelta) * item.turnAmount * 0.075;
    mesh.rotation.x = Math.sin(elapsed * 0.7 + item.phase) * 0.08 + item.turnAmount * 0.04;
    mesh.rotation.y = Math.cos(elapsed * 0.63 + item.phase) * 0.09;
    const pulse = 1 + Math.sin(elapsed * 5.5 + item.phase) * 0.045;
    const speciesAspect = [1.18, 0.88, 1.04, 1.35][item.species];
    const squash = 1 - item.turnAmount * 0.16;
    const depthScale = 1 + item.depth * 0.11;
    mesh.scale.set(item.baseSize * speciesAspect * pulse * squash * depthScale, item.baseSize * 0.62 * (1 + speed * 0.6 + item.turnAmount * 0.28) * depthScale, 1);
    mesh.material.opacity = 0.64 + 0.22 * Math.sin(elapsed * 1.4 + index);
    writeFishInfluence(influenceField, state.position, { species: item.species, speed, turnAmount: item.turnAmount });
  });
  influenceField.decay(deltaSeconds);
}

function updateCoral(deltaSeconds: number): void {
  const nodesById = new Map(coralVisuals.map((visual) => [visual.node.id, visual.node]));
  const feedbackGlow = new THREE.Color(0x9affd9);
  coralVisuals.forEach((visual) => {
    const { node, line, material } = visual;
    if (node.parentId !== null) {
      const parent = nodesById.get(node.parentId);
      if (parent) {
        const parentEnd = coralNodeEndpoint(parent);
        node.position.x = parentEnd.x;
        node.position.y = parentEnd.y;
      }
    }
    const influence = influenceField.sample(node.position);
    applyCoralFeedback(node, influence, deltaSeconds);
    const endpoint = coralNodeEndpoint(node);
    line.position.set(node.position.x, node.position.y, visual.depthOffset + node.depth * 0.006);
    line.scale.setScalar(node.length / visual.baseLength);
    const midpointX = (node.position.x + endpoint.x) * 0.5;
    const midpointY = (node.position.y + endpoint.y) * 0.5;
    visual.branch.position.set(midpointX, midpointY, visual.depthOffset + node.depth * 0.006);
    visual.branch.rotation.z = Math.atan2(node.direction.x, node.direction.y);
    visual.branch.scale.set(node.radius * 5.5, node.length * 0.92, node.radius * 5.5);
    visual.bud.position.set(endpoint.x, endpoint.y, visual.depthOffset + node.depth * 0.006);
    visual.bud.scale.setScalar(node.radius * 4.5 + influence.nutrient * 0.012);
    material.color.copy(visual.baseColor).lerp(feedbackGlow, Math.min(0.82, influence.nutrient * 0.5 + influence.activity * 0.32));
    material.opacity = Math.min(0.98, 0.42 + node.health * 0.42 + influence.activity * 0.2);
    visual.branch.material.color.copy(material.color);
    visual.branch.material.opacity = material.opacity * 0.76;
    visual.bud.material.color.copy(material.color).offsetHSL(0.01, 0.06, 0.08);
    visual.bud.material.opacity = Math.min(1, material.opacity + 0.06);
    line.userData.endpoint = endpoint;
  });
}

function updateReadouts(): void {
  const activity = Math.min(1, Math.max(0, influenceField.average().activity * 4.3));
  const activityText = document.querySelector<HTMLElement>('#activity-value');
  const activityFill = document.querySelector<HTMLElement>('#activity-bar-fill');
  const fpsText = document.querySelector<HTMLElement>('#fps-readout');
  const performanceText = document.querySelector<HTMLElement>('#performance-state');
  if (activityText) activityText.textContent = activity.toFixed(2);
  if (activityFill) activityFill.style.width = `${Math.round(activity * 100)}%`;
  if (fpsText) fpsText.textContent = `${latestFps}`;
  const performanceState = performanceMonitor.update(latestFps);
  if (performanceText) {
    const performanceLabel = performanceState === 'warning' ? 'LOW GPU' : 'GPU NOMINAL';
    if (performanceText.textContent !== performanceLabel) performanceText.textContent = performanceLabel;
    performanceText.classList.toggle('is-warning', performanceState === 'warning');
    performanceText.title = performanceState === 'warning' ? '帧率偏低，可降低 Pixel density' : '帧率正常';
  }
}

function render(): void {
  const delta = Math.min(clock.getDelta(), 0.05);
  if (!isPaused) {
    elapsed += delta;
    fractalMaterial.uniforms.uTime.value = elapsed;
    updateFish(delta);
    updateCoral(delta);
    updateFeedPulses(delta);
    updateBubbles(delta);
  }
  frameCounter += 1;
  fpsTimer += delta;
  if (fpsTimer > 0.5) {
    latestFps = Math.round(frameCounter / fpsTimer);
    frameCounter = 0;
    fpsTimer = 0;
    updateReadouts();
  }
  if (target) {
    updateCameraPose();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
  }
  requestAnimationFrame(render);
}

function setRange(id: string, value: string, formatter: (raw: number) => string): void {
  const output = document.querySelector<HTMLOutputElement>(`#${id}-value`);
  if (output) output.value = formatter(Number(value));
}

function updatePresetState(): void {
  const activePreset = GENOME_PRESETS.find((preset) => {
    const values = preset.values;
    return Math.abs(genome.cX - values.cX) < 0.0005
      && Math.abs(genome.cY - values.cY) < 0.0005
      && Math.abs(genome.zoom - values.zoom) < 0.005
      && genome.maxIterations === values.maxIterations
      && genome.palette === values.palette
      && Math.abs(genome.filterIntensity - values.filterIntensity) < 0.005;
  });
  document.querySelectorAll<HTMLButtonElement>('.preset-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.preset === activePreset?.id);
  });
}

function syncGenomeControls(): void {
  const values: Record<string, string> = {
    cx: `${genome.cX}`,
    cy: `${genome.cY}`,
    zoom: `${genome.zoom}`,
    iter: `${genome.maxIterations}`,
    pixel: `${genome.pixelDensity * 100}`,
    filter: `${genome.filterIntensity * 100}`,
  };
  Object.entries(values).forEach(([id, value]) => {
    const input = document.querySelector<HTMLInputElement>(`#${id}-input`);
    if (input) input.value = value;
  });
  const ditherInput = document.querySelector<HTMLInputElement>('#dither-input');
  const scanlineInput = document.querySelector<HTMLInputElement>('#scanline-input');
  const aberrationInput = document.querySelector<HTMLInputElement>('#aberration-input');
  const curvatureInput = document.querySelector<HTMLInputElement>('#curvature-input');
  if (ditherInput) ditherInput.checked = genome.dither;
  if (scanlineInput) scanlineInput.checked = genome.scanlines;
  if (aberrationInput) aberrationInput.checked = genome.chromaticAberration;
  if (curvatureInput) curvatureInput.checked = genome.curvature;
  document.querySelectorAll('.palette-swatch').forEach((swatch, index) => swatch.classList.toggle('is-active', index === genome.palette));
  setRange('cx', values.cx, (value) => value.toFixed(3));
  setRange('cy', values.cy, (value) => value.toFixed(3));
  setRange('zoom', values.zoom, (value) => `${value.toFixed(2)}x`);
  setRange('iter', values.iter, (value) => `${Math.round(value)}`);
  setRange('pixel', values.pixel, (value) => `${Math.round(value)}%`);
  setRange('filter', values.filter, (value) => `${Math.round(value)}%`);
}

function setSimulationPaused(nextPaused: boolean): void {
  if (isPaused === nextPaused) return;
  isPaused = nextPaused;
  const button = document.querySelector<HTMLButtonElement>('#pause-button');
  if (button) {
    button.textContent = isPaused ? 'Resume simulation' : 'Pause simulation';
    button.setAttribute('aria-pressed', `${isPaused}`);
  }
  const state = document.querySelector<HTMLElement>('#runtime-state');
  if (state) state.textContent = isPaused ? 'PAUSED' : 'RUNNING';
  document.querySelector('.readout-dot')?.classList.toggle('is-paused', isPaused);
  playFeedback('pause', 0.72);
  announceFeedback(isPaused ? 'SIMULATION PAUSED' : 'SIMULATION RESUMED', isPaused ? 'coral' : 'aqua');
}

function resetGenome(): void {
  genome = { ...DEFAULT_GENOME };
  syncGenomeControls();
  applyGenome();
  resize();
  playFeedback('ui', 0.55);
  announceFeedback('GENOME RESET');
}

function bindControls(): void {
  const cxInput = document.querySelector<HTMLInputElement>('#cx-input');
  const cyInput = document.querySelector<HTMLInputElement>('#cy-input');
  const zoomInput = document.querySelector<HTMLInputElement>('#zoom-input');
  const iterInput = document.querySelector<HTMLInputElement>('#iter-input');
  const pixelInput = document.querySelector<HTMLInputElement>('#pixel-input');
  const filterInput = document.querySelector<HTMLInputElement>('#filter-input');
  cxInput?.addEventListener('input', () => { genome.cX = Number(cxInput.value); setRange('cx', cxInput.value, (value) => value.toFixed(3)); applyGenome(); });
  cyInput?.addEventListener('input', () => { genome.cY = Number(cyInput.value); setRange('cy', cyInput.value, (value) => value.toFixed(3)); applyGenome(); });
  zoomInput?.addEventListener('input', () => { genome.zoom = Number(zoomInput.value); setRange('zoom', zoomInput.value, (value) => `${value.toFixed(2)}x`); applyGenome(); });
  iterInput?.addEventListener('input', () => { genome.maxIterations = Number(iterInput.value); setRange('iter', iterInput.value, (value) => `${Math.round(value)}`); applyGenome(); });
  pixelInput?.addEventListener('input', () => {
    genome.pixelDensity = Number(pixelInput.value) / 100;
    setRange('pixel', pixelInput.value, (value) => `${Math.round(value)}%`);
    resize();
  });
  filterInput?.addEventListener('input', () => { genome.filterIntensity = Number(filterInput.value) / 100; setRange('filter', filterInput.value, (value) => `${Math.round(value)}%`); applyGenome(); });
  document.querySelector<HTMLInputElement>('#dither-input')?.addEventListener('change', (event) => { genome.dither = (event.target as HTMLInputElement).checked; applyGenome(); });
  document.querySelector<HTMLInputElement>('#scanline-input')?.addEventListener('change', (event) => { genome.scanlines = (event.target as HTMLInputElement).checked; applyGenome(); });
  document.querySelector<HTMLInputElement>('#aberration-input')?.addEventListener('change', (event) => { genome.chromaticAberration = (event.target as HTMLInputElement).checked; applyGenome(); });
  document.querySelector<HTMLInputElement>('#curvature-input')?.addEventListener('change', (event) => { genome.curvature = (event.target as HTMLInputElement).checked; applyGenome(); });
  document.querySelectorAll<HTMLButtonElement>('.palette-swatch').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.palette-swatch').forEach((swatch) => swatch.classList.remove('is-active'));
      button.classList.add('is-active');
      genome.palette = Number(button.dataset.palette ?? 0);
      applyGenome();
      playFeedback('ui', 0.38);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.preset-button').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = GENOME_PRESETS.find((candidate) => candidate.id === button.dataset.preset);
      if (!preset) return;
      genome = applyGenomePreset(genome, preset);
      syncGenomeControls();
      applyGenome();
      playFeedback('preset', 0.75);
      announceFeedback(`PRESET: ${preset.name.toUpperCase()}`);
    });
  });
  document.querySelector<HTMLInputElement>('#audio-input')?.addEventListener('change', (event) => {
    audioEnabled = (event.target as HTMLInputElement).checked;
    if (audioEnabled) {
      ensureAudio();
      playFeedback('ui', 0.55);
      announceFeedback('EVENT AUDIO ON');
    } else {
      announceFeedback('EVENT AUDIO OFF', 'coral');
    }
  });
  document.querySelector<HTMLButtonElement>('#pause-button')?.addEventListener('click', () => {
    setSimulationPaused(!isPaused);
  });
  document.querySelector<HTMLButtonElement>('#reset-button')?.addEventListener('click', () => {
    resetGenome();
  });
}

function bindInteractions(): void {
  aquariumCanvas.addEventListener('pointermove', (event) => {
    pointerWorld.copy(worldFromPointer(event));
    pointerActive = true;
    if ((event.buttons & 1) !== 0 && !event.shiftKey && elapsed - lastFeedAt > 0.18) {
      dropFood(pointerWorld);
      lastFeedAt = elapsed;
    }
  });
  aquariumCanvas.addEventListener('pointerleave', () => { pointerActive = false; });
  aquariumCanvas.addEventListener('pointerdown', (event) => {
    pointerWorld.copy(worldFromPointer(event));
    pointerActive = true;
    if (event.button === 0) {
      if (event.shiftKey) seedCoral(pointerWorld);
      else dropFood(pointerWorld, true);
      lastFeedAt = elapsed;
    } else if (event.button === 2) {
      pruneCoral(pointerWorld);
    }
  });
  aquariumCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
  aquariumCanvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.position.z *= Math.exp(event.deltaY * 0.001);
    clampCameraZoom();
  }, { passive: false });
}

function bindKeyboard(): void {
  window.addEventListener('keydown', (event) => {
    const activeElement = document.activeElement;
    const isFormControl = activeElement instanceof HTMLInputElement
      || activeElement instanceof HTMLTextAreaElement
      || activeElement instanceof HTMLSelectElement
      || activeElement instanceof HTMLButtonElement
      || activeElement instanceof HTMLAnchorElement;
    if (isFormControl) return;
    if (event.code === 'Space') {
      event.preventDefault();
      setSimulationPaused(!isPaused);
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      resetGenome();
    }
  });
}

bindControls();
bindInteractions();
bindKeyboard();
applyGenome();
resize();
window.addEventListener('resize', resize);
render();
