import { describe, expect, it } from 'vitest';
import { DEFAULT_GENOME, GENOME_PRESETS, applyGenomePreset, clamp, cloneGenome, formatGenomeValue } from './genome';

describe('genome helpers', () => {
  it('clamps a parameter to its allowed range', () => {
    expect(clamp(-2, -1, 1)).toBe(-1);
    expect(clamp(0.5, -1, 1)).toBe(0.5);
    expect(clamp(2, -1, 1)).toBe(1);
  });

  it('clones parameters without sharing object identity', () => {
    const clone = cloneGenome(DEFAULT_GENOME);
    expect(clone).toEqual(DEFAULT_GENOME);
    expect(clone).not.toBe(DEFAULT_GENOME);
  });

  it('formats the coordinate readout consistently', () => {
    expect(formatGenomeValue(DEFAULT_GENOME.cX)).toBe('-0.745');
    expect(formatGenomeValue(1.2, 2)).toBe('1.20');
  });

  it('keeps retro filter defaults enabled with a bounded intensity', () => {
    expect(DEFAULT_GENOME.chromaticAberration).toBe(true);
    expect(DEFAULT_GENOME.curvature).toBe(true);
    expect(DEFAULT_GENOME.filterIntensity).toBeGreaterThan(0);
    expect(DEFAULT_GENOME.filterIntensity).toBeLessThanOrEqual(1);
  });

  it('provides unique, complete genome presets', () => {
    expect(new Set(GENOME_PRESETS.map((preset) => preset.id)).size).toBe(GENOME_PRESETS.length);
    GENOME_PRESETS.forEach((preset) => {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.values.maxIterations).toBeGreaterThan(0);
      expect(preset.values.filterIntensity).toBeGreaterThanOrEqual(0);
      expect(preset.values.filterIntensity).toBeLessThanOrEqual(1);
    });
  });

  it('applies visual preset values without dropping live filter toggles', () => {
    const source = { ...DEFAULT_GENOME, dither: false, pixelDensity: 0.44 };
    const preset = GENOME_PRESETS.find((candidate) => candidate.id === 'violet-tide');
    expect(preset).toBeDefined();
    const applied = applyGenomePreset(source, preset!);
    expect(applied.palette).toBe(2);
    expect(applied.zoom).toBe(1.74);
    expect(applied.dither).toBe(false);
    expect(applied.pixelDensity).toBe(0.44);
  });
});
