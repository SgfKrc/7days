export type PerformanceState = 'nominal' | 'warning';

export interface PerformanceMonitorOptions {
  warningFps?: number;
  warningSamples?: number;
  recoverySamples?: number;
}

export class PerformanceMonitor {
  private readonly warningFps: number;
  private readonly warningSamples: number;
  private readonly recoverySamples: number;
  private lowSamples = 0;
  private recoverySamplesSeen = 0;
  private currentState: PerformanceState = 'nominal';

  constructor(options: PerformanceMonitorOptions = {}) {
    this.warningFps = options.warningFps ?? 45;
    this.warningSamples = Math.max(1, options.warningSamples ?? 3);
    this.recoverySamples = Math.max(1, options.recoverySamples ?? 2);
  }

  update(fps: number): PerformanceState {
    if (!Number.isFinite(fps)) return this.currentState;
    if (fps < this.warningFps) {
      this.lowSamples += 1;
      this.recoverySamplesSeen = 0;
      if (this.lowSamples >= this.warningSamples) this.currentState = 'warning';
      return this.currentState;
    }
    this.lowSamples = 0;
    if (this.currentState === 'warning') {
      this.recoverySamplesSeen += 1;
      if (this.recoverySamplesSeen >= this.recoverySamples) {
        this.currentState = 'nominal';
        this.recoverySamplesSeen = 0;
      }
    }
    return this.currentState;
  }

  get state(): PerformanceState {
    return this.currentState;
  }
}
