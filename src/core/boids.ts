import { clampUnit, type AquariumBounds, type FishState, type Vec2, wrapPosition } from './simulation';

export interface BoidsParameters {
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
}

export const DEFAULT_BOIDS_PARAMETERS: BoidsParameters = {
  separationWeight: 1.2,
  alignmentWeight: 0.55,
  cohesionWeight: 0.42,
};

type FishBucket = FishState[];

/** Uniform-grid neighbor index. Rebuild once per simulation tick, query many times. */
export class SpatialHash {
  private readonly cells = new Map<string, FishBucket>();

  constructor(public readonly cellSize = 0.25) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('cellSize must be greater than zero');
  }

  clear(): void {
    this.cells.clear();
  }

  insert(fish: FishState): void {
    const key = this.keyFor(fish.position);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(fish);
    else this.cells.set(key, [fish]);
  }

  rebuild(fish: readonly FishState[]): void {
    this.clear();
    fish.forEach((item) => this.insert(item));
  }

  query(position: Vec2, radius: number): FishState[] {
    if (radius < 0 || !Number.isFinite(radius)) throw new RangeError('radius must be non-negative');
    const result: FishState[] = [];
    const minCellX = Math.floor((position.x - radius) / this.cellSize);
    const maxCellX = Math.floor((position.x + radius) / this.cellSize);
    const minCellY = Math.floor((position.y - radius) / this.cellSize);
    const maxCellY = Math.floor((position.y + radius) / this.cellSize);
    const radiusSquared = radius * radius;

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const bucket = this.cells.get(`${cellX}:${cellY}`);
        if (!bucket) continue;
        bucket.forEach((fish) => {
          const dx = fish.position.x - position.x;
          const dy = fish.position.y - position.y;
          if (dx * dx + dy * dy <= radiusSquared) result.push(fish);
        });
      }
    }
    return result;
  }

  get bucketCount(): number {
    return this.cells.size;
  }

  private keyFor(position: Vec2): string {
    return `${Math.floor(position.x / this.cellSize)}:${Math.floor(position.y / this.cellSize)}`;
  }
}

function length(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

function addScaled(target: Vec2, source: Vec2, scale: number): void {
  target.x += source.x * scale;
  target.y += source.y * scale;
}

function limit(vector: Vec2, maxLength: number): void {
  const currentLength = length(vector);
  if (currentLength <= maxLength || currentLength === 0) return;
  const scale = maxLength / currentLength;
  vector.x *= scale;
  vector.y *= scale;
}

function weightedDirection(vector: Vec2, maxSpeed: number): Vec2 {
  const currentLength = length(vector);
  if (currentLength === 0) return { x: 0, y: 0 };
  return { x: (vector.x / currentLength) * maxSpeed, y: (vector.y / currentLength) * maxSpeed };
}

/** Advances one Boids tick while keeping state independent from Three.js. */
export function stepBoids(
  fish: FishState[],
  deltaSeconds: number,
  bounds: AquariumBounds,
  hash = new SpatialHash(),
  parameters: BoidsParameters = DEFAULT_BOIDS_PARAMETERS,
): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || fish.length === 0) return;
  hash.rebuild(fish);

  fish.forEach((current) => {
    const neighborhoodRadius = Math.max(current.separationRadius, current.alignmentRadius, current.cohesionRadius);
    const neighbors = hash.query(current.position, neighborhoodRadius).filter((candidate) => candidate !== current);
    const separation = { x: 0, y: 0 };
    const alignment = { x: 0, y: 0 };
    const cohesion = { x: 0, y: 0 };
    let alignmentCount = 0;
    let cohesionCount = 0;

    neighbors.forEach((neighbor) => {
      const offset = { x: current.position.x - neighbor.position.x, y: current.position.y - neighbor.position.y };
      const distance = length(offset);
      if (distance === 0) return;

      if (distance <= current.separationRadius) {
        addScaled(separation, offset, (current.separationRadius - distance) / (current.separationRadius * distance));
      }
      if (distance <= current.alignmentRadius) {
        addScaled(alignment, neighbor.velocity, 1);
        alignmentCount += 1;
      }
      if (distance <= current.cohesionRadius) {
        addScaled(cohesion, neighbor.position, 1);
        cohesionCount += 1;
      }
    });

    const steering = { x: 0, y: 0 };
    if (length(separation) > 0) addScaled(steering, weightedDirection(separation, current.maxSpeed), parameters.separationWeight);
    if (alignmentCount > 0) {
      alignment.x /= alignmentCount;
      alignment.y /= alignmentCount;
      alignment.x -= current.velocity.x;
      alignment.y -= current.velocity.y;
      addScaled(steering, alignment, parameters.alignmentWeight);
    }
    if (cohesionCount > 0) {
      cohesion.x = cohesion.x / cohesionCount - current.position.x;
      cohesion.y = cohesion.y / cohesionCount - current.position.y;
      addScaled(steering, weightedDirection(cohesion, current.maxSpeed), parameters.cohesionWeight);
    }

    current.acceleration.x = steering.x;
    current.acceleration.y = steering.y;
    limit(current.acceleration, current.maxForce);
    current.velocity.x += current.acceleration.x * deltaSeconds;
    current.velocity.y += current.acceleration.y * deltaSeconds;
    limit(current.velocity, current.maxSpeed);
    current.position.x += current.velocity.x * deltaSeconds;
    current.position.y += current.velocity.y * deltaSeconds;
    current.position = wrapPosition(current.position, bounds);
    current.age += deltaSeconds;
    current.energy = clampUnit(current.energy - deltaSeconds * (0.002 + length(current.velocity) * 0.004));
  });
}
