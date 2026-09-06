import { describe, expect, it } from 'vitest';
import { PerformanceMonitor } from './performance';

describe('performance monitor', () => {
  it('waits for consecutive low samples before warning', () => {
    const monitor = new PerformanceMonitor({ warningFps: 45, warningSamples: 3 });
    expect(monitor.update(40)).toBe('nominal');
    expect(monitor.update(42)).toBe('nominal');
    expect(monitor.update(44)).toBe('warning');
  });

  it('requires recovery samples before clearing a warning', () => {
    const monitor = new PerformanceMonitor({ warningSamples: 1, recoverySamples: 2 });
    expect(monitor.update(30)).toBe('warning');
    expect(monitor.update(60)).toBe('warning');
    expect(monitor.update(60)).toBe('nominal');
  });

  it('ignores invalid frame-rate values', () => {
    const monitor = new PerformanceMonitor({ warningSamples: 1 });
    expect(monitor.update(Number.NaN)).toBe('nominal');
    expect(monitor.update(50)).toBe('nominal');
  });
});
