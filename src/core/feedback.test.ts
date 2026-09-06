import { describe, expect, it } from 'vitest';
import { FeedbackThrottle } from './feedback';

describe('feedback throttle', () => {
  it('accepts the first event and suppresses bursts by kind', () => {
    const throttle = new FeedbackThrottle({ feed: 200 });
    expect(throttle.shouldEmit('feed', 1000)).toBe(true);
    expect(throttle.shouldEmit('feed', 1199)).toBe(false);
    expect(throttle.shouldEmit('feed', 1200)).toBe(true);
  });

  it('keeps different interaction kinds independent', () => {
    const throttle = new FeedbackThrottle({ seed: 400 });
    expect(throttle.shouldEmit('feed', 1000)).toBe(true);
    expect(throttle.shouldEmit('seed', 1000)).toBe(true);
    expect(throttle.shouldEmit('seed', 1200)).toBe(false);
  });

  it('rejects non-finite timestamps without poisoning state', () => {
    const throttle = new FeedbackThrottle();
    expect(throttle.shouldEmit('ui', Number.NaN)).toBe(false);
    expect(throttle.shouldEmit('ui', 1000)).toBe(true);
  });

  it('can be reset for a fresh interaction session', () => {
    const throttle = new FeedbackThrottle({ pause: 1000 });
    expect(throttle.shouldEmit('pause', 1000)).toBe(true);
    throttle.reset();
    expect(throttle.shouldEmit('pause', 1001)).toBe(true);
  });
});
