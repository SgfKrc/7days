export type FeedbackKind = 'feed' | 'seed' | 'prune' | 'preset' | 'pause' | 'ui';

const DEFAULT_INTERVALS: Record<FeedbackKind, number> = {
  feed: 180,
  seed: 260,
  prune: 220,
  preset: 350,
  pause: 300,
  ui: 120,
};

export class FeedbackThrottle {
  private readonly lastEmitted = new Map<FeedbackKind, number>();
  private readonly intervals: Record<FeedbackKind, number>;

  constructor(intervals: Partial<Record<FeedbackKind, number>> = {}) {
    this.intervals = { ...DEFAULT_INTERVALS, ...intervals };
  }

  shouldEmit(kind: FeedbackKind, timestampMs: number): boolean {
    if (!Number.isFinite(timestampMs)) return false;
    const previous = this.lastEmitted.get(kind);
    const interval = Math.max(0, this.intervals[kind]);
    if (previous !== undefined && timestampMs - previous < interval) return false;
    this.lastEmitted.set(kind, timestampMs);
    return true;
  }

  reset(): void {
    this.lastEmitted.clear();
  }
}
