import { clampUnit, type AquariumBounds, type InfluenceCell, type Vec2 } from './simulation';

export interface InfluenceWrite extends Partial<InfluenceCell> {
  radius?: number;
}

export interface FishInfluenceProfile {
  species: number;
  speed: number;
  turnAmount: number;
}

export interface InfluenceFieldOptions {
  width?: number;
  height?: number;
  bounds?: AquariumBounds;
  decayRate?: number;
}

export function writeFishInfluence(field: InfluenceField, position: Vec2, profile: FishInfluenceProfile): void {
  const speciesRadius = Math.max(0, Math.min(3, profile.species)) * 0.008;
  const speed = Math.max(0, profile.speed);
  const turnAmount = clampUnit(profile.turnAmount);
  field.write(position, {
    nutrient: Math.min(1, 0.12 + speed * 1.4),
    disturbance: Math.min(1, turnAmount * 0.85 + speed * 0.2),
    activity: Math.min(1, 0.18 + speed * 2.1 + turnAmount * 0.35),
    radius: 0.055 + speciesRadius,
  });
}

/** Low-resolution ecology field written by moving agents and sampled by growth systems. */
export class InfluenceField {
  readonly width: number;
  readonly height: number;
  readonly bounds: AquariumBounds;
  readonly decayRate: number;
  private readonly nutrient: Float32Array;
  private readonly disturbance: Float32Array;
  private readonly activity: Float32Array;

  constructor(options: InfluenceFieldOptions = {}) {
    this.width = options.width ?? 64;
    this.height = options.height ?? 64;
    this.bounds = options.bounds ?? { minX: -1, maxX: 1, minY: -0.1, maxY: 0.8 };
    this.decayRate = options.decayRate ?? 0.72;
    if (!Number.isInteger(this.width) || this.width < 2 || !Number.isInteger(this.height) || this.height < 2) {
      throw new RangeError('Influence field dimensions must be integers greater than one');
    }
    if (!Number.isFinite(this.decayRate) || this.decayRate < 0) throw new RangeError('decayRate must be non-negative');
    this.nutrient = new Float32Array(this.width * this.height);
    this.disturbance = new Float32Array(this.width * this.height);
    this.activity = new Float32Array(this.width * this.height);
  }

  clear(): void {
    this.nutrient.fill(0);
    this.disturbance.fill(0);
    this.activity.fill(0);
  }

  write(position: Vec2, influence: InfluenceWrite): void {
    const center = this.toGrid(position);
    const radius = Math.max(0, influence.radius ?? 0.08);
    const cellWidth = (this.bounds.maxX - this.bounds.minX) / this.width;
    const cellHeight = (this.bounds.maxY - this.bounds.minY) / this.height;
    const radiusX = Math.max(0, Math.ceil(radius / cellWidth));
    const radiusY = Math.max(0, Math.ceil(radius / cellHeight));
    const nutrient = clampUnit(influence.nutrient ?? 0);
    const disturbance = clampUnit(influence.disturbance ?? 0);
    const activity = clampUnit(influence.activity ?? Math.max(nutrient, disturbance));

    for (let y = center.y - radiusY; y <= center.y + radiusY; y += 1) {
      for (let x = center.x - radiusX; x <= center.x + radiusX; x += 1) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
        const normalizedX = radiusX === 0 ? 0 : (x - center.x) / radiusX;
        const normalizedY = radiusY === 0 ? 0 : (y - center.y) / radiusY;
        const distance = Math.hypot(normalizedX, normalizedY);
        if (distance > 1) continue;
        const weight = 1 - distance * distance;
        const index = this.index(x, y);
        this.nutrient[index] = clampUnit(this.nutrient[index] + nutrient * weight);
        this.disturbance[index] = clampUnit(this.disturbance[index] + disturbance * weight);
        this.activity[index] = clampUnit(this.activity[index] + activity * weight);
      }
    }
  }

  decay(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || this.decayRate === 0) return;
    const factor = Math.exp(-this.decayRate * deltaSeconds);
    for (let index = 0; index < this.nutrient.length; index += 1) {
      this.nutrient[index] *= factor;
      this.disturbance[index] *= factor;
      this.activity[index] *= factor;
    }
  }

  sample(position: Vec2): InfluenceCell {
    const grid = this.toGrid(position);
    const index = this.index(grid.x, grid.y);
    return {
      nutrient: this.nutrient[index],
      disturbance: this.disturbance[index],
      activity: this.activity[index],
    };
  }

  average(): InfluenceCell {
    let nutrient = 0;
    let disturbance = 0;
    let activity = 0;
    for (let index = 0; index < this.nutrient.length; index += 1) {
      nutrient += this.nutrient[index];
      disturbance += this.disturbance[index];
      activity += this.activity[index];
    }
    const count = this.nutrient.length;
    return { nutrient: nutrient / count, disturbance: disturbance / count, activity: activity / count };
  }

  private toGrid(position: Vec2): { x: number; y: number } {
    const normalizedX = clampUnit((position.x - this.bounds.minX) / (this.bounds.maxX - this.bounds.minX));
    const normalizedY = clampUnit((position.y - this.bounds.minY) / (this.bounds.maxY - this.bounds.minY));
    return {
      x: Math.min(this.width - 1, Math.max(0, Math.floor(normalizedX * this.width))),
      y: Math.min(this.height - 1, Math.max(0, Math.floor(normalizedY * this.height))),
    };
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }
}
