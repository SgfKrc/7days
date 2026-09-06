import { describe, expect, it } from 'vitest';
import { DEFAULT_AQUARIUM_BOUNDS, SeededRandom, createFishState } from './simulation';
import { SpatialHash, stepBoids } from './boids';

function fishAt(id: number, x: number, y: number) {
  const fish = createFishState(id, new SeededRandom(id + 1));
  fish.position = { x, y };
  fish.velocity = { x: 0.08, y: 0 };
  fish.maxSpeed = 0.2;
  fish.maxForce = 0.8;
  return fish;
}

describe('spatial hash and boids', () => {
  it('returns only fish inside the query radius', () => {
    const hash = new SpatialHash(0.2);
    const near = fishAt(1, 0, 0);
    const diagonal = fishAt(2, 0.15, 0.15);
    const far = fishAt(3, 0.5, 0.5);
    hash.rebuild([near, diagonal, far]);
    expect(hash.bucketCount).toBe(2);
    expect(hash.query({ x: 0, y: 0 }, 0.2).map((fish) => fish.id)).toEqual([near.id]);
    expect(hash.query({ x: 0, y: 0 }, 0.25).map((fish) => fish.id)).toEqual([near.id, diagonal.id]);
  });

  it('rebuilds buckets without retaining removed fish', () => {
    const hash = new SpatialHash(0.5);
    const first = fishAt(1, 0, 0);
    const second = fishAt(2, 0.1, 0.1);
    hash.rebuild([first, second]);
    hash.rebuild([second]);
    expect(hash.query({ x: 0, y: 0 }, 0.3).map((fish) => fish.id)).toEqual([second.id]);
  });

  it('applies separation and advances fish inside wrapped bounds', () => {
    const left = fishAt(1, 0.01, 0.2);
    const right = fishAt(2, 0.04, 0.2);
    left.velocity = { x: 0, y: 0 };
    right.velocity = { x: 0, y: 0 };
    const before = { ...left.position };
    stepBoids([left, right], 0.5, DEFAULT_AQUARIUM_BOUNDS, new SpatialHash(0.1));
    expect(left.position).not.toEqual(before);
    expect(left.acceleration.x).toBeLessThan(0);
    expect(left.position.x).toBeGreaterThanOrEqual(DEFAULT_AQUARIUM_BOUNDS.minX);
    expect(left.position.x).toBeLessThan(DEFAULT_AQUARIUM_BOUNDS.maxX);
    expect(left.energy).toBeLessThan(1);
  });

  it('wraps an advancing fish at the horizontal edge', () => {
    const fish = fishAt(1, 0.99, 0.2);
    fish.velocity = { x: 0.2, y: 0 };
    stepBoids([fish], 1, DEFAULT_AQUARIUM_BOUNDS);
    expect(fish.position.x).toBeCloseTo(-0.81);
  });
});
