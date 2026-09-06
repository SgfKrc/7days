import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AQUARIUM_BOUNDS,
  SeededRandom,
  clampUnit,
  createCoralNode,
  createFishState,
  createInfluenceCell,
  hashSeed,
  wrapCoordinate,
  wrapPosition,
} from './simulation';

describe('simulation data model', () => {
  it('produces the same random sequence for the same seed', () => {
    const first = new SeededRandom(hashSeed('m0-genome'));
    const second = new SeededRandom(hashSeed('m0-genome'));
    expect(Array.from({ length: 8 }, () => first.next())).toEqual(Array.from({ length: 8 }, () => second.next()));
  });

  it('creates reproducible fish state inside the aquarium bounds', () => {
    const first = createFishState(7, new SeededRandom(42));
    const second = createFishState(7, new SeededRandom(42));
    expect(first).toEqual(second);
    expect(first.position.x).toBeGreaterThanOrEqual(-0.9);
    expect(first.position.x).toBeLessThanOrEqual(0.9);
    expect(first.position.y).toBeGreaterThanOrEqual(0.05);
    expect(first.position.y).toBeLessThanOrEqual(0.72);
    expect(first.genomeSample).toBeGreaterThanOrEqual(0);
    expect(first.genomeSample).toBeLessThan(1);
  });

  it('creates rooted and child coral nodes with valid geometry', () => {
    const root = createCoralNode(1, new SeededRandom(8));
    const child = createCoralNode(2, new SeededRandom(8), root.id);
    expect(root.parentId).toBeNull();
    expect(child.parentId).toBe(root.id);
    expect(root.position.y).toBe(-0.88);
    expect(Math.hypot(child.direction.x, child.direction.y)).toBeCloseTo(1, 10);
    expect(child.seed).toEqual(root.seed);
  });

  it('starts influence cells neutral and clamps normalized values', () => {
    expect(createInfluenceCell()).toEqual({ nutrient: 0, disturbance: 0, activity: 0 });
    expect(clampUnit(-0.4)).toBe(0);
    expect(clampUnit(0.4)).toBe(0.4);
    expect(clampUnit(1.4)).toBe(1);
  });

  it('wraps positions across both aquarium edges', () => {
    expect(wrapCoordinate(DEFAULT_AQUARIUM_BOUNDS.maxX, DEFAULT_AQUARIUM_BOUNDS.minX, DEFAULT_AQUARIUM_BOUNDS.maxX)).toBe(-1);
    expect(wrapCoordinate(-1.25, -1, 1)).toBeCloseTo(0.75);
    const wrapped = wrapPosition({ x: 1.1, y: -0.2 });
    expect(wrapped.x).toBeCloseTo(-0.9);
    expect(wrapped.y).toBeCloseTo(0.7);
  });

  it('rejects invalid random integer and wrapping ranges', () => {
    expect(() => new SeededRandom(1).int(2, 2)).toThrow(RangeError);
    expect(() => wrapCoordinate(0, 1, 1)).toThrow(RangeError);
  });
});
