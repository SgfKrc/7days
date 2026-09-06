import { describe, expect, it } from 'vitest';
import { InfluenceField, writeFishInfluence } from './influence';

describe('influence field', () => {
  it('writes a local gaussian-like influence that stays normalized', () => {
    const field = new InfluenceField({ width: 8, height: 8 });
    field.write({ x: 0, y: 0.35 }, { nutrient: 0.8, disturbance: 0.4, radius: 0.12 });
    const center = field.sample({ x: 0, y: 0.35 });
    const far = field.sample({ x: 0.9, y: 0.7 });
    expect(center.nutrient).toBeGreaterThan(0);
    expect(center.disturbance).toBeGreaterThan(0);
    expect(center.activity).toBeGreaterThanOrEqual(center.nutrient);
    expect(far.activity).toBe(0);
    expect(center.nutrient).toBeLessThanOrEqual(1);
  });

  it('accumulates nearby writes without exceeding one', () => {
    const field = new InfluenceField({ width: 4, height: 4 });
    for (let i = 0; i < 20; i += 1) field.write({ x: 0, y: 0.2 }, { activity: 0.25, radius: 0 });
    expect(field.sample({ x: 0, y: 0.2 }).activity).toBe(1);
  });

  it('decays values exponentially and clears all channels', () => {
    const field = new InfluenceField({ width: 8, height: 8, decayRate: 1 });
    field.write({ x: -0.4, y: 0.1 }, { nutrient: 1, activity: 1, radius: 0 });
    const before = field.sample({ x: -0.4, y: 0.1 });
    field.decay(1);
    const after = field.sample({ x: -0.4, y: 0.1 });
    expect(after.nutrient).toBeCloseTo(before.nutrient * Math.exp(-1), 4);
    expect(after.activity).toBeCloseTo(before.activity * Math.exp(-1), 4);
    field.clear();
    expect(field.average()).toEqual({ nutrient: 0, disturbance: 0, activity: 0 });
  });

  it('clamps out-of-bounds samples to edge cells', () => {
    const field = new InfluenceField({ width: 4, height: 4 });
    field.write({ x: 1, y: 0.8 }, { activity: 0.7, radius: 0 });
    expect(field.sample({ x: 4, y: 2 }).activity).toBeGreaterThan(0);
  });

  it('rejects invalid dimensions and decay rates', () => {
    expect(() => new InfluenceField({ width: 1 })).toThrow(RangeError);
    expect(() => new InfluenceField({ decayRate: -1 })).toThrow(RangeError);
  });

  it('maps fish speed and turning into normalized ecology channels', () => {
    const field = new InfluenceField({ width: 8, height: 8 });
    writeFishInfluence(field, { x: 0, y: 0.3 }, { species: 2, speed: 0.2, turnAmount: 0.8 });
    const sample = field.sample({ x: 0, y: 0.3 });
    expect(sample.nutrient).toBeCloseTo(0.4, 4);
    expect(sample.disturbance).toBeCloseTo(0.72, 4);
    expect(sample.activity).toBeCloseTo(0.88, 4);
    expect(sample.nutrient).toBeLessThanOrEqual(1);
    expect(sample.activity).toBeLessThanOrEqual(1);
  });
});
