export interface Vec2 {
  x: number;
  y: number;
}

export interface AquariumBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface FishState {
  id: number;
  position: Vec2;
  velocity: Vec2;
  acceleration: Vec2;
  energy: number;
  age: number;
  maxSpeed: number;
  maxForce: number;
  separationRadius: number;
  alignmentRadius: number;
  cohesionRadius: number;
  curiosity: number;
  genomeSample: number;
}

export interface CoralNode {
  id: number;
  parentId: number | null;
  position: Vec2;
  direction: Vec2;
  length: number;
  radius: number;
  depth: number;
  health: number;
  growth: number;
  seed: number;
}

export interface InfluenceCell {
  nutrient: number;
  disturbance: number;
  activity: number;
}

export const DEFAULT_AQUARIUM_BOUNDS: AquariumBounds = {
  minX: -1,
  maxX: 1,
  minY: -0.1,
  maxY: 0.8,
};

const UINT32_SCALE = 1 / 0x100000000;

/** Small deterministic PRNG for reproducible fish and coral snapshots. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x6d2b79f5;
  }

  nextUint(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  next(): number {
    return this.nextUint() * UINT32_SCALE;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxExclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusive) || maxExclusive <= min) {
      throw new RangeError('maxExclusive must be an integer greater than min');
    }
    return min + Math.floor(this.next() * (maxExclusive - min));
  }
}

export function hashSeed(value: string | number): number {
  if (typeof value === 'number') return value >>> 0;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createFishState(id: number, random: SeededRandom): FishState {
  return {
    id,
    position: { x: random.range(-0.9, 0.9), y: random.range(0.05, 0.72) },
    velocity: { x: random.range(-0.08, 0.08), y: random.range(-0.04, 0.04) },
    acceleration: { x: 0, y: 0 },
    energy: random.range(0.72, 1),
    age: 0,
    maxSpeed: random.range(0.12, 0.22),
    maxForce: random.range(0.24, 0.42),
    separationRadius: random.range(0.035, 0.06),
    alignmentRadius: random.range(0.12, 0.2),
    cohesionRadius: random.range(0.18, 0.3),
    curiosity: random.range(0.15, 0.9),
    genomeSample: random.next(),
  };
}

export function createCoralNode(id: number, random: SeededRandom, parentId: number | null = null): CoralNode {
  const direction = random.range(-0.35, 0.35);
  return {
    id,
    parentId,
    position: { x: random.range(-0.9, 0.9), y: -0.88 },
    direction: { x: direction, y: Math.sqrt(1 - direction * direction) },
    length: random.range(0.08, 0.22),
    radius: random.range(0.008, 0.022),
    depth: parentId === null ? 0 : 1,
    health: random.range(0.7, 1),
    growth: random.range(0.2, 0.8),
    seed: random.nextUint(),
  };
}

export function createInfluenceCell(): InfluenceCell {
  return { nutrient: 0, disturbance: 0, activity: 0 };
}

export function wrapCoordinate(value: number, min: number, max: number): number {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) throw new RangeError('max must be greater than min');
  return ((value - min) % span + span) % span + min;
}

export function wrapPosition(position: Vec2, bounds: AquariumBounds = DEFAULT_AQUARIUM_BOUNDS): Vec2 {
  return {
    x: wrapCoordinate(position.x, bounds.minX, bounds.maxX),
    y: wrapCoordinate(position.y, bounds.minY, bounds.maxY),
  };
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
